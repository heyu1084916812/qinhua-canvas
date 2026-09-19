/**
 * 模型能力元数据（架构 §4.2）。
 *
 * 参数显隐由**面板**按能力判别（CreationPanel），这里只提供原始档位——
 * 此前这里还挂着一个 `isParamVisible()`，其 `(maxCount ?? 1) > 1` 的缺省语义
 * 与面板定下的「未声明 = 不设限」相反，且零引用，已删（能力判别只留一份）。
 */
export interface ModelCapability {
  id: string
  category: 'image' | 'chat' | 'video'
  inputTypes: ('text' | 'image' | 'video')[]
  aspectRatios?: string[]
  resolutions?: string[]
  qualities?: string[]
  maxCount?: number
  durations?: [number, number]
  maxReferenceImages?: number
}

/**
 * 生成张数的上限夹取。
 *
 * **未声明 `maxCount` = 不知道上限 = 不设限**（用户 2026-09-19）。
 *
 * 早先写的是 `cap.maxCount ?? 1`，把「模型没上报这个字段」判成了「最多 1 张」——
 * 而多数中转渠道的 `/v1/models` 根本不报 `maxCount`。于是面板显示选了 9 张、
 * 请求发出去却被静默夹回 1 张（**界面显示成功、结果不对**，是最难查的一类缺陷）。
 * 面板层的 `maxCount` 早已按这条语义改对，这里漏了——两处口径必须一致，
 * 否则「能选」和「真会跑几张」就对不上。
 *
 * 只有模型**明确报出更小的值**时才收窄。
 */
export function clampCount(cap: ModelCapability, count: number): number {
  const declared = cap.maxCount
  const floored = Math.max(1, Math.floor(count))
  if (typeof declared !== 'number' || declared <= 0) return floored
  return Math.min(floored, Math.max(1, declared))
}

/** 视频时长 3–15 秒，可键入（产品文档 §6.8） */
export function clampDuration(sec: number, cap?: ModelCapability): number {
  const [min, max] = cap?.durations ?? [3, 15]
  return Math.min(Math.max(Math.round(sec), min), max)
}

export function supportsInput(cap: ModelCapability, type: 'text' | 'image' | 'video'): boolean {
  return cap.inputTypes.includes(type)
}
