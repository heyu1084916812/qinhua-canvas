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
    hint: '香蕉Pro同款，默认推荐，综合效果最好',
    kind: 'image',
    text: 'rhart-image-n-pro/text-to-image',
    image: 'rhart-image-n-pro/edit',
  },
  {
    slug: 'image-v2',
    label: '全能图片V2',
    hint: '香蕉2同款，最快最便宜',
    kind: 'image',
    text: 'rhart-image-n-g31-flash/text-to-image',
    image: 'rhart-image-n-g31-flash/image-to-image',
  },
  {
    slug: 'image-youchuan',
    label: '悠船 v7',
    hint: 'Midjourney 风格，欧美大片质感；本身不支持图生图，带参考图时自动走全能图片PRO',
    kind: 'image',
    text: 'youchuan/text-to-image-v7',
    image: 'rhart-image-n-pro/edit',
  },
  {
    slug: 'image-gpt2',
    label: '全能图片G-2.0（GPT Image 2）',
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
    slug: 'image-qwen',
    label: '千问 2.0 文生图',
    hint: '通义千问图片模型；尺寸档位官方写作像素（应用里暂不发尺寸，服务端默认）',
    kind: 'image',
    text: 'alibaba/qwen-image-2.0/text-to-image',
  },
  {
    slug: 'image-jimeng',
    label: '即梦图片 4.6',
    hint: '字节即梦 4.6；宽高档位官方写作像素（应用里暂不发尺寸，服务端默认）',
    kind: 'image',
    text: 'bytedance/jimeng-4.6/text-to-image',
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
]

/** 界面能驱动的档位参数 → 它在端点规格里的角色 */
const DRIVEN = {
  aspectRatio: 'ratio',
  ratio: 'ratio',
  resolution: 'resolution',
  duration: 'duration',
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
  const media = params.find((p) => MEDIA_TYPES.has(p.type))
  if (media) {
    spec.media = { key: media.key, type: media.type }
    if (media.multiple) spec.media.multiple = true
    if (media.required) spec.media.required = true
  }
  for (const role of ['ratio', 'resolution', 'duration']) {
    const p = params.find((x) => DRIVEN[x.key] === role)
    if (p) spec[role] = { key: p.key, ...(p.options ? { options: p.options } : {}) }
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
lines.push(' *       本文件只留**精挑的 ' + specs.length + ' 个端点**（官方 CLI 的 13 个快捷选择 + 之前已交付的 4 个）。')
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
lines.push('  /** 比例、清晰度、时长：键名各端点不同（`aspectRatio` / `ratio`…），故逐个记 */')
lines.push('  ratio?: RunningHubDrivenParam')
lines.push('  resolution?: RunningHubDrivenParam')
lines.push('  duration?: RunningHubDrivenParam')
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
  if (s.ratio) put('ratio', jsonish(s.ratio))
  if (s.resolution) put('resolution', jsonish(s.resolution))
  if (s.duration) put('duration', jsonish(s.duration))
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
  lines.push('    id: ' + q(m.label) + ',')
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
