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

export function clampCount(cap: ModelCapability, count: number): number {
  const max = Math.max(1, cap.maxCount ?? 1)
  return Math.min(Math.max(1, Math.floor(count)), max)
}

/** 视频时长 3–15 秒，可键入（产品文档 §6.8） */
export function clampDuration(sec: number, cap?: ModelCapability): number {
  const [min, max] = cap?.durations ?? [3, 15]
  return Math.min(Math.max(Math.round(sec), min), max)
}

export function supportsInput(cap: ModelCapability, type: 'text' | 'image' | 'video'): boolean {
  return cap.inputTypes.includes(type)
}
