import type {
  Row,
  RowOf,
  StoragePort,
  StorageQueryOptions,
  StorageScanOptions,
  TableName,
} from '../ports'

const DEFAULT_BASE_URL = 'http://127.0.0.1:18765'
const REQUIRED_STORE_VERSION = 4
export const SHARED_STORE_URL =
  String(import.meta.env.VITE_SHARED_STORE_URL ?? '').trim() || DEFAULT_BASE_URL

class StaleSharedStoreError extends Error {}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

function marker(bytes: Uint8Array) {
  const nativeToBase64 = (
    bytes as Uint8Array & { toBase64?: () => string }
  ).toBase64
  if (typeof nativeToBase64 === 'function') {
    return { __qhType: 'u8', base64: nativeToBase64.call(bytes) }
  }
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return { __qhType: 'u8', base64: btoa(binary) }
}

function encodeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Uint8Array) return marker(value)
  if (value instanceof ArrayBuffer) return marker(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) {
    return marker(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  if (value instanceof Date) return { __qhType: 'date', iso: value.toISOString() }
  if (Array.isArray(value)) return value.map(encodeValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encodeValue(child)]),
    )
  }
  return String(value)
}

function decodeValue(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(decodeValue)
  if (!value || typeof value !== 'object') return value
  if (value.__qhType === 'u8' && typeof value.base64 === 'string') {
    const binary = atob(value.base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  if (value.__qhType === 'date' && typeof value.iso === 'string') return new Date(value.iso)
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, decodeValue(child)]),
  )
}

async function request(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${SHARED_STORE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    })
    const body = (await response.json()) as { ok?: boolean; error?: string }
    if (!response.ok) {
      throw new Error(body.error || `共享存储请求失败：HTTP ${response.status}`)
    }
    return body
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(
        `共享存储服务无响应（${SHARED_STORE_URL}）。请先启动桌面版或运行 npm run storage。`,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function post(path: string, body: unknown, timeoutMs?: number) {
  return request(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    timeoutMs,
  )
}

function rowKey(table: string, id: string) {
  return `${table}\u0000${id}`
}

function rowId(row: Row): string {
  if (typeof row.id !== 'string' || !row.id) throw new Error('共享存储要求每行都有字符串 id')
  return row.id
}

function matches(row: Row, filter: Partial<Row>): boolean {
  return Object.entries(filter).every(([key, expected]) => row[key] === expected)
}

export function createSharedStorage(): StoragePort {
  let transactionTail: Promise<void> = Promise.resolve()

  const rawPut = async (table: TableName, row: RowOf<TableName>, timeoutMs?: number) => {
    await post('/put', { table, row: encodeValue(row) }, timeoutMs)
  }

  const rawBulkPut = async (
    table: TableName,
    rows: RowOf<TableName>[],
    timeoutMs?: number,
  ) => {
    await post('/bulkPut', { table, rows: encodeValue(rows) }, timeoutMs)
  }

  const rawDelete = async (table: TableName, id: string) => {
    await post('/delete', { table, id })
  }

  const rawQuery = async <K extends TableName>(
    table: K,
    filter: Partial<RowOf<K>>,
    options: StorageQueryOptions = {},
  ): Promise<RowOf<K>[]> => {
    const result = (await post('/query', {
      table,
      filter: encodeValue(filter),
      includePayload: options.includePayload !== false,
      fields: options.fields?.join(','),
    })) as { rows: JsonValue[] }
    return result.rows.map((row) => decodeValue(row) as RowOf<K>)
  }

  const port: StoragePort = {
    async open() {
      const started = Date.now()
      while (true) {
        try {
          const health = (await request('/health', { method: 'GET' }, 1_000)) as {
            service?: string
            version?: number
          }
          if (
            health.service !== 'qinghua-shared-store' ||
            typeof health.version !== 'number' ||
            health.version < REQUIRED_STORE_VERSION
          ) {
            throw new StaleSharedStoreError(
              `共享存储服务版本过旧（需要 ${REQUIRED_STORE_VERSION}），请关闭残留的旧 qinghua-store / 轻画进程后重新启动。`,
            )
          }
          return
        } catch (error) {
          if (error instanceof StaleSharedStoreError) throw error
          if (Date.now() - started >= 8_000) {
            throw new Error(
              `无法连接共享存储服务 ${SHARED_STORE_URL}。调试壳/发布壳应自动启动它；纯浏览器请先运行 npm run storage。`,
            )
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    },

    async transaction(_tables, fn) {
      const execute = async () => {
        const ops: Array<Record<string, unknown>> = []
        const rows = new Map<string, Row | null>()
        const tx: StoragePort = {
          ...port,
          async transaction(_nestedTables, nestedFn) {
            return nestedFn(tx)
          },
          async put(table, row) {
            const id = rowId(row as Row)
            rows.set(rowKey(table, id), { ...row } as Row)
            ops.push({ kind: 'put', table, row: encodeValue(row) })
          },
          async bulkPut(table, nextRows) {
            for (const row of nextRows) {
              const id = rowId(row as Row)
              rows.set(rowKey(table, id), { ...row } as Row)
            }
            ops.push({ kind: 'bulkPut', table, rows: encodeValue(nextRows) })
          },
          async delete(table, id) {
            rows.set(rowKey(table, id), null)
            ops.push({ kind: 'delete', table, id })
          },
          async query(table, filter, options) {
            const committed = await rawQuery(table, filter, options)
            const merged = new Map<string, RowOf<typeof table>>()
            for (const row of committed) merged.set(row.id, row)
            const prefix = `${table}\u0000`
            for (const [key, row] of rows) {
              if (!key.startsWith(prefix)) continue
              const id = key.slice(prefix.length)
              if (row === null) merged.delete(id)
              else if (matches(row, filter)) merged.set(id, row as RowOf<typeof table>)
            }
            return [...merged.values()]
          },
        }
        const result = await fn(tx)
        if (ops.length > 0) await post('/tx', { ops }, 10 * 60_000)
        return result
      }
      const result = transactionTail.then(execute, execute)
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },

    async put(table, row) {
      await rawPut(table, row)
    },

    async bulkPut(table, rows) {
      await rawBulkPut(table, rows)
    },

    async delete(table, id) {
      await rawDelete(table, id)
    },

    async query(table, filter, options) {
      return rawQuery(table, filter, options)
    },

    async scan(table, batchSize, onBatch, options?: StorageScanOptions) {
      let offset = 0
      let total = 0
      while (true) {
        const response = (await request(
          `/rows?table=${encodeURIComponent(table)}&offset=${offset}&limit=${Math.max(1, batchSize)}&includePayload=${options?.includePayload === false ? 0 : 1}`,
          { method: 'GET' },
          10 * 60_000,
        )) as { rows: JsonValue[]; total: number }
        total = response.total
        if (response.rows.length === 0) break
        const rows = response.rows.map((row) => decodeValue(row) as RowOf<typeof table>)
        offset += rows.length
        await onBatch(rows, { total })
      }
      return offset
    },

    async estimateUsage() {
      const response = (await request('/usage', { method: 'GET' })) as {
        used: number
        quota: number
      }
      return response
    },
  }

  return port
}

export async function sharedKvGet<T = unknown>(key: string): Promise<T | null> {
  const response = (await post('/kv/get', { key })) as { value: JsonValue }
  return response.value === null ? null : (decodeValue(response.value) as T)
}

export async function sharedKvPut(key: string, value: unknown): Promise<void> {
  await post('/kv/put', { key, value: encodeValue(value) })
}

export async function sharedKvDelete(key: string): Promise<void> {
  await post('/kv/delete', { key })
}
