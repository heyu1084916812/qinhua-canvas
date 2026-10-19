/**
 * RunningHub 标准模型端点规格（**自动生成，别手改**）
 *
 * 生成：`node scripts/gen-runninghub-models.mjs <RH_CLI>/src/rh_cli/catalog/data/capabilities.json`
 * 来源：RunningHub 官方 CLI（github.com/HM-RunningHub/RH_CLI）随包附带的端点目录
 *       capabilities.json —— version 2026-06-02，共 356 个端点；
 *       本文件只留**精挑的 59 个端点**（官方 CLI 快捷选择 + 本项目已交付的端点）。
 *
 * 官方 CLI 建请求体的最后一步是「**必填 + 有默认值**而还没填的参数一律补默认值」
 * （`model/payload.py`）—— 适配器照同一条规则走 `requiredDefaults`。
 * 所以这里只保留三类参数：必填的、界面能驱动的（比例 / 清晰度 / 时长）、媒体类（IMAGE……）。
 */

export interface RunningHubMediaParam {
  key: string
  type: 'IMAGE' | 'VIDEO' | 'AUDIO'
  multiple?: boolean
  required?: boolean
}

export interface RunningHubDrivenParam {
  key: string
  options?: string[]
}

export interface RunningHubEndpointSpec {
  id: string
  /** 目录里的任务类型（`text-to-image` / `image-to-video` …），给日志与排查用 */
  task: string
  kind: 'image' | 'video'
  /** 目录里的中文名（原样，不加工） */
  label: string
  /** 提示词参数的键（目录里所有端点都是 `prompt`，仍照实记） */
  promptKey?: string
  /** 参考图 / 视频 / 音频参数的键与是否多值 */
  media?: RunningHubMediaParam
  /** 第二个媒体槽（可选参考图，或图片必填 + 视频可选的组合） */
  secondaryMedia?: RunningHubMediaParam
  /** 音频输入（数字人口播等端点与图片分开声明） */
  audio?: RunningHubMediaParam
  /** 比例、清晰度、时长：键名各端点不同（`aspectRatio` / `ratio`…），故逐个记 */
  ratio?: RunningHubDrivenParam
  resolution?: RunningHubDrivenParam
  duration?: RunningHubDrivenParam
  /** 视频超清的输出帧率（如 Topaz 的 targetFps） */
  fps?: RunningHubDrivenParam
  /** 超分类模型的放大倍数（2x / 4x / 6x） */
  scale?: RunningHubDrivenParam
  /** 必填且界面上没有对应档位的参数（键 → 照官方目录的默认值原样补） */
  requiredDefaults?: Record<string, unknown>
}

