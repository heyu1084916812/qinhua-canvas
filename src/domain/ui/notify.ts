/**
 * 通知偏好与文案（对账 #386 的 E5 —— 设置 → 数据 → 通知）。
 *
 * 三档 = 用户最容易分别做决定的三种时机：
 *   success  生成完成（这一趟出图了）
 *   failure  生成失败 / 部分失败（有任务没出来）
 *   progress 批量进度（一次跑多个任务时逐条报）
 *
 * 三条边界：
 * ① 它只管**提示**，不改生成行为 —— 三档全关，图照样出，只是不弹提示；
 * ② 默认：完成 / 失败**开**，批量进度**关**。默认关的理由很实在：
 *    一次跑 20 张会弹 20 条，比不弹还吵；
 * ③ 脏数据只补**那一项**，不整份丢弃 —— 与外观偏好同一条规矩。
 */
export type NotifyKind = 'success' | 'failure' | 'progress'

export interface NotifyPrefs {
  success: boolean
  failure: boolean
  progress: boolean
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  success: true,
  failure: true,
  progress: false,
}

/** localStorage 键：与 `flow:appearance` / `flow:theme` 同族（本机偏好，不进项目、不随导出） */
export const NOTIFY_STORAGE_KEY = 'flow:notify'

/**
 * 这一档要不要出声。
 *
 * ⚠️ 调用方**只许**拿它决定"弹不弹"：不许拿它当"跳过执行 / 跳过落库"的开关 ——
 * 关掉通知不等于关掉功能。
 */
export function shouldNotify(prefs: NotifyPrefs, kind: NotifyKind): boolean {
  return prefs[kind] === true
}

/** 读回偏好：缺字段 / 脏值只补那一项 */
export function notifyPrefsFrom(raw: unknown): NotifyPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = (key: NotifyKind): boolean =>
    typeof o[key] === 'boolean' ? (o[key] as boolean) : DEFAULT_NOTIFY_PREFS[key]
  return { success: pick('success'), failure: pick('failure'), progress: pick('progress') }
}

/**
 * 一趟跑完该说什么。
 *
 * - `images`：真正出图的**张数**（一次调用出多张就按张数算）；
 * - `failed`：失败的任务数。
 *
 * 返回 null = 这次没有任何值得打扰的事（例如用户自己取消：0 张、0 失败）——
 * 用户自己按的取消，不用系统再告诉他一遍。
 */
export function runNotice(input: {
  images: number
  failed: number
}): { kind: NotifyKind; text: string } | null {
  const images = Math.max(0, Math.floor(input.images))
  const failed = Math.max(0, Math.floor(input.failed))
  if (failed > 0 && images > 0) {
    return {
      kind: 'failure',
      text: `生成结束：成功 ${images} 张、失败 ${failed} 个任务（原因见日志）`,
    }
  }
  if (failed > 0) return { kind: 'failure', text: `生成失败：${failed} 个任务没出图（原因见日志）` }
  if (images > 0) return { kind: 'success', text: `生成完成：${images} 张` }
  return null
}

/**
 * 批量进度文案。
 *
 * 两条"闭嘴"规则：
 * - `total <= 1`：只有一个任务不叫批量，一条一条弹反而吵；
 * - `done >= total`：最后一个任务由 `runNotice` 的完成 / 失败通知收口 ——
 *   两条挨着弹，用户只会看见后一条（提示位只有一个），所以进度条不抢最后一句。
 */
export function progressNotice(
  done: number,
  total: number,
): { kind: NotifyKind; text: string } | null {
  if (total <= 1) return null
  if (done <= 0 || done >= total) return null
  return { kind: 'progress', text: `批量进度：${done}/${total}` }
}

/**
 * 一趟计划里真正出图的张数。
 *
 * **为什么不数与任务数**：`count=4` 的一次调用是**一个任务、四张图**，
 * 按任务数报"完成 1 张"会让用户以为少出了三张。
 */
export function imageCountOf(
  results: readonly { state: { kind: string; result?: readonly unknown[] } }[],
): number {
  let n = 0
  for (const r of results) {
    if (r.state.kind !== 'succeeded') continue
    n += r.state.result?.length ?? 0
  }
  return n
}
