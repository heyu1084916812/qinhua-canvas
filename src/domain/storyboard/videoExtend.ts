/** 漫剧镜头视频续写：只暴露官方端点真实支持的清晰度与时长。 */
export const VIDEO_EXTEND_MODEL_IDS = [
  '万相2.7 视频续写',
  '全能视频X 视频续写',
  '全能视频V3.1 Pro 视频扩展',
  '全能视频V3.1 Fast 视频扩展',
] as const

export type VideoExtendModelId = (typeof VIDEO_EXTEND_MODEL_IDS)[number]

const RESOLUTIONS: Record<VideoExtendModelId, readonly string[]> = {
  '万相2.7 视频续写': ['720P', '1080P'],
  '全能视频X 视频续写': [],
  '全能视频V3.1 Pro 视频扩展': ['720p', '1080p'],
  '全能视频V3.1 Fast 视频扩展': ['720p', '1080p'],
}

const DURATIONS: Record<VideoExtendModelId, readonly number[]> = {
  '万相2.7 视频续写': [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  '全能视频X 视频续写': [6, 10],
  '全能视频V3.1 Pro 视频扩展': [],
  '全能视频V3.1 Fast 视频扩展': [],
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
): { resolution: string; duration: number | null } {
  const resolutions = videoExtendResolutionsOf(model)
  const durations = videoExtendDurationsOf(model)
  const nextResolution = resolutions.includes(resolution ?? '')
    ? resolution!
    : resolutions[0] ?? ''
  const nextDuration =
    duration !== undefined && durations.includes(Number(duration))
      ? Number(duration)
      : durations[0] ?? null
  return { resolution: nextResolution, duration: nextDuration }
}