/** 精挑的端点规格（key = 端点 id） */
export const RUNNINGHUB_ENDPOINT_SPECS: readonly RunningHubEndpointSpec[] = [
  {
    id: 'alibaba/happyhorse-1.0/video-edit',
    task: 'video-edit',
    kind: 'video',
    label: 'happyhorse-1.0/video-edit',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    secondaryMedia: { "key": "imageUrls", "type": "IMAGE", "multiple": true },
    resolution: { "key": "resolution", "options": [ "720p", "1080p" ] },
    requiredDefaults: { "resolution": "1080p" },
  },
  {
    id: 'alibaba/qwen-image-2.0-pro/image-edit',
    task: 'image-to-image',
    kind: 'image',
    label: '千问2.0Pro-图像编辑',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
  },
  {
    id: 'alibaba/qwen-image-2.0/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '千问2.0-文生图',
    promptKey: 'prompt',
  },
  {
    id: 'alibaba/wan-2.7/image-edit',
    task: 'image-to-image',
    kind: 'image',
    label: '万相2.7-图像编辑',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
  },
  {
    id: 'alibaba/wan-2.7/image-edit-pro',
    task: 'image-to-image',
    kind: 'image',
    label: '万相2.7-图像编辑Pro',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
  },
  {
    id: 'alibaba/wan-2.7/video-edit',
    task: 'video-edit',
    kind: 'video',
    label: '万相2.7-视频编辑',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    secondaryMedia: { "key": "videoUrl", "type": "VIDEO" },
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16", "1:1", "4:3", "3:4" ] },
    resolution: { "key": "resolution", "options": [ "720P", "1080P" ] },
    duration: { "key": "duration", "options": [ "0", "2", "3", "4", "5", "6", "7", "8", "9", "10" ] },
    requiredDefaults: { "resolution": "720P", "duration": "0", "aspectRatio": "16:9" },
  },
  {
    id: 'alibaba/wan-2.7/video-extend',
    task: 'video-extend',
    kind: 'video',
    label: '万相2.7-视频续写',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    audio: { "key": "audioUrl", "type": "AUDIO" },
    resolution: { "key": "resolution", "options": [ "720P", "1080P" ] },
    duration: { "key": "duration", "options": [ "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15" ] },
    requiredDefaults: { "resolution": "1080P", "duration": "5" },
  },
  {
    id: 'bytedance/jimeng-4.6/image-to-image',
    task: 'image-to-image',
    kind: 'image',
    label: '即梦图片 4.6 图生图',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
  },
  {
    id: 'bytedance/jimeng-4.6/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '即梦图片 4.6 文生图',
    promptKey: 'prompt',
  },
  {
    id: 'gemini-omni-flash/video-edit',
    task: 'video-edit',
    kind: 'video',
    label: '全能视频 Omni Flash 视频编辑-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    secondaryMedia: { "key": "imageUrls", "type": "IMAGE", "multiple": true },
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16" ] },
    resolution: { "key": "resolution", "options": [ "720p", "1080p", "4k" ] },
    requiredDefaults: { "resolution": "720p" },
  },
  {
    id: 'kling-v2-ai-avatar-pro/image-audio-to-video',
    task: 'lip-sync-video',
    kind: 'video',
    label: 'Kling V2 Pro 数字人口播视频',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    audio: { "key": "audioUrl", "type": "AUDIO", "required": true },
  },
  {
    id: 'kling-v2-ai-avatar-standard/image-audio-to-video',
    task: 'lip-sync-video',
    kind: 'video',
    label: 'Kling V2 Std 数字人口播视频',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    audio: { "key": "audioUrl", "type": "AUDIO", "required": true },
  },
  {
    id: 'kling-v3.0-pro/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '可灵图生视频3.0-pro',
    promptKey: 'prompt',
    media: { "key": "firstImageUrl", "type": "IMAGE", "required": true },
    secondaryMedia: { "key": "lastImageUrl", "type": "IMAGE" },
    duration: { "key": "duration", "options": [ "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15" ] },
    requiredDefaults: { "duration": "5", "sound": true },
  },
  {
    id: 'kling-v3.0-pro/text-to-video',
    task: 'text-to-video',
    kind: 'video',
    label: '可灵文生视频3.0-pro',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "1:1", "16:9", "9:16" ] },
    duration: { "key": "duration", "options": [ "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15" ] },
    requiredDefaults: { "duration": "5", "sound": true },
  },
  {
    id: 'kling-video-o1-std/edit-video',
    task: 'video-edit',
    kind: 'video',
    label: '可灵视频编辑o1',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    secondaryMedia: { "key": "imageUrls", "type": "IMAGE", "multiple": true },
    requiredDefaults: { "mode": "std", "keepOriginalSound": true },
  },
  {
    id: 'kling-video-o3-pro/video-edit',
    task: 'video-edit',
    kind: 'video',
    label: 'kling-video-o3-pro/video-edit',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    secondaryMedia: { "key": "imageUrls", "type": "IMAGE", "multiple": true },
    requiredDefaults: { "keepOriginalSound": true },
  },
  {
    id: 'kling-video-o3-std/video-edit',
    task: 'video-edit',
    kind: 'video',
    label: 'kling-video-o3-std/video-edit',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    secondaryMedia: { "key": "imageUrls", "type": "IMAGE", "multiple": true },
    requiredDefaults: { "keepOriginalSound": true },
  },
  {
    id: 'luma/uni-1-max/image-edit',
    task: 'image-to-image',
    kind: 'image',
    label: 'Luma uni-1-max 图像编辑',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    ratio: { "key": "aspectRatio", "options": [ "3:1", "2:1", "16:9", "3:2", "1:1", "2:3", "9:16", "1:2", "1:3" ] },
  },
  {
    id: 'luma/uni-1/image-edit',
    task: 'image-to-image',
    kind: 'image',
    label: 'Luma uni-1 图像编辑',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    ratio: { "key": "aspectRatio", "options": [ "3:1", "2:1", "16:9", "3:2", "1:1", "2:3", "9:16", "1:2", "1:3" ] },
  },
  {
    id: 'minimax/hailuo-02/t2v-pro',
    task: 'text-to-video',
    kind: 'video',
    label: '海螺-02-文生视频-pro',
    promptKey: 'prompt',
    requiredDefaults: { "enablePromptExpansion": true },
  },
  {
    id: 'minimax/hailuo-2.3-fast/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '海螺-2.3-fast-图生视频',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    duration: { "key": "duration", "options": [ "6", "10" ] },
    requiredDefaults: { "enablePromptExpansion": true, "duration": "6" },
  },
  {
    id: 'rhart-image-g-2/image-to-image',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片G-2.0-图生图-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "empty", "3:2", "1:1", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9", "3:4", "4:3" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
  },
  {
    id: 'rhart-image-g-2/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '全能图片G-2.0-文生图-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "empty", "3:2", "1:1", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9", "3:4", "4:3" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
  },
  {
    id: 'rhart-image-g-3/image-to-image',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片X-3-图生图',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "required": true },
  },
  {
    id: 'rhart-image-g-4/image-to-image',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片X-4-图生图',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE" },
  },
  {
    id: 'rhart-image-n-g31-flash/image-to-image',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片V2-图生图-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
    requiredDefaults: { "resolution": "1k" },
  },
  {
    id: 'rhart-image-n-g31-flash/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '全能图片V2-文生图-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
    requiredDefaults: { "resolution": "1k" },
  },
  {
    id: 'rhart-image-n-pro-official/edit',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片PRO-图生图-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
    requiredDefaults: { "resolution": "1k" },
  },
  {
    id: 'rhart-image-n-pro-official/edit-ultra',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片PRO-图生图Ultra-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9" ] },
    resolution: { "key": "resolution", "options": [ "4k", "8k" ] },
    requiredDefaults: { "resolution": "8k" },
  },
  {
    id: 'rhart-image-n-pro/edit',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片PRO-图生图-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
    requiredDefaults: { "resolution": "1k" },
  },
  {
    id: 'rhart-image-n-pro/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '全能图片PRO-文生图-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9" ] },
    resolution: { "key": "resolution", "options": [ "1k", "2k", "4k" ] },
    requiredDefaults: { "resolution": "1k" },
  },
  {
    id: 'rhart-image-x-official/edit',
    task: 'image-to-image',
    kind: 'image',
    label: '全能图片X-图片编辑-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "image", "type": "IMAGE", "required": true },
  },
  {
    id: 'rhart-video-g-official/edit-video',
    task: 'video-edit',
    kind: 'video',
    label: '全能视频X-编辑视频-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    resolution: { "key": "resolution", "options": [ "720p", "480p" ] },
    requiredDefaults: { "resolution": "480p" },
  },
  {
    id: 'rhart-video-g-official/video-extend',
    task: 'video-extend',
    kind: 'video',
    label: '全能视频X-视频续写-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    duration: { "key": "duration", "options": [ "6", "10" ] },
    requiredDefaults: { "duration": "6" },
  },
  {
    id: 'rhart-video-g/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '全能视频X-图生视频-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true },
    ratio: { "key": "aspectRatio", "options": [ "2:3", "3:2", "1:1", "16:9", "9:16" ] },
    resolution: { "key": "resolution", "options": [ "720p", "480p" ] },
    duration: { "key": "duration" },
    requiredDefaults: { "aspectRatio": "2:3", "resolution": "480p" },
  },
  {
    id: 'rhart-video-g/text-to-video',
    task: 'text-to-video',
    kind: 'video',
    label: '全能视频X-文生视频-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "2:3", "3:2", "1:1", "16:9", "9:16" ] },
    resolution: { "key": "resolution", "options": [ "720p", "480p" ] },
    duration: { "key": "duration" },
    requiredDefaults: { "aspectRatio": "2:3", "resolution": "720p" },
  },
  {
    id: 'rhart-video-r/gen4-aleph-official/video-to-video',
    task: 'video-edit',
    kind: 'video',
    label: '全能视频R-gen4-aleph/视频编辑-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    secondaryMedia: { "key": "referenceImageUrl", "type": "IMAGE" },
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16", "1:1", "4:3", "3:4" ] },
  },
  {
    id: 'rhart-video-s/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '全能视频S-图生视频-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    ratio: { "key": "aspectRatio", "options": [ "9:16", "16:9" ] },
    duration: { "key": "duration", "options": [ "10", "15" ] },
    requiredDefaults: { "duration": "10", "aspectRatio": "9:16" },
  },
  {
    id: 'rhart-video-s/text-to-video',
    task: 'text-to-video',
    kind: 'video',
    label: '全能视频S-文生视频-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "9:16", "16:9" ] },
    duration: { "key": "duration", "options": [ "10", "15" ] },
    requiredDefaults: { "duration": "10", "aspectRatio": "9:16" },
  },
  {
    id: 'rhart-video-v3.1-fast-official/video-extend',
    task: 'video-extend',
    kind: 'video',
    label: '全能视频V3.1-fast-视频扩展-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "video", "type": "VIDEO", "required": true },
    resolution: { "key": "resolution", "options": [ "720p", "1080p" ] },
    requiredDefaults: { "resolution": "720p" },
  },
  {
    id: 'rhart-video-v3.1-fast/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '全能视频V3.1-fast-图生视频-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16" ] },
    resolution: { "key": "resolution", "options": [ "720p", "1080p", "4k" ] },
    duration: { "key": "duration", "options": [ "8" ] },
    requiredDefaults: { "aspectRatio": "16:9", "resolution": "720p" },
  },
  {
    id: 'rhart-video-v3.1-fast/text-to-video',
    task: 'text-to-video',
    kind: 'video',
    label: '全能视频V3.1-fast-文生视频-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16" ] },
    resolution: { "key": "resolution", "options": [ "720p", "1080p", "4k" ] },
    duration: { "key": "duration", "options": [ "8" ] },
    requiredDefaults: { "aspectRatio": "9:16", "resolution": "720p" },
  },
  {
    id: 'rhart-video-v3.1-pro-official/video-extend',
    task: 'video-extend',
    kind: 'video',
    label: '全能视频V3.1-pro-视频扩展-官方稳定版',
    promptKey: 'prompt',
    media: { "key": "video", "type": "VIDEO", "required": true },
    resolution: { "key": "resolution", "options": [ "720p", "1080p" ] },
    requiredDefaults: { "resolution": "720p" },
  },
  {
    id: 'rhart-video-v3.1-pro/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '全能视频V3.1-pro-图生视频-低价渠道版',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "multiple": true, "required": true },
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16" ] },
    duration: { "key": "duration", "options": [ "8" ] },
    requiredDefaults: { "aspectRatio": "16:9" },
  },
  {
    id: 'rhart-video-v3.1-pro/text-to-video',
    task: 'text-to-video',
    kind: 'video',
    label: '全能视频V3.1-pro-文生视频-低价渠道版',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "16:9", "9:16" ] },
    resolution: { "key": "resolution", "options": [ "720p", "1080p", "4k" ] },
    duration: { "key": "duration", "options": [ "8" ] },
    requiredDefaults: { "aspectRatio": "9:16", "resolution": "720p" },
  },
  {
    id: 'rhart-video/sparkvideo-2.0/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: 'Seedance2.0/图生视频',
    promptKey: 'prompt',
    media: { "key": "firstFrameUrl", "type": "IMAGE", "required": true },
    secondaryMedia: { "key": "lastFrameUrl", "type": "IMAGE" },
    ratio: { "key": "ratio", "options": [ "adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9" ] },
    resolution: { "key": "resolution", "options": [ "480p", "720p", "native1080p", "1080p", "2k", "4k" ] },
    duration: { "key": "duration", "options": [ "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15" ] },
    requiredDefaults: { "resolution": "720p", "duration": "5" },
  },
  {
    id: 'rhart-video/sparkvideo-2.0/text-to-video',
    task: 'text-to-video',
    kind: 'video',
    label: 'Seedance2.0/文生视频',
    promptKey: 'prompt',
    ratio: { "key": "ratio", "options": [ "adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9" ] },
    resolution: { "key": "resolution", "options": [ "480p", "720p", "native1080p", "1080p", "2k", "4k" ] },
    duration: { "key": "duration", "options": [ "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15" ] },
    requiredDefaults: { "resolution": "720p", "duration": "5" },
  },
  {
    id: 'rhart-video/video-upscaler',
    task: 'video-upscale',
    kind: 'video',
    label: 'RH视频超分',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    resolution: { "key": "targetResolution", "options": [ "720p", "1080p", "2k", "4k" ] },
    requiredDefaults: { "targetResolution": "1080p" },
  },
  {
    id: 'seedream-v5-lite/image-to-image',
    task: 'image-to-image',
    kind: 'image',
    label: 'seedream-v5-lite-图生图',
    promptKey: 'prompt',
    media: { "key": "imageUrls", "type": "IMAGE", "multiple": true, "required": true },
    resolution: { "key": "resolution", "options": [ "2k", "3k" ] },
  },
  {
    id: 'seedream-v5-lite/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: 'seedream-v5-lite-文生图',
    promptKey: 'prompt',
    resolution: { "key": "resolution", "options": [ "2k", "3k" ] },
  },
  {
    id: 'topazlabs/image-upscale-cgi',
    task: 'image-upscale',
    kind: 'image',
    label: 'topazlabs图像放大CGI',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    scale: { "key": "scale", "options": [ "2x", "4x", "6x" ] },
    requiredDefaults: { "scale": "2x" },
  },
  {
    id: 'topazlabs/image-upscale-high-fidelity-v2',
    task: 'image-upscale',
    kind: 'image',
    label: 'topazlabs图像放大High Fidelity V2',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    scale: { "key": "scale", "options": [ "2x", "4x", "6x" ] },
    requiredDefaults: { "scale": "2x" },
  },
  {
    id: 'topazlabs/image-upscale-standard-v2',
    task: 'image-upscale',
    kind: 'image',
    label: 'topazlabs图像放大StandardV2',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    scale: { "key": "scale", "options": [ "2x", "4x", "6x" ] },
    requiredDefaults: { "scale": "2x" },
  },
  {
    id: 'topazlabs/image-upscale-text-refine',
    task: 'image-upscale',
    kind: 'image',
    label: 'topazlabs图像放大Text Refine',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    scale: { "key": "scale", "options": [ "2x", "4x", "6x" ] },
    requiredDefaults: { "scale": "2x" },
  },
  {
    id: 'topazlabs/image-upscale/low-resolution-v2',
    task: 'image-upscale',
    kind: 'image',
    label: 'topazlabs图像放大Low Resolution V2',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    scale: { "key": "scale", "options": [ "2x", "4x", "6x" ] },
    requiredDefaults: { "scale": "2x" },
  },
  {
    id: 'topazlabs/video-upscale',
    task: 'video-upscale',
    kind: 'video',
    label: 'topazlabs视频放大',
    media: { "key": "videoUrl", "type": "VIDEO", "required": true },
    resolution: { "key": "targetResolution", "options": [ "720p", "1080p", "4k" ] },
    fps: { "key": "targetFps", "options": [ "30", "60" ] },
    requiredDefaults: { "targetResolution": "1080p", "targetFps": "30" },
  },
  {
    id: 'vidu/image-to-video-q3-pro',
    task: 'image-to-video',
    kind: 'video',
    label: 'Vidu-图生视频-q3-pro',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE", "required": true },
    resolution: { "key": "resolution", "options": [ "360p", "540p", "720p", "1080p", "2k" ] },
    duration: { "key": "duration", "options": [ "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16" ] },
    requiredDefaults: { "duration": "5", "resolution": "720p", "audio": true },
  },
  {
    id: 'vidu/text-to-video-q3-pro',
    task: 'text-to-video',
    kind: 'video',
    label: 'Vidu-文生视频-q3-pro',
    promptKey: 'prompt',
    ratio: { "key": "aspectRatio", "options": [ "4:3", "3:4", "16:9", "9:16", "1:1" ] },
    resolution: { "key": "resolution", "options": [ "360p", "540p", "720p", "1080p" ] },
    duration: { "key": "duration", "options": [ "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16" ] },
    requiredDefaults: { "style": "general", "aspectRatio": "16:9", "resolution": "720p", "duration": "5", "audio": true },
  },
  {
    id: 'youchuan/text-to-image-v7',
    task: 'text-to-image',
    kind: 'image',
    label: '悠船文生图-v7',
    promptKey: 'prompt',
    media: { "key": "imageUrl", "type": "IMAGE" },
    secondaryMedia: { "key": "sref", "type": "IMAGE" },
    ratio: { "key": "aspectRatio", "options": [ "1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16" ] },
  },
]

