/**
 * 项目卡封面的**归属规则**（用户 2026-10-06，对账 #289）。
 *
 * 用户口径：「封面规则是最后一次生成的图片 / 最后一次上传的图片，
 * 反正就是**最后一次出现在画布中的图片**」。
 *
 * ## 两个来源，一个判据
 *
 * 画布上的图只有两条来路，两条各有自己的"时间"：
 *
 * | 来路 | 时间从哪来 | 谁在维护 |
 * | --- | --- | --- |
 * | 生成产物 | `runRecords.createdAt`（生成历史天然的时序） | 执行层 |
 * | 上传 / 导入 | `projects.extra.cover = { hash, at }` | `importAssetFile`（导入的唯一咽喉） |
 *
 * **判据只有一个：谁的时间更晚谁当封面。** 之所以不是"上传优先 / 生成优先"，
 * 是因为用户要的是"最后出现在画布中的那一张"，那是个**时间比较**，不是优先级。
 *
 * ## 为什么上传那条要单独记一笔，而不是实时扫 `assets` 表
 *
 * `assets` 每行都带全分辨率字节（见 `assetHistoryRepository` 的注释）：
 * 在项目列表页对每个项目 `query('assets', { projectId })` 会把几百 MB 的图拉进内存
 * —— 那是**打开应用首页就要付的代价**，不能接受。
 * 而导入路径上顺手记一个 `{ hash, at }`（几十字节）是零成本的。
 *
 * **已知边界**：把 A 项目里导入的图**复制粘贴**到 B 项目，B 的封面不会因此更新
 * （那张图的时间记录在 A 名下）。这类跨项目粘贴是少数派，且用户看到的是"B 的上一张图"
 * 而不是空封面 —— 比为此把整张 assets 表读进内存划算。
 */

/** 项目的"上传封面"标记：哪一张、什么时候进的画布 */
export interface CoverMark {
  hash: string
  at: number
}

/** `projects.extra` 里存这一笔的键 */
const COVER_MARK_KEY = 'cover'

/**
 * 从 `projects.extra` 里读回标记。
 *
 * 一律**容错**：老项目没有这个字段、手工改坏了、`at` 不是数字 —— 都返回 null
 * （项目列表是只读展示，不该因为一条脏数据整页挂掉）。
 */
export function readCoverMark(extra: unknown): CoverMark | null {
  if (!extra || typeof extra !== 'object') return null
  const raw = (extra as Record<string, unknown>)[COVER_MARK_KEY]
  if (!raw || typeof raw !== 'object') return null
  const hash = (raw as Record<string, unknown>).hash
  const at = (raw as Record<string, unknown>).at
  if (typeof hash !== 'string' || hash === '') return null
  return { hash, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 }
}

/** 写入标记（返回新的 extra，**不改原对象** —— 项目行是持久化数据，就地改最容易出事） */
export function withCoverMark(
  extra: unknown,
  hash: string,
  at: number,
): Record<string, unknown> {
  /* 入参是"项目行里那个 extra"，来源是库里读出来的 `unknown` ⇒ 这里做一次收窄 */
  const base = extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {}
  return { ...base, [COVER_MARK_KEY]: { hash, at } satisfies CoverMark }
}

/**
 * 定封面：**生成**与**上传**两个候选里时间更晚的那个。
 *
 * 纯函数（时间由调用方给），故"同毫秒谁赢"这类边界可以被单测钉死：
 * 打平时取**生成的** —— 同一时刻既是产物又是导入时，产物那张才是用户刚看到落下来的那张。
 */
export function resolveProjectCover(input: {
  generated?: CoverMark | null
  marked?: CoverMark | null
}): string | null {
  const generated = input.generated ?? null
  const marked = input.marked ?? null
  if (!generated) return marked?.hash ?? null
  if (!marked) return generated.hash
  return marked.at > generated.at ? marked.hash : generated.hash
}
