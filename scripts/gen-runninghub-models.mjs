/**
 * 从 **RunningHub 官方 CLI 的端点目录**生成 `src/platform/channels/runninghubEndpoints.ts`。
 *
 * 用法：
 *   node scripts/gen-runninghub-models.mjs <capabilities.json 的路径>
 *
 * 那个文件来自官方 CLI 仓库（github.com/HM-RunningHub/RH_CLI）：
 *   <repo>/src/rh_cli/catalog/data/capabilities.json
 * 它随 CLI 一起发布、由 CLI 自己加载（`catalog/loader.py`），所以是**权威目录**，
 * 比手抄官网表格可靠。
 *
 * ## 为什么要生成而不是直接读目录
 *
 * 运行时要的是"发请求要哪些 key、哪些必填、默认值是什么"，而目录是 625KB / 356 个端点；
 * 应用只做我们**精挑的那几十个**端点。把用得到的那一份**烘进仓库**，
 * 运行时就没有外部依赖（也不用在启动时解析大 JSON）。
 *
 * ## 抽取规则（与官方 CLI 的 `model/payload.py` 对齐）
 *
 * 官方 CLI 建请求体时，最后一步是：**凡是「必填 + 有默认值」而还没填的参数，一律补上默认值**。
 * 本生成器据此只保留三类参数：
 *   ① 必填参数（含默认值 / 可选项）—— 差值由适配器补；
 *   ② 界面能驱动的档位参数（比例 `aspectRatio`/`ratio`、清晰度 `resolution`、时长 `duration`）；
 *   ③ IMAGE / VIDEO / AUDIO 类媒体参数（键名与是否多值）。
 * 其余"可选且有默认值"的参数**不写进表**：官方 CLI 也不填它们，交给服务端默认。
 */

import { readFileSync, writeFileSync } from 'node:fs'

const [, , catalogPath] = process.argv
if (!catalogPath) {
  console.error('用法：node scripts/gen-runninghub-models.mjs <capabilities.json>')
  process.exit(1)
}

/**
 * 精选模型（这一层是**编辑判断**，不是目录里现成的字段）。
 *
 * 依据是官方 CLI 的 `model/menus.py`：它把 356 个端点收敛成
 * 5 个图片 + 8 个视频的"快捷选择"，每个选择带**文生 / 图生两个端点**，
 * 有参考图就走图生那个（`endpoint_for_choice(choice, has_input_image=...)`）。
 * 这里照抄那 13 个选择，并保留之前已经交付的 4 个端点（千问 2.0 / 即梦 4.6 /
 * X-3 图生图 / PRO 官方稳定版图生图），免得用户的模型清单反而变短。
 */
