/**
 * 漫剧镜头视频超清的可选档位。
 *
 * 这里只描述**界面可提交的值**；真正的端点和请求字段仍由 RunningHub 目录规格
 * 决定。把两处分开可以避免页面写死 `targetResolution/targetFps` 这些服务端键名。
 */
export const VIDEO_UPSCALE_MODEL_IDS = [
  'Topaz 视频超清',
  'RH 视频超分',
  'RH 视频补帧',
] as const

export type VideoUpscaleModelId = (typeof VIDEO_UPSCALE_MODEL_IDS)[number]

export interface VideoUpscaleOptions {
  resolutions: readonly string[]
  frameRates: readonly number[]
}

const OPTIONS: Record<VideoUpscaleModelId, VideoUpscaleOptions> = {
  'Topaz 视频超清': {
    resolutions: ['720p', '1080p', '4k'],
    frameRates: [30, 60],
  },
  'RH 视频超分': {
    resolutions: ['720p', '1080p', '2k', '4k'],
    frameRates: [],
  },
  'RH 视频补帧': {
    resolutions: [],
    frameRates: [],
  },
}

export function videoUpscaleActionOf(model: string): 'upscale' | 'fps' {
  return model === 'RH 视频补帧' ? 'fps' : 'upscale'
}

export function isVideoUpscaleModel(model: string): model is VideoUpscaleModelId {
  return (VIDEO_UPSCALE_MODEL_IDS as readonly string[]).includes(model)
}

export function videoUpscaleOptionsOf(model: string): VideoUpscaleOptions | null {
  return isVideoUpscaleModel(model) ? OPTIONS[model] : null
}

/**
 * 夹取到该模型真正支持的档位。
 *
 * 默认 `1080p`；Topaz 默认 30fps。非法值一律回落到该模型的默认档，
 * 不把“未知档位”发给服务端换一句看不懂的 4xx。
 */
export function normalizeVideoUpscaleSettings(
  model: string,
  resolution?: string,
  frameRate?: number | string,
): { resolution: string; frameRate: number | null } {
  const options = videoUpscaleOptionsOf(model)
  if (!options) return { resolution: '', frameRate: null }
  const nextResolution = options.resolutions.includes(resolution ?? '')
    ? resolution!
    : options.resolutions.includes('1080p')
      ? '1080p'
      : options.resolutions[0] ?? ''
  const numericFrameRate = Number(frameRate)
  const nextFrameRate =
    options.frameRates.length === 0
      ? null
      : options.frameRates.includes(numericFrameRate)
        ? numericFrameRate
        : options.frameRates[0] ?? null
  return { resolution: nextResolution, frameRate: nextFrameRate }
}
