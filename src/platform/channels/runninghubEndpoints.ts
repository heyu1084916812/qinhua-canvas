/**
 * RunningHub 标准模型端点规格（**自动生成，别手改**）
 *
 * 生成：`node scripts/gen-runninghub-models.mjs <RH_CLI>/src/rh_cli/catalog/data/capabilities.json`
 * 来源：RunningHub 官方 CLI（github.com/HM-RunningHub/RH_CLI）随包附带的端点目录
 *       capabilities.json —— version 2026-06-02，共 356 个端点；
 *       本文件只留**精挑的 29 个端点**（官方 CLI 的 13 个快捷选择 + 之前已交付的 4 个）。
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
  /** 比例、清晰度、时长：键名各端点不同（`aspectRatio` / `ratio`…），故逐个记 */
  ratio?: RunningHubDrivenParam
  resolution?: RunningHubDrivenParam
  duration?: RunningHubDrivenParam
  /** 必填且界面上没有对应档位的参数（键 → 照官方目录的默认值原样补） */
  requiredDefaults?: Record<string, unknown>
}

/** 精挑的端点规格（key = 端点 id） */
export const RUNNINGHUB_ENDPOINT_SPECS: readonly RunningHubEndpointSpec[] = [
  {
    id: 'alibaba/qwen-image-2.0/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '千问2.0-文生图',
    promptKey: 'prompt',
  },
  {
    id: 'bytedance/jimeng-4.6/text-to-image',
    task: 'text-to-image',
    kind: 'image',
    label: '即梦图片 4.6 文生图',
    promptKey: 'prompt',
  },
  {
    id: 'kling-v3.0-pro/image-to-video',
    task: 'image-to-video',
    kind: 'video',
    label: '可灵图生视频3.0-pro',
    promptKey: 'prompt',
    media: { "key": "firstImageUrl", "type": "IMAGE", "required": true },
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
    id: '全能图片PRO',
    hint: '香蕉Pro同款，默认推荐，综合效果最好',
    kind: 'image',
    textEndpoint: 'rhart-image-n-pro/text-to-image',
    imageEndpoint: 'rhart-image-n-pro/edit',
  },
  {
    id: '全能图片V2',
    hint: '香蕉2同款，最快最便宜',
    kind: 'image',
    textEndpoint: 'rhart-image-n-g31-flash/text-to-image',
    imageEndpoint: 'rhart-image-n-g31-flash/image-to-image',
  },
  {
    id: '悠船 v7',
    hint: 'Midjourney 风格，欧美大片质感；本身不支持图生图，带参考图时自动走全能图片PRO',
    kind: 'image',
    textEndpoint: 'youchuan/text-to-image-v7',
    imageEndpoint: 'rhart-image-n-pro/edit',
  },
  {
    id: '全能图片G-2.0（GPT Image 2）',
    hint: 'GPT Image 2 同款，语义理解强，改图也稳',
    kind: 'image',
    textEndpoint: 'rhart-image-g-2/text-to-image',
    imageEndpoint: 'rhart-image-g-2/image-to-image',
  },
  {
    id: 'Seedream v5',
    hint: '字节出品，写实照片感强',
    kind: 'image',
    textEndpoint: 'seedream-v5-lite/text-to-image',
    imageEndpoint: 'seedream-v5-lite/image-to-image',
  },
  {
    id: '全能图片X-3（图生图）',
    hint: '只吃参考图（必须连一张图进来），按提示词改图',
    kind: 'image',
    textEndpoint: 'rhart-image-g-3/image-to-image',
  },
  {
    id: '全能图片PRO（图生图·官方稳定版）',
    hint: '只吃参考图（必须连一张图进来），官方稳定版',
    kind: 'image',
    textEndpoint: 'rhart-image-n-pro-official/edit',
  },
  {
    id: '千问 2.0 文生图',
    hint: '通义千问图片模型；尺寸档位官方写作像素（应用里暂不发尺寸，服务端默认）',
    kind: 'image',
    textEndpoint: 'alibaba/qwen-image-2.0/text-to-image',
  },
  {
    id: '即梦图片 4.6',
    hint: '字节即梦 4.6；宽高档位官方写作像素（应用里暂不发尺寸，服务端默认）',
    kind: 'image',
    textEndpoint: 'bytedance/jimeng-4.6/text-to-image',
  },
  {
    id: '全能视频V3.1 Fast',
    hint: '又快又好，性价比之王',
    kind: 'video',
    textEndpoint: 'rhart-video-v3.1-fast/text-to-video',
    imageEndpoint: 'rhart-video-v3.1-fast/image-to-video',
  },
  {
    id: '全能视频X',
    hint: 'Grok 驱动，画面想象力强',
    kind: 'video',
    textEndpoint: 'rhart-video-g/text-to-video',
    imageEndpoint: 'rhart-video-g/image-to-video',
  },
  {
    id: '可灵 v3.0 Pro',
    hint: '运动自然，拍人物选它',
    kind: 'video',
    textEndpoint: 'kling-v3.0-pro/text-to-video',
    imageEndpoint: 'kling-v3.0-pro/image-to-video',
  },
  {
    id: '全能视频V3.1 Pro',
    hint: '电影感拉满，适合风景大片',
    kind: 'video',
    textEndpoint: 'rhart-video-v3.1-pro/text-to-video',
    imageEndpoint: 'rhart-video-v3.1-pro/image-to-video',
  },
  {
    id: 'Vidu Q3 Pro',
    hint: '风格化独特，适合创意短片',
    kind: 'video',
    textEndpoint: 'vidu/text-to-video-q3-pro',
    imageEndpoint: 'vidu/image-to-video-q3-pro',
  },
  {
    id: '全能视频S',
    hint: 'Sora 同款引擎，模型负载高时可能要多等一会儿',
    kind: 'video',
    textEndpoint: 'rhart-video-s/text-to-video',
    imageEndpoint: 'rhart-video-s/image-to-video',
  },
  {
    id: '海螺 Hailuo',
    hint: '速度快画面细腻',
    kind: 'video',
    textEndpoint: 'minimax/hailuo-02/t2v-pro',
    imageEndpoint: 'minimax/hailuo-2.3-fast/image-to-video',
  },
  {
    id: 'Seedance 2.0',
    hint: '最长 15 秒＋自动配音，最高 4K，价格偏高',
    kind: 'video',
    textEndpoint: 'rhart-video/sparkvideo-2.0/text-to-video',
    imageEndpoint: 'rhart-video/sparkvideo-2.0/image-to-video',
  },
]
