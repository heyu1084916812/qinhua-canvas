/** 漫剧镜头视频编辑：只列当前真实可路由的端点与界面档位。 */
export const VIDEO_EDIT_MODEL_IDS = [
  '全能视频X 视频编辑',
  'Kling O3 Pro 视频编辑',
  'Kling O3 Std 视频编辑',
  'Kling O1 Std 视频编辑',
  '全能视频 Omni Flash 视频编辑',
  'HappyHorse 1.0 视频编辑',
  '全能视频R Gen4 Aleph 视频编辑',
  '万相2.7 视频编辑',
] as const

export type VideoEditModelId = (typeof VIDEO_EDIT_MODEL_IDS)[number]

const RESOLUTIONS: Record<VideoEditModelId, readonly string[]> = {
  '全能视频X 视频编辑': ['480p', '720p'],
  'Kling O3 Pro 视频编辑': [],
  'Kling O3 Std 视频编辑': [],
  'Kling O1 Std 视频编辑': [],
  '全能视频 Omni Flash 视频编辑': ['720p', '1080p', '4k'],
  'HappyHorse 1.0 视频编辑': ['720p', '1080p'],
  '全能视频R Gen4 Aleph 视频编辑': [],
  '万相2.7 视频编辑': ['720P', '1080P'],
}

const REQUIRES_REFERENCE_IMAGE: Record<VideoEditModelId, boolean> = {
  '全能视频X 视频编辑': false,
  'Kling O3 Pro 视频编辑': false,
  'Kling O3 Std 视频编辑': false,
  'Kling O1 Std 视频编辑': false,
  '全能视频 Omni Flash 视频编辑': false,
  'HappyHorse 1.0 视频编辑': false,
  '全能视频R Gen4 Aleph 视频编辑': false,
  '万相2.7 视频编辑': true,
}

export function isVideoEditModel(model: string): model is VideoEditModelId {
  return (VIDEO_EDIT_MODEL_IDS as readonly string[]).includes(model)
}

export function videoEditResolutionsOf(model: string): readonly string[] {
  return isVideoEditModel(model) ? RESOLUTIONS[model] : []
}

export function videoEditRequiresReferenceImage(model: string): boolean {
  return isVideoEditModel(model) ? REQUIRES_REFERENCE_IMAGE[model] : false
}

export function normalizeVideoEditResolution(model: string, resolution?: string): string {
  const values = videoEditResolutionsOf(model)
  const candidate = resolution ?? ''
  return values.includes(candidate) ? candidate : values[0] ?? ''
}
