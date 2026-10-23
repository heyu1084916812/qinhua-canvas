import type { NetworkPort, StoragePort } from '../../platform/ports'
import {
  dedupeIds,
  parseInspirationCases,
  parseReadmeCases,
  parseRequestCases,
  parseTextCases,
  type InspirationCase,
} from '../../domain/inspiration/cases'
import type { InspirationSource } from '../../domain/inspiration/sources'
import { errorTextOf } from '../../shared/result'
import { fingerprintBytes } from '../../domain/shared/hash'

/**
 * 一个来源的**索引缓存**。
 *
 * 只有索引：标题 / 提示词 / 标签 / 预览图外链 / 出处。媒体一个字节都不落地 ——
 * 用户 2026-10-14 明确说过「同步本地太大了，因为里面还有视频」。
 */
export interface CachedSource {
  sourceId: string
  cases: InspirationCase[]
  /** 上次**成功**拉到的时间（失败时保留旧值，界面靠它说明这是什么时候的数据） */
  fetchedAt: number
  /** 本次刷新失败的原因（有它就说明屏幕上这份是上一次的） */
  error?: string
}

export interface InspirationRepository {
  readAll(): Promise<CachedSource[]>
  read(sourceId: string): Promise<CachedSource | null>
  remove(sourceId: string): Promise<void>
  /**
   * 拉一个来源的数据文件并解析。
   *
   * **失败不抛、也不覆盖旧缓存**：网络抖一下就把几 MB 的好数据换成空表，
   * 用户下次打开只会看到一个空页面，比「这次没刷成功」糟糕得多。
   */
  refresh(source: InspirationSource, signal: AbortSignal): Promise<CachedSource>
  /** 首次看到某张预览图时把字节缓存到本地；失败返回 null，不阻塞卡片显示外链。 */
  cacheImage(sourceId: string, caseId: string, url: string): Promise<string | null>
}

const write = (
  storage: StoragePort,
  sourceId: string,
  cases: InspirationCase[],
  fetchedAt: number,
) => storage.put('inspirationCache', { id: sourceId, sourceId, cases, fetchedAt })

const imageCacheJobs = new Map<string, Promise<string | null>>()

export function createInspirationRepository(
  storage: StoragePort,
  network: NetworkPort,
): InspirationRepository {
  const toCached = (row: Record<string, unknown> | undefined): CachedSource | null => {
    if (!row) return null
    const sourceId = typeof row.sourceId === 'string' ? row.sourceId : String(row.id ?? '')
    if (!sourceId) return null
    return {
      sourceId,
      /**
       * 缓存里可能是**修 id 去重之前**存下来的重复数据；读的时候再兜一次，
       * 否则用户不点「刷新案例」就仍然会踩到 React key 冲突（切来源卡片不换）。
       */
      cases: Array.isArray(row.cases) ? dedupeIds(row.cases as InspirationCase[]) : [],
      fetchedAt: typeof row.fetchedAt === 'number' ? row.fetchedAt : 0,
    }
  }

  const repo: InspirationRepository = {
    async readAll() {
      const rows = (await storage.query('inspirationCache', {})) as unknown as Record<
        string,
        unknown
      >[]
      return rows.map(toCached).filter((x): x is CachedSource => x !== null)
    },

    async read(sourceId) {
      const rows = (await storage.query('inspirationCache', {
        id: sourceId,
      })) as unknown as Record<string, unknown>[]
      return toCached(rows[0])
    },

    async remove(sourceId) {
      await storage.delete('inspirationCache', sourceId)
    },

    async refresh(source, signal) {
      const previous = await repo.read(source.id)
      try {
        const multiUrls = source.dataUrls?.length ? source.dataUrls : null
        const multi = !!multiUrls
        const urls =
          multiUrls ??
          [source.dataUrl, source.fallbackDataUrl].filter(
            (url): url is string => typeof url === 'string' && url.length > 0,
          )
        const allCases: InspirationCase[] = []
        let partialError: string | undefined
        const readOne = async (url: string): Promise<InspirationCase[]> => {
          const res = await network.request({ url, method: 'GET', timeoutMs: 60_000 }, signal)
          if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
          const cases =
            source.format === 'readme'
              ? parseReadmeCases(await res.text(), source)
              : source.format === 'text'
                ? parseTextCases(await res.text(), source, url)
              : source.format === 'request'
                ? parseRequestCases(await res.text(), source, url)
                : parseInspirationCases(await res.json(), source)
          if (cases.length === 0) {
            throw new Error('这个来源这次没解析出任何案例（可能上游改了数据格式）')
          }
          return cases
        }

        if (multi) {
          const results = await Promise.allSettled(urls.map(readOne))
          const failed = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          )
          for (const result of results) {
            if (result.status === 'fulfilled') allCases.push(...result.value)
          }
          if (allCases.length === 0 && failed[0]) throw failed[0].reason
          if (failed.length > 0) {
            partialError = `部分分片加载失败：${errorTextOf(failed[0]!.reason)}`
          }
        } else {
          let lastError: Error | null = null
          for (const url of urls) {
            try {
              allCases.push(...(await readOne(url)))
              break
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error))
            }
          }
          if (allCases.length === 0 && lastError) throw lastError
        }
        if (allCases.length === 0) {
          throw new Error('这个来源没有可用数据文件')
        }
        const fresh = dedupeIds(allCases)
        const freshIds = new Set(fresh.map((item) => item.id))
        const cases =
          partialError && previous?.cases.length
            ? dedupeIds([
                ...previous.cases.filter((item) => !freshIds.has(item.id)),
                ...fresh,
              ])
            : fresh
        const fetchedAt = Date.now()
        await write(storage, source.id, cases, fetchedAt)
        return {
          sourceId: source.id,
          cases,
          fetchedAt,
          ...(partialError ? { error: partialError } : {}),
        }
      } catch (e) {
        return {
          sourceId: source.id,
          cases: previous?.cases ?? [],
          fetchedAt: previous?.fetchedAt ?? 0,
          error: errorTextOf(e),
        }
      }
    },

    async cacheImage(sourceId, caseId, url) {
      const key = `${sourceId}:${caseId}:${url}`
      const existing = imageCacheJobs.get(key)
      if (existing) return existing
      const job = (async (): Promise<string | null> => {
        try {
          const cached = await repo.read(sourceId)
          const hit = cached?.cases.find((item) => item.id === caseId)
          if (!hit) return null
          if (hit.imageHash) return hit.imageHash
          const response = await network.request(
            { url, method: 'GET', timeoutMs: 30_000 },
            new AbortController().signal,
          )
          if (response.status < 200 || response.status >= 300) return null
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.length === 0) return null
          const hash = await fingerprintBytes(bytes)
          const headerMime = Object.entries(response.headers).find(
            ([name]) => name.toLowerCase() === 'content-type',
          )?.[1]
          const mime = (headerMime ?? 'image/jpeg').split(';')[0]!.trim()
          await storage.put('assets', {
            id: hash,
            hash,
            mime,
            bytes,
            createdAt: Date.now(),
            projectId: 'inspiration-library',
          } as never)
          if (cached) {
            const cases = cached.cases.map((item) =>
              item.id === caseId ? { ...item, imageHash: hash } : item,
            )
            await write(storage, sourceId, cases, cached.fetchedAt)
          }
          return hash
        } catch {
          return null
        } finally {
          imageCacheJobs.delete(key)
        }
      })()
      imageCacheJobs.set(key, job)
      return job
    },
  }
  return repo
}