const MODELS = [
  {
    slug: 'image-pro',
    label: '全能图片PRO',
    /** 官方 CLI 原话「香蕉Pro同款」⇒ 挂到用户固定清单的显示名下（界面上只有那里有它的位置） */
    preset: 'Nano Banana Pro',
    hint: '香蕉Pro同款，默认推荐，综合效果最好',
    kind: 'image',
    text: 'rhart-image-n-pro/text-to-image',
    image: 'rhart-image-n-pro/edit',
  },
  {
    slug: 'image-v2',
    label: '全能图片V2',
    /** 官方 CLI 原话「香蕉2同款」 */
    preset: 'Nano Banana 2',
    hint: '香蕉2同款，最快最便宜',
    kind: 'image',
    text: 'rhart-image-n-g31-flash/text-to-image',
    image: 'rhart-image-n-g31-flash/image-to-image',
  },
  {
    slug: 'image-youchuan',
    label: '悠船 v7',
    /** 官方 CLI 原话「Midjourney 风格」 */
    preset: 'Midjourney',
    hint: 'Midjourney 风格，欧美大片质感；本身不支持图生图，带参考图时自动走全能图片PRO',
    kind: 'image',
    text: 'youchuan/text-to-image-v7',
    image: 'rhart-image-n-pro/edit',
  },
  {
    slug: 'image-gpt2',
    label: '全能图片G-2.0（GPT Image 2）',
    /** 官方 CLI 原话「GPT Image 2 同款」 */
    preset: 'GPT Image 2',
    hint: 'GPT Image 2 同款，语义理解强，改图也稳',
    kind: 'image',
    text: 'rhart-image-g-2/text-to-image',
    image: 'rhart-image-g-2/image-to-image',
  },
  {
    slug: 'image-seedream',
    label: 'Seedream v5',
    hint: '字节出品，写实照片感强',
    kind: 'image',
    text: 'seedream-v5-lite/text-to-image',
    image: 'seedream-v5-lite/image-to-image',
  },
  {
    slug: 'image-g3-i2i',
    label: '全能图片X-3（图生图）',
    hint: '只吃参考图（必须连一张图进来），按提示词改图',
    kind: 'image',
    text: 'rhart-image-g-3/image-to-image',
  },
  {
    slug: 'image-pro-official-i2i',
    label: '全能图片PRO（图生图·官方稳定版）',
    hint: '只吃参考图（必须连一张图进来），官方稳定版',
    kind: 'image',
    text: 'rhart-image-n-pro-official/edit',
  },
  {
    slug: 'image-pro-official-i2i-ultra',
    label: '全能图片PRO Ultra（图像编辑）',
    hint: '官方 Ultra 图生图，4K / 8K 输出，适合高精度商品改图',
    kind: 'image',
    text: 'rhart-image-n-pro-official/edit-ultra',
  },
  {
    slug: 'image-qwen-edit-pro',
    label: '千问 2.0 Pro 图像编辑',
    hint: '官方千问 2.0 Pro 图生图，最多 3 张参考图；尺寸由服务端默认',
    kind: 'image',
    text: 'alibaba/qwen-image-2.0-pro/image-edit',
  },
  {
    slug: 'image-wan-edit',
    label: '万相2.7 图像编辑',
    hint: '官方万相 2.7 图生图，最多 9 张参考图，提示词驱动编辑',
    kind: 'image',
    text: 'alibaba/wan-2.7/image-edit',
  },
  {
    slug: 'image-wan-edit-pro',
    label: '万相 2.7 图像编辑 Pro',
    hint: '官方万相 2.7 Pro 图生图，最多 9 张参考图，提示词驱动编辑',
    kind: 'image',
    text: 'alibaba/wan-2.7/image-edit-pro',
  },
  {
    slug: 'image-luma-uni-edit',
    label: 'Luma Uni-1 图像编辑',
    hint: '官方 Luma Uni-1 图生图，支持九档画幅',
    kind: 'image',
    text: 'luma/uni-1/image-edit',
  },
  {
    slug: 'image-luma-uni-max-edit',
    label: 'Luma Uni-1 Max 图像编辑',
    hint: '官方 Luma Uni-1 Max 图生图，支持 3:1 到 1:3 共九档画幅',
    kind: 'image',
    text: 'luma/uni-1-max/image-edit',
  },
  {
    slug: 'image-x-official-edit',
    label: '全能图片X 图片编辑',
    hint: '官方全能图片 X 单图编辑，支持长指令',
    kind: 'image',
    text: 'rhart-image-x-official/edit',
  },
  {
    slug: 'image-g4-i2i',
    label: '全能图片X-4 图生图',
    hint: '全能图片 X-4 图生图，按提示词修改输入图片',
    kind: 'image',
    text: 'rhart-image-g-4/image-to-image',
  },
  {
    slug: 'image-qwen',
    label: '千问 2.0 文生图',
    hint: '通义千问图片模型；尺寸档位官方写作像素（应用里暂不发尺寸，服务端默认）',
    kind: 'image',
    text: 'alibaba/qwen-image-2.0/text-to-image',
  },
  {
    slug: 'image-jimeng',
    label: '即梦图片 4.6',
    hint: '字节即梦 4.6；文生图与图生图都接，宽高档位由服务端默认',
    kind: 'image',
    text: 'bytedance/jimeng-4.6/text-to-image',
    image: 'bytedance/jimeng-4.6/image-to-image',
  },
  {
    slug: 'video-fast',
    label: '全能视频V3.1 Fast',
    hint: '又快又好，性价比之王',
    kind: 'video',
    text: 'rhart-video-v3.1-fast/text-to-video',
    image: 'rhart-video-v3.1-fast/image-to-video',
  },
  {
    slug: 'video-x',
    label: '全能视频X',
    hint: 'Grok 驱动，画面想象力强',
    kind: 'video',
    text: 'rhart-video-g/text-to-video',
    image: 'rhart-video-g/image-to-video',
  },
  {
    slug: 'video-kling',
    label: '可灵 v3.0 Pro',
    hint: '运动自然，拍人物选它',
    kind: 'video',
    text: 'kling-v3.0-pro/text-to-video',
    image: 'kling-v3.0-pro/image-to-video',
  },
  {
    slug: 'video-pro',
    label: '全能视频V3.1 Pro',
    hint: '电影感拉满，适合风景大片',
    kind: 'video',
    text: 'rhart-video-v3.1-pro/text-to-video',
    image: 'rhart-video-v3.1-pro/image-to-video',
  },
  {
    slug: 'video-vidu',
    label: 'Vidu Q3 Pro',
    hint: '风格化独特，适合创意短片',
    kind: 'video',
    text: 'vidu/text-to-video-q3-pro',
    image: 'vidu/image-to-video-q3-pro',
  },
  {
    slug: 'video-s',
    label: '全能视频S',
    hint: 'Sora 同款引擎，模型负载高时可能要多等一会儿',
    kind: 'video',
    text: 'rhart-video-s/text-to-video',
    image: 'rhart-video-s/image-to-video',
  },
  {
    slug: 'video-hailuo',
    label: '海螺 Hailuo',
    hint: '速度快画面细腻',
    kind: 'video',
    text: 'minimax/hailuo-02/t2v-pro',
    image: 'minimax/hailuo-2.3-fast/image-to-video',
  },
  {
    slug: 'video-seedance',
    label: 'Seedance 2.0',
    hint: '最长 15 秒＋自动配音，最高 4K，价格偏高',
    kind: 'video',
    text: 'rhart-video/sparkvideo-2.0/text-to-video',
    image: 'rhart-video/sparkvideo-2.0/image-to-video',
  },
  {
    slug: 'image-topaz-upscale-standard',
    label: 'Topaz 图像超清 Standard',
    preset: 'Topaz 图像超清 Standard',
    hint: '通用 2x / 4x / 6x 无损放大，适合大多数商品图',
    kind: 'image',
    text: 'topazlabs/image-upscale-standard-v2',
  },
  {
    slug: 'image-topaz-upscale-high-fidelity',
    label: 'Topaz 图像超清 High Fidelity',
    preset: 'Topaz 图像超清 High Fidelity',
    hint: '更强调纹理与细节保真，适合高分辨率商品图',
    kind: 'image',
    text: 'topazlabs/image-upscale-high-fidelity-v2',
  },
  {
    slug: 'image-topaz-upscale-low-resolution',
    label: 'Topaz 图像超清 Low Resolution',
    preset: 'Topaz 图像超清 Low Resolution',
    hint: '针对低清晰度、压缩痕迹较重的图片',
    kind: 'image',
    text: 'topazlabs/image-upscale/low-resolution-v2',
  },
  {
    slug: 'image-topaz-upscale-cgi',
    label: 'Topaz 图像超清 CGI',
    preset: 'Topaz 图像超清 CGI',
    hint: '适合渲染图、3D 商品图和干净几何边缘',
    kind: 'image',
    text: 'topazlabs/image-upscale-cgi',
  },
  {
    slug: 'image-topaz-upscale-text-refine',
    label: 'Topaz 图像超清 Text Refine',
    preset: 'Topaz 图像超清 Text Refine',
    hint: '优先保护文字边缘，适合带卖点文案的商品图',
    kind: 'image',
    text: 'topazlabs/image-upscale-text-refine',
  },
  {
    slug: 'video-kling-avatar-std',
    label: 'Kling V2 Std 数字人口播视频',
    preset: 'Kling V2 数字人口播 Std',
    hint: '一张人物图 + 一句配音生成口型同步视频；必须同时有图与音频',
    kind: 'video',
    text: 'kling-v2-ai-avatar-standard/image-audio-to-video',
    image: 'kling-v2-ai-avatar-standard/image-audio-to-video',
  },
  {
    slug: 'video-kling-avatar-pro',
    label: 'Kling V2 Pro 数字人口播视频',
    preset: 'Kling V2 数字人口播 Pro',
    hint: '一张人物图 + 一句配音生成口型同步视频；Pro 档更稳，价格更高',
    kind: 'video',
    text: 'kling-v2-ai-avatar-pro/image-audio-to-video',
    image: 'kling-v2-ai-avatar-pro/image-audio-to-video',
  },
  {
    slug: 'video-topaz-video-upscale',
    label: 'Topaz 视频超清',
    preset: 'Topaz 视频超清',
    hint: '把已有视频放大到 720p / 1080p / 4K，可选 30 / 60fps',
    kind: 'video',
    text: 'topazlabs/video-upscale',
  },
  {
    slug: 'video-rh-video-upscaler',
    label: 'RH 视频超分',
    preset: 'RH 视频超分',
    hint: '把已有视频放大到 720p / 1080p / 2K / 4K',
    kind: 'video',
    text: 'rhart-video/video-upscaler',
  },
  {
    slug: 'video-rh-g-edit',
    label: '全能视频X 视频编辑',
    preset: '全能视频X 视频编辑',
    hint: '用文字指令修改已有视频的画面、风格或动作，保留原镜头节奏',
    kind: 'video',
    text: 'rhart-video-g-official/edit-video',
  },
  {
    slug: 'video-kling-o3-pro-edit',
    label: 'Kling O3 Pro 视频编辑',
    hint: '可灵 O3 Pro 官方视频编辑，默认保持原声，可参考当前镜头画面',
    kind: 'video',
    text: 'kling-video-o3-pro/video-edit',
  },
  {
    slug: 'video-kling-o3-std-edit',
    label: 'Kling O3 Std 视频编辑',
    hint: '可灵 O3 Std 官方视频编辑，默认保持原声，可参考当前镜头画面',
    kind: 'video',
    text: 'kling-video-o3-std/video-edit',
  },
  {
    slug: 'video-kling-o1-std-edit',
    label: 'Kling O1 Std 视频编辑',
    hint: '可灵 O1 Std 官方视频编辑，默认保持原声，可参考当前镜头画面',
    kind: 'video',
    text: 'kling-video-o1-std/edit-video',
  },
  {
    slug: 'video-omni-flash-edit',
    label: '全能视频 Omni Flash 视频编辑',
    hint: 'RunningHub Omni Flash 视频编辑，可参考当前画面，支持 720p / 1080p / 4K',
    kind: 'video',
    text: 'gemini-omni-flash/video-edit',
  },
  {
    slug: 'video-happyhorse-edit',
    label: 'HappyHorse 1.0 视频编辑',
    hint: 'HappyHorse 1.0 官方视频编辑，可参考当前画面，支持 720p / 1080p',
    kind: 'video',
    text: 'alibaba/happyhorse-1.0/video-edit',
  },
  {
    slug: 'video-gen4-aleph-edit',
    label: '全能视频R Gen4 Aleph 视频编辑',
    hint: 'RunningHub Gen4 Aleph 官方视频编辑，可参考当前镜头画面',
    kind: 'video',
    text: 'rhart-video-r/gen4-aleph-official/video-to-video',
  },
  {
    slug: 'video-wan-edit',
    label: '万相2.7 视频编辑',
    hint: '结合当前镜头画面编辑已有视频，可选 720P / 1080P',
    kind: 'video',
    text: 'alibaba/wan-2.7/video-edit',
  },
  {
    slug: 'video-wan-extend',
    label: '万相2.7 视频续写',
    preset: '万相2.7 视频续写',
    hint: '沿已有视频继续生成后续动作与镜头，可选 2–15 秒',
    kind: 'video',
    text: 'alibaba/wan-2.7/video-extend',
  },
  {
    slug: 'video-rh-g-extend',
    label: '全能视频X 视频续写',
    hint: '沿已有视频继续生成后续动作与镜头，可选 6 / 10 秒',
    kind: 'video',
    text: 'rhart-video-g-official/video-extend',
  },
  {
    slug: 'video-rh-v31-pro-extend',
    label: '全能视频V3.1 Pro 视频扩展',
    hint: '沿已有视频扩展后续镜头，可选 720p / 1080p',
    kind: 'video',
    text: 'rhart-video-v3.1-pro-official/video-extend',
  },
  {
    slug: 'video-rh-v31-fast-extend',
    label: '全能视频V3.1 Fast 视频扩展',
    hint: '沿已有视频快速扩展后续镜头，可选 720p / 1080p',
    kind: 'video',
    text: 'rhart-video-v3.1-fast-official/video-extend',
  },
]