/** 轻画里出现的模型（下拉里的一行 = 一个模型，不是"一个端点"） */
export interface RunningHubModel {
  /** 轻画的模型 id = **显示名**（下拉里显示的就是它；`app:` 那条是 AI 应用，扣币） */
  id: string
  hint: string
  kind: 'image' | 'video'
  /** 文生…端点（节点没有参考图时走它） */
  textEndpoint: string
  /** 图生…端点（节点连了参考图时走它）；没有这一项表示该模型没有图生档 */
  imageEndpoint?: string
}

export const RUNNINGHUB_MODELS: readonly RunningHubModel[] = [
  {
    // 官方目录：全能图片PRO
    id: 'Nano Banana Pro',
    hint: '香蕉Pro同款，默认推荐，综合效果最好',
    kind: 'image',
    textEndpoint: 'rhart-image-n-pro/text-to-image',
    imageEndpoint: 'rhart-image-n-pro/edit',
  },
  {
    // 官方目录：全能图片V2
    id: 'Nano Banana 2',
    hint: '香蕉2同款，最快最便宜',
    kind: 'image',
    textEndpoint: 'rhart-image-n-g31-flash/text-to-image',
    imageEndpoint: 'rhart-image-n-g31-flash/image-to-image',
  },
  {
    // 官方目录：悠船 v7
    id: 'Midjourney',
    hint: 'Midjourney 风格，欧美大片质感；本身不支持图生图，带参考图时自动走全能图片PRO',
    kind: 'image',
    textEndpoint: 'youchuan/text-to-image-v7',
    imageEndpoint: 'rhart-image-n-pro/edit',
  },
  {
    // 官方目录：全能图片G-2.0（GPT Image 2）
    id: 'GPT Image 2',
    hint: 'GPT Image 2 同款，语义理解强，改图也稳',
    kind: 'image',
    textEndpoint: 'rhart-image-g-2/text-to-image',
    imageEndpoint: 'rhart-image-g-2/image-to-image',
  },
  {
    // 官方目录：Seedream v5
    id: 'Seedream v5',
    hint: '字节出品，写实照片感强',
    kind: 'image',
    textEndpoint: 'seedream-v5-lite/text-to-image',
    imageEndpoint: 'seedream-v5-lite/image-to-image',
  },
  {
    // 官方目录：全能图片X-3（图生图）
    id: '全能图片X-3（图生图）',
    hint: '只吃参考图（必须连一张图进来），按提示词改图',
    kind: 'image',
    textEndpoint: 'rhart-image-g-3/image-to-image',
  },
  {
    // 官方目录：全能图片PRO（图生图·官方稳定版）
    id: '全能图片PRO（图生图·官方稳定版）',
    hint: '只吃参考图（必须连一张图进来），官方稳定版',
    kind: 'image',
    textEndpoint: 'rhart-image-n-pro-official/edit',
  },
  {
    // 官方目录：全能图片PRO Ultra（图像编辑）
    id: '全能图片PRO Ultra（图像编辑）',
    hint: '官方 Ultra 图生图，4K / 8K 输出，适合高精度商品改图',
    kind: 'image',
    textEndpoint: 'rhart-image-n-pro-official/edit-ultra',
  },
  {
    // 官方目录：千问 2.0 Pro 图像编辑
    id: '千问 2.0 Pro 图像编辑',
    hint: '官方千问 2.0 Pro 图生图，最多 3 张参考图；尺寸由服务端默认',
    kind: 'image',
    textEndpoint: 'alibaba/qwen-image-2.0-pro/image-edit',
  },
  {
    // 官方目录：万相2.7 图像编辑
    id: '万相2.7 图像编辑',
    hint: '官方万相 2.7 图生图，最多 9 张参考图，提示词驱动编辑',
    kind: 'image',
    textEndpoint: 'alibaba/wan-2.7/image-edit',
  },
  {
    // 官方目录：万相 2.7 图像编辑 Pro
    id: '万相 2.7 图像编辑 Pro',
    hint: '官方万相 2.7 Pro 图生图，最多 9 张参考图，提示词驱动编辑',
    kind: 'image',
    textEndpoint: 'alibaba/wan-2.7/image-edit-pro',
  },
  {
    // 官方目录：Luma Uni-1 图像编辑
    id: 'Luma Uni-1 图像编辑',
    hint: '官方 Luma Uni-1 图生图，支持九档画幅',
    kind: 'image',
    textEndpoint: 'luma/uni-1/image-edit',
  },
  {
    // 官方目录：Luma Uni-1 Max 图像编辑
    id: 'Luma Uni-1 Max 图像编辑',
    hint: '官方 Luma Uni-1 Max 图生图，支持 3:1 到 1:3 共九档画幅',
    kind: 'image',
    textEndpoint: 'luma/uni-1-max/image-edit',
  },
  {
    // 官方目录：全能图片X 图片编辑
    id: '全能图片X 图片编辑',
    hint: '官方全能图片 X 单图编辑，支持长指令',
    kind: 'image',
    textEndpoint: 'rhart-image-x-official/edit',
  },
  {
    // 官方目录：全能图片X-4 图生图
    id: '全能图片X-4 图生图',
    hint: '全能图片 X-4 图生图，按提示词修改输入图片',
    kind: 'image',
    textEndpoint: 'rhart-image-g-4/image-to-image',
  },
  {
    // 官方目录：千问 2.0 文生图
    id: '千问 2.0 文生图',
    hint: '通义千问图片模型；尺寸档位官方写作像素（应用里暂不发尺寸，服务端默认）',
    kind: 'image',
    textEndpoint: 'alibaba/qwen-image-2.0/text-to-image',
  },
  {
    // 官方目录：即梦图片 4.6
    id: '即梦图片 4.6',
    hint: '字节即梦 4.6；文生图与图生图都接，宽高档位由服务端默认',
    kind: 'image',
    textEndpoint: 'bytedance/jimeng-4.6/text-to-image',
    imageEndpoint: 'bytedance/jimeng-4.6/image-to-image',
  },
  {
    // 官方目录：全能视频V3.1 Fast
    id: '全能视频V3.1 Fast',
    hint: '又快又好，性价比之王',
    kind: 'video',
    textEndpoint: 'rhart-video-v3.1-fast/text-to-video',
    imageEndpoint: 'rhart-video-v3.1-fast/image-to-video',
  },
  {
    // 官方目录：全能视频X
    id: '全能视频X',
    hint: 'Grok 驱动，画面想象力强',
    kind: 'video',
    textEndpoint: 'rhart-video-g/text-to-video',
    imageEndpoint: 'rhart-video-g/image-to-video',
  },
  {
    // 官方目录：可灵 v3.0 Pro
    id: '可灵 v3.0 Pro',
    hint: '运动自然，拍人物选它',
    kind: 'video',
    textEndpoint: 'kling-v3.0-pro/text-to-video',
    imageEndpoint: 'kling-v3.0-pro/image-to-video',
  },
  {
    // 官方目录：全能视频V3.1 Pro
    id: '全能视频V3.1 Pro',
    hint: '电影感拉满，适合风景大片',
    kind: 'video',
    textEndpoint: 'rhart-video-v3.1-pro/text-to-video',
    imageEndpoint: 'rhart-video-v3.1-pro/image-to-video',
  },
  {
    // 官方目录：Vidu Q3 Pro
    id: 'Vidu Q3 Pro',
    hint: '风格化独特，适合创意短片',
    kind: 'video',
    textEndpoint: 'vidu/text-to-video-q3-pro',
    imageEndpoint: 'vidu/image-to-video-q3-pro',
  },
  {
    // 官方目录：全能视频S
    id: '全能视频S',
    hint: 'Sora 同款引擎，模型负载高时可能要多等一会儿',
    kind: 'video',
    textEndpoint: 'rhart-video-s/text-to-video',
    imageEndpoint: 'rhart-video-s/image-to-video',
  },
  {
    // 官方目录：海螺 Hailuo
    id: '海螺 Hailuo',
    hint: '速度快画面细腻',
    kind: 'video',
    textEndpoint: 'minimax/hailuo-02/t2v-pro',
    imageEndpoint: 'minimax/hailuo-2.3-fast/image-to-video',
  },
  {
    // 官方目录：Seedance 2.0
    id: 'Seedance 2.0',
    hint: '最长 15 秒＋自动配音，最高 4K，价格偏高',
    kind: 'video',
    textEndpoint: 'rhart-video/sparkvideo-2.0/text-to-video',
    imageEndpoint: 'rhart-video/sparkvideo-2.0/image-to-video',
  },
  {
    // 官方目录：Topaz 图像超清 Standard
    id: 'Topaz 图像超清 Standard',
    hint: '通用 2x / 4x / 6x 无损放大，适合大多数商品图',
    kind: 'image',
    textEndpoint: 'topazlabs/image-upscale-standard-v2',
  },
  {
    // 官方目录：Topaz 图像超清 High Fidelity
    id: 'Topaz 图像超清 High Fidelity',
    hint: '更强调纹理与细节保真，适合高分辨率商品图',
    kind: 'image',
    textEndpoint: 'topazlabs/image-upscale-high-fidelity-v2',
  },
  {
    // 官方目录：Topaz 图像超清 Low Resolution
    id: 'Topaz 图像超清 Low Resolution',
    hint: '针对低清晰度、压缩痕迹较重的图片',
    kind: 'image',
    textEndpoint: 'topazlabs/image-upscale/low-resolution-v2',
  },
  {
    // 官方目录：Topaz 图像超清 CGI
    id: 'Topaz 图像超清 CGI',
    hint: '适合渲染图、3D 商品图和干净几何边缘',
    kind: 'image',
    textEndpoint: 'topazlabs/image-upscale-cgi',
  },
  {
    // 官方目录：Topaz 图像超清 Text Refine
    id: 'Topaz 图像超清 Text Refine',
    hint: '优先保护文字边缘，适合带卖点文案的商品图',
    kind: 'image',
    textEndpoint: 'topazlabs/image-upscale-text-refine',
  },
  {
    // 官方目录：Kling V2 Std 数字人口播视频
    id: 'Kling V2 数字人口播 Std',
    hint: '一张人物图 + 一句配音生成口型同步视频；必须同时有图与音频',
    kind: 'video',
    textEndpoint: 'kling-v2-ai-avatar-standard/image-audio-to-video',
    imageEndpoint: 'kling-v2-ai-avatar-standard/image-audio-to-video',
  },
  {
    // 官方目录：Kling V2 Pro 数字人口播视频
    id: 'Kling V2 数字人口播 Pro',
    hint: '一张人物图 + 一句配音生成口型同步视频；Pro 档更稳，价格更高',
    kind: 'video',
    textEndpoint: 'kling-v2-ai-avatar-pro/image-audio-to-video',
    imageEndpoint: 'kling-v2-ai-avatar-pro/image-audio-to-video',
  },
  {
    // 官方目录：Topaz 视频超清
    id: 'Topaz 视频超清',
    hint: '把已有视频放大到 720p / 1080p / 4K，可选 30 / 60fps',
    kind: 'video',
    textEndpoint: 'topazlabs/video-upscale',
  },
  {
    // 官方目录：RH 视频超分
    id: 'RH 视频超分',
    hint: '把已有视频放大到 720p / 1080p / 2K / 4K',
    kind: 'video',
    textEndpoint: 'rhart-video/video-upscaler',
  },
  {
    // 官方目录：全能视频X 视频编辑
    id: '全能视频X 视频编辑',
    hint: '用文字指令修改已有视频的画面、风格或动作，保留原镜头节奏',
    kind: 'video',
    textEndpoint: 'rhart-video-g-official/edit-video',
  },
  {
    // 官方目录：Kling O3 Pro 视频编辑
    id: 'Kling O3 Pro 视频编辑',
    hint: '可灵 O3 Pro 官方视频编辑，默认保持原声，可参考当前镜头画面',
    kind: 'video',
    textEndpoint: 'kling-video-o3-pro/video-edit',
  },
  {
    // 官方目录：Kling O3 Std 视频编辑
    id: 'Kling O3 Std 视频编辑',
    hint: '可灵 O3 Std 官方视频编辑，默认保持原声，可参考当前镜头画面',
    kind: 'video',
    textEndpoint: 'kling-video-o3-std/video-edit',
  },
  {
    // 官方目录：Kling O1 Std 视频编辑
    id: 'Kling O1 Std 视频编辑',
    hint: '可灵 O1 Std 官方视频编辑，默认保持原声，可参考当前镜头画面',
    kind: 'video',
    textEndpoint: 'kling-video-o1-std/edit-video',
  },
  {
    // 官方目录：全能视频 Omni Flash 视频编辑
    id: '全能视频 Omni Flash 视频编辑',
    hint: 'RunningHub Omni Flash 视频编辑，可参考当前画面，支持 720p / 1080p / 4K',
    kind: 'video',
    textEndpoint: 'gemini-omni-flash/video-edit',
  },
  {
    // 官方目录：HappyHorse 1.0 视频编辑
    id: 'HappyHorse 1.0 视频编辑',
    hint: 'HappyHorse 1.0 官方视频编辑，可参考当前画面，支持 720p / 1080p',
    kind: 'video',
    textEndpoint: 'alibaba/happyhorse-1.0/video-edit',
  },
  {
    // 官方目录：全能视频R Gen4 Aleph 视频编辑
    id: '全能视频R Gen4 Aleph 视频编辑',
    hint: 'RunningHub Gen4 Aleph 官方视频编辑，可参考当前镜头画面',
    kind: 'video',
    textEndpoint: 'rhart-video-r/gen4-aleph-official/video-to-video',
  },
  {
    // 官方目录：万相2.7 视频编辑
    id: '万相2.7 视频编辑',
    hint: '结合当前镜头画面编辑已有视频，可选 720P / 1080P',
    kind: 'video',
    textEndpoint: 'alibaba/wan-2.7/video-edit',
  },
  {
    // 官方目录：万相2.7 视频续写
    id: '万相2.7 视频续写',
    hint: '沿已有视频继续生成后续动作与镜头，可选 2–15 秒',
    kind: 'video',
    textEndpoint: 'alibaba/wan-2.7/video-extend',
  },
  {
    // 官方目录：全能视频X 视频续写
    id: '全能视频X 视频续写',
    hint: '沿已有视频继续生成后续动作与镜头，可选 6 / 10 秒',
    kind: 'video',
    textEndpoint: 'rhart-video-g-official/video-extend',
  },
  {
    // 官方目录：全能视频V3.1 Pro 视频扩展
    id: '全能视频V3.1 Pro 视频扩展',
    hint: '沿已有视频扩展后续镜头，可选 720p / 1080p',
    kind: 'video',
    textEndpoint: 'rhart-video-v3.1-pro-official/video-extend',
  },
  {
    // 官方目录：全能视频V3.1 Fast 视频扩展
    id: '全能视频V3.1 Fast 视频扩展',
    hint: '沿已有视频快速扩展后续镜头，可选 720p / 1080p',
    kind: 'video',
    textEndpoint: 'rhart-video-v3.1-fast-official/video-extend',
  },
]
