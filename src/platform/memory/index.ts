import type {
  PlatformKit,
  StoragePort,
  NetworkPort,
  CredentialPort,
  FilePort,
  LoggerPort,
  TableName,
  Row,
  NetworkRequest,
  NetworkResponse,
  StreamChunk,
} from '../ports'
import { parseSSELine, createLineSplitter } from '../sse'
import { createStorageAssetPort } from '../assets'

export interface MemorySeed {
  rows?: Partial<Record<TableName, Row[]>>
  /** 自定义请求处理；未提供时返回 200 空响应 */
  handler?: (req: NetworkRequest) => Promise<NetworkResponse>
  usage?: { used: number; quota: number }
}

function matches(row: Row, filter: Partial<Row>): boolean {
  return Object.entries(filter).every(([k, v]) => row[k] === v)
}

export function createMemoryStorage(seed: MemorySeed = {}): StoragePort {
  const tables = new Map<TableName, Map<string, Row>>()
  for (const [table, rows] of Object.entries(seed.rows ?? {})) {
    const map = new Map<string, Row>()
    for (const row of rows ?? []) map.set(row.id, { ...row })
    tables.set(table as TableName, map)
  }

  const tableOf = (table: TableName): Map<string, Row> => {
    let map = tables.get(table)
    if (!map) {
      map = new Map<string, Row>()
      tables.set(table, map)
    }
    return map
  }

  return {
    async open() {
      /* 内存实现无需打开 */
    },
    async transaction(_tables, fn) {
      return fn()
    },
    async put(table, row) {
      tableOf(table).set(row.id, { ...row })
    },
    async bulkPut(table, rows) {
      const map = tableOf(table)
      for (const row of rows) map.set(row.id, { ...row })
    },
    async delete(table, id) {
      tableOf(table).delete(id)
    },
    async query(table, filter) {
      return [...tableOf(table).values()].filter((r) => matches(r, filter)).map((r) => ({ ...r }))
    },
    async estimateUsage() {
      return seed.usage ?? { used: 0, quota: 1024 * 1024 * 1024 }
    },
  }
}

function textResponse(status: number, text: string): NetworkResponse {
  return {
    status,
    headers: {},
    async text() {
      return text
    },
    async json<T = unknown>() {
      return JSON.parse(text) as T
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer as ArrayBuffer
    },
  }
}

export function createMemoryNetwork(seed: MemorySeed = {}): NetworkPort {
  const handler = seed.handler ?? (async () => textResponse(200, ''))

  return {
    request(req) {
      return handler(req)
    },
    async *stream(req, signal): AsyncIterable<StreamChunk> {
      const res = await handler(req)
      const splitter = createLineSplitter()
      const text = await res.text()
      for (const line of splitter(text)) {
        if (signal.aborted) return
        const chunk = parseSSELine(line)
        if (chunk) yield chunk
        if (chunk?.type === 'done') return
      }
    },
  }
}

export function createMemoryCredentials(): CredentialPort {
  const store = new Map<string, string>()
  return {
    async save(ref, secret) {
      store.set(ref, secret)
    },
    async load(ref) {
      return store.get(ref) ?? null
    },
    async remove(ref) {
      store.delete(ref)
    },
    mask(secret) {
      if (secret.length <= 8) return '••••••••'
      return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
    },
  }
}

export function createMemoryFiles(): FilePort {
  return {
    async pickFile() {
      return null
    },
    async saveFile() {
      /* 内存实现不落盘 */
    },
  }
}

export function createMemoryLogger(): LoggerPort {
  const entries: { level: string; message: string }[] = []
  const port: LoggerPort & { entries: typeof entries } = {
    entries,
    log(level, message) {
      entries.push({ level, message })
    },
  }
  return port
}

export function createMemoryPlatform(seed: MemorySeed = {}): PlatformKit {
  const storage = createMemoryStorage(seed)
  return {
    storage,
    network: createMemoryNetwork(seed),
    assets: createStorageAssetPort(storage),
    credentials: createMemoryCredentials(),
    files: createMemoryFiles(),
    logger: createMemoryLogger(),
  }
}