/** 界面能驱动的档位参数 → 它在端点规格里的角色 */
const DRIVEN = {
  aspectRatio: 'ratio',
  ratio: 'ratio',
  resolution: 'resolution',
  targetResolution: 'resolution',
  duration: 'duration',
  scale: 'scale',
  targetFps: 'fps',
}
const MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO'])

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const byId = new Map((catalog.endpoints ?? []).map((e) => [e.endpoint, e]))

const wanted = new Set()
for (const m of MODELS) {
  wanted.add(m.text)
  if (m.image) wanted.add(m.image)
}

/** 每个端点抽一份"发请求要知道的那点东西" */
function specOf(id) {
  const e = byId.get(id)
  if (!e) throw new Error('目录里找不到端点：' + id)
  const params = e.params ?? []
  const spec = {
    id,
    task: e.task,
    kind: e.output_type === 'video' ? 'video' : 'image',
    label: (e.name_cn || e.name_en || id).trim(),
  }
  const prompt = params.find((p) => p.key === 'prompt' || p.key === 'text')
  if (prompt) spec.promptKey = prompt.key
  /**
   * 一个端点最多保留两个媒体槽：主槽 + 次槽。
   *
   * 主槽优先取**必填**媒体，避免 Gemini Omni Flash 这种「可选图片在前、
   * 必填视频在后」的参数顺序把模型认错。次槽用于 Kling / Omni / Gen4 的
   * 可选参考图，也用于图片必填、视频可选的组合。超过两个媒体槽时不猜，
   * 生成阶段直接失败，等运行时契约扩好再接。
   */
  const mediaParams = params.filter((p) => p.type === 'IMAGE' || p.type === 'VIDEO')
  if (mediaParams.slice(2).some((p) => p.required)) {
    throw new Error(`端点 ${id} 有第三个必填媒体槽，当前运行时只支持 2 个`)
  }
  const media =
    mediaParams.find((p) => p.required) ?? mediaParams[0]
  const secondary =
    mediaParams.find((p) => p.key !== media?.key)
  const mediaSpec = (p) => {
    const out = { key: p.key, type: p.type }
    if (p.multiple) out.multiple = true
    if (p.required) out.required = true
    return out
  }
  if (media) spec.media = mediaSpec(media)
  if (secondary) spec.secondaryMedia = mediaSpec(secondary)
  const audio = params.find((p) => p.type === 'AUDIO')
  if (audio) {
    spec.audio = { key: audio.key, type: audio.type }
    if (audio.multiple) spec.audio.multiple = true
    if (audio.required) spec.audio.required = true
  }
  for (const role of ['ratio', 'resolution', 'duration', 'fps']) {
    const p = params.find((x) => DRIVEN[x.key] === role)
    if (p) spec[role] = { key: p.key, ...(p.options ? { options: p.options } : {}) }
  }
  /*
   * `scale` 不是通用生成参数：只有 image-upscale 端点里的同名参数才是放大倍数。
   * 如果只按键名扫，即梦等普通生图里恰好叫 scale 的参数会被误当成 2x/4x/6x。
   */
  if (e.task === 'image-upscale') {
    const p = params.find((x) => DRIVEN[x.key] === 'scale')
    if (p) spec.scale = { key: p.key, ...(p.options ? { options: p.options } : {}) }
  }
  /** 必填参数的默认值：差值由适配器补（与官方 CLI 同一条规则） */
  const defaults = {}
  for (const p of params) {
    if (!p.required) continue
    if (p.key === prompt?.key) continue
    if (MEDIA_TYPES.has(p.type)) continue
    if (p.default === undefined) continue
    defaults[p.key] = p.default
  }
  if (Object.keys(defaults).length > 0) spec.requiredDefaults = defaults
  return spec
}

