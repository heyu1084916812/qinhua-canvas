import type { NetworkPort, StoragePort } from '../../platform/ports'
import { parseInspirationCases, type InspirationCase } from '../../domain/inspiration/cases'
import type { InspirationSource } from '../../domain/inspiration/sources'
import { errorTextOf } from '../../shared/result'

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
  /**
   * 拉一个来源的数据文件并解析。
   *
   * **失败不抛、也不覆盖旧缓存**：网络抖一下就把几 MB 的好数据换成空表，
   * 用户下次打开只会看到一个空页面，比「这次没刷成功」糟糕得多。
   */
  refresh(source: InspirationSource, signal: AbortSignal): Promise<CachedSource>
}

const write = (
  storage: StoragePort,
  sourceId: string,
  cases: InspirationCase[],
  fetchedAt: number,
) => storage.put('inspirationCache', { id: sourceId, sourceId, cases, fetchedAt })

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
      cases: Array.isArray(row.cases) ? (row.cases as InspirationCase[]) : [],
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

    async refresh(source, signal) {
      const previous = await repo.read(source.id)
      try {
        const res = await network.request(
          { url: source.dataUrl, method: 'GET', timeoutMs: 60_000 },
          signal,
        )
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`HTTP ${res.status}`)
        }
        const cases = parseInspirationCases(await res.json(), source)
        if (cases.length === 0) {
          /** 解析出 0 条多半是上游改了结构 —— 如实报，别把旧数据盖成空的 */
          throw new Error('这个来源这次没解析出任何案例（可能上游改了数据格式）')
        }
        const fetchedAt = Date.now()
        await write(storage, source.id, cases, fetchedAt)
        return { sourceId: source.id, cases, fetchedAt }
      } catch (e) {
        return {
          sourceId: source.id,
          cases: previous?.cases ?? [],
          fetchedAt: previous?.fetchedAt ?? 0,
          error: errorTextOf(e),
        }
      }
    },
  }
  return repo
}
