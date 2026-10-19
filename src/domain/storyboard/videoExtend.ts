/** 漫剧镜头视频续写：只暴露官方端点真实支持的清晰度与时长。 */
export const VIDEO_EXTEND_MODEL_IDS = ['万相2.7 视频续写'] as const

export type VideoExtendModelId = (typeof VIDEO_EXTEND_MODEL_IDS)[number]

const RESOLUTIONS: Record<VideoExtendModelId, readonly string[]> = {
  '万相2.7 视频续写': ['720P', '1080P'],
}

const DURATIONS: Record<VideoExtendModelId, readonly number[]> = {
  '万相2.7 视频续写': [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
}

export function isVideoExtendModel(model: string): model is VideoExtendModelId {
  return (VIDEO_EXTEND_MODEL_IDS as readonly string[]).includes(model)
}

export function videoExtendResolutionsOf(model: string): readonly string[] {
  return isVideoExtendModel(model) ? RESOLUTIONS[model] : []
}

export function videoExtendDurationsOf(model: string): readonly number[] {
  return isVideoExtendModel(model) ? DURATIONS[model] : []
}

export function normalizeVideoExtendSettings(
  model: string,
  resolution?: string,
  duration?: number,
): { resolution: string; duration: number } {
  const resolutions = videoExtendResolutionsOf(model)
  const durations = videoExtendDurationsOf(model)
  const nextResolution = resolutions.includes(resolution ?? '')
    ? resolution!
    : resolutions[0] ?? ''
  const nextDuration = durations.includes(Number(duration))
    ? Number(duration)
    : durations[0] ?? 2
  return { resolution: nextResolution, duration: nextDuration }
}