const specs = [...wanted].map(specOf).sort((a, b) => a.id.localeCompare(b.id))

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const jsonish = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ')

const lines = []
lines.push('/**')
lines.push(' * RunningHub 标准模型端点规格（**自动生成，别手改**）')
lines.push(' *')
lines.push(' * 生成：`node scripts/gen-runninghub-models.mjs <RH_CLI>/src/rh_cli/catalog/data/capabilities.json`')
lines.push(' * 来源：RunningHub 官方 CLI（github.com/HM-RunningHub/RH_CLI）随包附带的端点目录')
lines.push(` *       capabilities.json —— version ${catalog.version}，共 ${catalog.total} 个端点；`)
lines.push(' *       本文件只留**精挑的 ' + specs.length + ' 个端点**（官方 CLI 快捷选择 + 本项目已交付的端点）。')
lines.push(' *')
lines.push(' * 官方 CLI 建请求体的最后一步是「**必填 + 有默认值**而还没填的参数一律补默认值」')
lines.push(' * （`model/payload.py`）—— 适配器照同一条规则走 `requiredDefaults`。')
lines.push(' * 所以这里只保留三类参数：必填的、界面能驱动的（比例 / 清晰度 / 时长）、媒体类（IMAGE……）。')
lines.push(' */')
lines.push('')
lines.push('export interface RunningHubMediaParam {')
lines.push('  key: string')
lines.push("  type: 'IMAGE' | 'VIDEO' | 'AUDIO'")
lines.push('  multiple?: boolean')
lines.push('  required?: boolean')
lines.push('}')
lines.push('')
lines.push('export interface RunningHubDrivenParam {')
lines.push('  key: string')
lines.push('  options?: string[]')
lines.push('}')
lines.push('')
lines.push('export interface RunningHubEndpointSpec {')
lines.push('  id: string')
lines.push('  /** 目录里的任务类型（`text-to-image` / `image-to-video` …），给日志与排查用 */')
lines.push('  task: string')
lines.push("  kind: 'image' | 'video'")
lines.push('  /** 目录里的中文名（原样，不加工） */')
lines.push('  label: string')
lines.push('  /** 提示词参数的键（目录里所有端点都是 `prompt`，仍照实记） */')
lines.push('  promptKey?: string')
lines.push('  /** 参考图 / 视频 / 音频参数的键与是否多值 */')
lines.push('  media?: RunningHubMediaParam')
lines.push('  /** 第二个媒体槽（可选参考图，或图片必填 + 视频可选的组合） */')
lines.push('  secondaryMedia?: RunningHubMediaParam')
  lines.push('  /** 音频输入（数字人口播等端点与图片分开声明） */')
  lines.push('  audio?: RunningHubMediaParam')
lines.push('  /** 比例、清晰度、时长：键名各端点不同（`aspectRatio` / `ratio`…），故逐个记 */')
lines.push('  ratio?: RunningHubDrivenParam')
lines.push('  resolution?: RunningHubDrivenParam')
lines.push('  duration?: RunningHubDrivenParam')
  lines.push('  /** 视频超清的输出帧率（如 Topaz 的 targetFps） */')
  lines.push('  fps?: RunningHubDrivenParam')
  lines.push('  /** 超分类模型的放大倍数（2x / 4x / 6x） */')
  lines.push('  scale?: RunningHubDrivenParam')
lines.push('  /** 必填且界面上没有对应档位的参数（键 → 照官方目录的默认值原样补） */')
lines.push('  requiredDefaults?: Record<string, unknown>')
lines.push('}')
lines.push('')
lines.push('/** 精挑的端点规格（key = 端点 id） */')
lines.push('export const RUNNINGHUB_ENDPOINT_SPECS: readonly RunningHubEndpointSpec[] = [')
for (const s of specs) {
  lines.push('  {')
  const put = (k, v) => lines.push('    ' + k + ': ' + v + ',')
  put('id', q(s.id))
  put('task', q(s.task))
  put('kind', q(s.kind))
  put('label', q(s.label))
  if (s.promptKey) put('promptKey', q(s.promptKey))
  if (s.media) put('media', jsonish(s.media))
  if (s.secondaryMedia) put('secondaryMedia', jsonish(s.secondaryMedia))
  if (s.audio) put('audio', jsonish(s.audio))
  if (s.ratio) put('ratio', jsonish(s.ratio))
  if (s.resolution) put('resolution', jsonish(s.resolution))
  if (s.duration) put('duration', jsonish(s.duration))
    if (s.fps) put('fps', jsonish(s.fps))
  if (s.scale) put('scale', jsonish(s.scale))
  if (s.requiredDefaults) put('requiredDefaults', jsonish(s.requiredDefaults))
  lines.push('  },')
}
lines.push(']')
lines.push('')
lines.push('/** 轻画里出现的模型（下拉里的一行 = 一个模型，不是"一个端点"） */')
lines.push('export interface RunningHubModel {')
lines.push('  /** 轻画的模型 id = **显示名**（下拉里显示的就是它；`app:` 那条是 AI 应用，扣币） */')
lines.push('  id: string')
lines.push('  hint: string')
lines.push("  kind: 'image' | 'video'")
lines.push('  /** 文生…端点（节点没有参考图时走它） */')
lines.push('  textEndpoint: string')
lines.push('  /** 图生…端点（节点连了参考图时走它）；没有这一项表示该模型没有图生档 */')
lines.push('  imageEndpoint?: string')
lines.push('}')
lines.push('')
lines.push('export const RUNNINGHUB_MODELS: readonly RunningHubModel[] = [')
for (const m of MODELS) {
  lines.push('  {')
  /* id = 前端显示名（有对应的就用它，见 MODELS 里的 preset）；官方目录名留一行注释备查 */
  lines.push('    // 官方目录：' + m.label)
  lines.push('    id: ' + q(m.preset ?? m.label) + ',')
  lines.push('    hint: ' + q(m.hint) + ',')
  lines.push('    kind: ' + q(m.kind) + ',')
  lines.push('    textEndpoint: ' + q(m.text) + ',')
  if (m.image) lines.push('    imageEndpoint: ' + q(m.image) + ',')
  lines.push('  },')
}
lines.push(']')
lines.push('')

const out = 'src/platform/channels/runninghubEndpoints.ts'
writeFileSync(out, lines.join('\n'), 'utf8')
console.log('已写出 ' + out + '：端点 ' + specs.length + ' 个、模型 ' + MODELS.length + ' 个')
