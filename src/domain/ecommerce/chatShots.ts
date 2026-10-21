import { extractJsonBlock } from '../shared/jsonBlock'
import { ECOMMERCE_PLATFORMS, platformRuleSummary, type EcommercePlatform } from './platforms'
import { ecommerceShots, type EcommerceShot } from './prompt'
import {
  ECOMMERCE_BASE_RATIOS,
  ECOMMERCE_SMART_RATIO,
  languageLabel,
  usageLabel,
  type EcommerceRequest,
  type EcommerceUsage,
} from './types'

/**
 * **电商分镜的「方案 ②」**（对账 #406，#405 确定性脚本的续作）。
 *
 * 问题：套图 / 详情页的镜头脚本（`prompt.ecommerceShots`）是**固定模板** ——
 * 够用、可预期、不依赖任何模型；但「我做一套母婴水杯的详情页」这种需求里，
 * **卖点顺序应该由商品决定**，模板给不了。
 *
 * 做法：起一次对话请求，把用户那句话 + 平台 / 语言 / 张数扩成 N 条分镜 JSON。
 * **三条硬口径**：
 *
 * 1. **永不因为分镜失败而让用户出不了图**：没配对话模型 / 请求失败 / 条数不对
 *    一律**回落确定性脚本**，并且在界面上**如实说回落了、为什么**；
 * 2. **条数必须完全等于请求张数**：少一条就整批回落 —— 硬把 3 条对到 4 张上，
 *    会出现"某一张按上一张的意思画"，比用默认脚本坏得多（与拆集那条同一口径）；
 * 3. **它是一次额外的付费调用**：界面上要在**点生成之前**就把这件事说清楚
 *    （"这一趟会多花一次对话额度"），不许悄悄多花。
 *
 * 为什么这一层是纯函数：它决定"什么东西能变成用户的拍摄要求"，
 * 与 `chatParse` 同一理由 —— 这条边界必须被单测钉死。
 */

/** 契约里的识别标记（进**真实提示词**，离线 mock 也靠它认出"这一问是分镜扩写"） */
export const ECOMMERCE_SHOTS_MARKER = '【电商分镜扩写】'

/** 单条 title / brief 的字符上限（提示词别被一条离谱的长句撑爆） */
export const SHOT_TITLE_MAX = 40
export const SHOT_BRIEF_MAX = 200
export const SHOT_PROMPT_MAX = 1800
export const SHOT_HEADLINE_MAX = 80
export const SHOT_SUBHEADLINE_MAX = 140

export interface EcommerceDesignSystem {
  name: string
  palette: readonly string[]
  typography: string
  lighting: string
  composition: string
  imageTreatment: string
}

/**
 * 这一次值不值得**问模型**。
 *
 * 三条同时成立才问：
 *  - 多张（1 张无所谓"分镜"）；
 *  - 不是白底图（白底是抽卡语义，N 张同一件事，用户明确说这样没问题）；
 *  - 用户真写了要求（没写就没有"理解需求"可谈，直接走脚本）。
 *
 * 抽成纯函数是为了**界面和页面用同一个判据**：确认卡上说"会多花一次对话额度"
 * 与真去调用，必须是同一个条件 —— 两处各写一份迟早对不上（说花了没花 / 花了没说）。
 */
export function shouldExpandShots(request: {
  mediaKind?: EcommerceRequest['mediaKind']
  usage: EcommerceRequest['usage']
  count: number
  note?: string
}): boolean {
  if (request.mediaKind === 'video') return false
  /*
   * 白底图是抽卡语义，直接执行同一件事；编辑指令本身已经是最终要求。
   * 其余商品图都必须先看商品原图再写最终视觉提示词，包括只有 1 张的主图。
   * note 不是前提：没有补充要求时，商品外观本身仍需要被分析和转写成画面描述。
   */
  return request.usage !== 'white-bg' && request.usage !== 'edit'
}

/**
 * **一份方案"还算不算数"的判据**（对账 #423）。
 *
 * 用户先出方案 → 再改表单 → 那份方案就是对着**旧参数**写的。继续拿它出图，
 * 用户会得到"方案上写着 3 张，实际出 4 张"这类错位 —— 本项目已经栽过一次同类
 * （#415 的 `shot.nodeId` 只是缓存、不是真相）。所以把"方案是按哪组参数写的"
 * 压成一个字符串，比一比就知道还作不作数。
 *
 * 只包含**影响分镜的那几项**：产品图 / 参考图换了不影响"每张拍什么"
 * （它们是构图素材，不是卖点顺序），所以刻意不进这个键 ——
 * 键里塞进无关项，会让方案因为一次无关改动白白作废。
 */
export function shotKeyOf(input: {
  usage: EcommerceRequest['usage']
  platformId?: string
  language: EcommerceRequest['language']
  count: number
  ratio: string
  note?: string
}): string {
  return JSON.stringify([
    input.usage,
    input.platformId ?? '',
    input.language,
    input.count,
    input.ratio,
    (input.note ?? '').trim(),
  ])
}

/** 系统指令 = 契约（写法与 `chatParse` / 拆镜那几条保持同一形状） */
export function buildShotsSystem(): string {
  return `你是一名电商视觉导演、品牌平面设计师和商业摄影提示词工程师。先查看随消息附上的商品原图与参考图，再依次完成：商品事实分析 → 整套视觉系统 → 每张图的角色、比例、文案与最终生图提示词。

${ECOMMERCE_SHOTS_MARKER}输出契约（必须严格遵守）
1. 只输出一个 JSON 对象，不要解释、不要客套；可以用 \`\`\`json 代码块包住。
2. 结构固定为：
{"productAnalysis":{"summary":"对商品原图的实际观察摘要","visibleFacts":["可见外观事实"]},"designSystem":{"name":"整套方案名","palette":["主色/辅助色"],"typography":"字体家族、字重层级与排版规则","lighting":"统一光线方向、色温和明暗关系","composition":"统一构图与留白规则","imageTreatment":"统一材质、色彩与后期质感"},"shots":[{"title":"短名","brief":"这一张的内部策划意图","ratio":"4:3","headline":"实际主文案","subheadline":"实际辅助文案","prompt":"可直接交给你生图模型的最终视觉提示词"}]}
3. 必须先基于附图写 productAnalysis：只写图中确实看得见的主体、颜色、材质、结构、包装与使用线索；看不清的不要猜。
4. designSystem 必须是一套可贯穿全批的视觉规范：同一字体家族与字重层级、同一文字定位系统、同一品牌色与辅助色、同一光线方向与材质表现。后续每张 prompt 都必须服从它。
5. **shots 条数必须等于要求的张数**：一条不多、一条不少，顺序就是出图顺序（第 1 条 = 第 1 张）。
6. title 不超过 10 个字；brief 一句话，内部说明这一张的视角 / 构图 / 卖点，不要把它当最终提示词。
7. ratio 必须写真实宽高比。用户选智能比例时，按这一张的角色从 1:1 / 3:4 / 4:3 / 16:9 / 21:9 / 9:16 中选择；用户选固定比例时，每条都填写该固定比例，不得擅自更改。
8. headline 与 subheadline 必须是可直接画进图片的真实文案，使用用户指定语言；不得出现 Lorem ipsum、占位符、乱码或无法核实的功效。白底主图必须把两项写成空字符串，不叠字；套图中的卖点、场景、对比、使用建议等画面必须有主文案。
9. prompt 必须是一段自包含的商业视觉描述，至少交代：主体与可见外观、场景/背景、镜头与构图、光线与色调、材质表现、版式与画面文字策略。不要在 prompt 里写"套图结构 / 目标平台 / 输出 N 张 / 同批 / 硬约束"等策划字段。
10. **任意两条 prompt 不许相同或只是换词重复**；整套图保持同一设计系统，但每张的镜头、景别、构图、比例和表达任务必须服务于不同目的。
11. 商品外观严格以附图为准；**不许编造材质、参数、认证、功效、价格、品牌或图中不存在的结构**。
12. 用户补充要求优先级最高；平台规则用于约束构图与文字策略，不把规则原文抄进 prompt。`
}

/**
 * 用户消息：那句话 + 这次的硬参数 + **默认脚本当结构参考**。
 *
 * 为什么把默认脚本也给模型：它是"第 3 张是细节、第 5 张是卖点"这种结构知识的载体。
 * 给了它，模型是在**改**一份合理的结构，而不是从零编 —— 输出更稳，
 * 也更容易看出它到底有没有按用户那句话调整。
 */
export function buildShotsText(
  request: EcommerceRequest,
  platforms: readonly EcommercePlatform[] = ECOMMERCE_PLATFORMS,
  visualCount = 0,
): string {
  const platform = platforms.find((p) => p.id === request.platformId) ?? null
  const platformPreset =
    platform?.id === 'tiktok-shop' || platform?.id === 'douyin'
      ? '高节奏内容电商：强第一眼主体、短标题、留出安全区，避免把短视频界面元素烘焙进图'
      : platform?.group === 'china'
        ? '高信息密度但层级克制：卖点分区清楚、标题醒目、商品与参数信息都可快速扫读'
        : '干净商业编辑风：产品主体优先、留白有秩序、文字少而准、避免促销贴纸堆叠'
  const languagePreset =
    request.language === 'ar'
      ? '阿拉伯语必须从右向左排版，标题与辅助文案的阅读顺序、标点和留白都服从 RTL'
      : ['zh-CN', 'ja', 'ko'].includes(request.language)
        ? '中日韩文字按目标语言真实字形排版，控制断行与字距，不把汉字挤成方块或错用拉丁字体'
        : '拉丁文字使用清晰可读的层级与字重，不随意拉伸、压缩或做负字距'
  const lines = [
    `附带的视觉素材：${visualCount > 0 ? `${visualCount} 张商品原图 / 参考图` : '未收到图片'}`,
    `用户的要求：${(request.note ?? '').trim() || '（用户没写补充要求）'}`,
    `功能：${request.modeLabel?.trim() || usageLabel(request.usage)}`,
    `用途：${usageLabel(request.usage)}`,
    `目标平台：${platformRuleSummary(platform)}`,
    `平台常用比例：${platform?.ratios.join(' / ') ?? '未指定'}`,
    `平台张数建议：${platform?.countHint ?? '未指定'}`,
    `文案语言：${languageLabel(request.language)}`,
    `平台视觉预设：${platformPreset}`,
    `语言排版预设：${languagePreset}`,
    `要求张数：${request.count}`,
    `比例参数：${
      request.ratio === ECOMMERCE_SMART_RATIO
        ? `智能比例（逐张策划，只能使用 ${ECOMMERCE_BASE_RATIOS.join(' / ')}）`
        : `固定 ${request.ratio}（每条 shot.ratio 都必须与它一致）`
    }`,
    `专属配置：${request.modePrompt?.trim() || '无'}`,
    '视觉要求：先建立统一 designSystem；字体、字号层级、文字位置、品牌色、光线与材质表现全批一致，再为每张设计不同角色。',
    '',
    `默认镜头脚本（可作结构参考；请按上面那句要求调整顺序与内容 —— 商品不同，卖点顺序就该不同）：`,
  ]
  for (const shot of ecommerceShots(request.usage, request.count, request.modeOptions)) {
    lines.push(`- ${shot.title}：${shot.brief}`)
  }
  return lines.join('\n')
}

export type ShotsReplyParse =
  | {
      ok: true
      shots: readonly EcommerceShot[]
      analysis: string
      designSystem: EcommerceDesignSystem
    }
  | { ok: false; error: string }

/**
 * 「先出一份方案」的结果（`pages/EcommercePage` → `workbenches/ecommerce` 的契约）。
 *
 * 失败**带原因**回来，由工作台原样显示 —— 与 #406 那条"回落要连为什么一起说"同一口径：
 * 只说"出方案失败"，用户既不知道该改什么，也不知道能不能直接出图。
 */
export type ShotPlanResult =
  | {
      ok: true
      shots: readonly EcommerceShot[]
      analysis: string
      designSystem: EcommerceDesignSystem
    }
  | { ok: false; error: string }

function productAnalysisOf(json: unknown): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ''
  const raw = (json as { productAnalysis?: unknown }).productAnalysis
  if (typeof raw === 'string') return raw.trim()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const summary = (raw as { summary?: unknown }).summary
  return typeof summary === 'string' ? summary.trim() : ''
}

function designSystemOf(json: unknown): EcommerceDesignSystem | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const raw = (json as { designSystem?: unknown }).designSystem
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const name = text(row.name).slice(0, 80)
  const typography = text(row.typography).slice(0, 300)
  const lighting = text(row.lighting).slice(0, 300)
  const composition = text(row.composition).slice(0, 300)
  const imageTreatment = text(row.imageTreatment).slice(0, 300)
  const palette = Array.isArray(row.palette)
    ? row.palette
        .filter((value): value is string => typeof value === 'string' && !!value.trim())
        .map((value) => value.trim().slice(0, 80))
        .slice(0, 8)
    : []
  if (
    !name ||
    !typography ||
    !lighting ||
    !composition ||
    !imageTreatment ||
    palette.length === 0
  ) {
    return null
  }
  return { name, palette, typography, lighting, composition, imageTreatment }
}

export function visualSystemSummary(system: EcommerceDesignSystem): string {
  return [
    system.name,
    `色彩：${system.palette.join(' / ')}`,
    `字体：${system.typography}`,
    `光线：${system.lighting}`,
    `构图：${system.composition}`,
    `质感：${system.imageTreatment}`,
  ].join('；')
}

/**
 * 用户截图里的那类内容属于策划元数据，不是生图模型能直接执行的画面描述。
 * 解析层直接拦住，避免模型没按契约回时又把旧问题送进付费生图。
 */
export function looksLikePlanningPrompt(text: string): boolean {
  return [
    /(^|\n)\s*套图结构\s*[:：]/,
    /(^|\n)\s*输出\s*[:：]\s*\d+\s*张/,
    /(^|\n)\s*同批\s*[:：]/,
    /(^|\n)\s*这一张只做\s*[:：]/,
    /(^|\n)\s*目标平台\s*[:：]/,
    /(^|\n)\s*硬约束\s*[:：]/,
  ].some((pattern) => pattern.test(text))
}

/**
 * 解析模型的回复。
 *
 * **条数必须严格等于 `count`**；任何一条 brief 为空也判失败（整批回落）。
 * 理由与拆集那条一样：宁可整批用**已知正确**的默认脚本，
 * 也不要让"哪一张对应哪一句"错位 —— 错位的分镜比没有分镜更难发现。
 */
export function parseShotsReply(
  raw: string,
  count: number,
  options: {
    usage?: EcommerceUsage
    ratio?: string
  } = {},
): ShotsReplyParse {
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: '要求张数不合法，没法对分镜条数。' }
  }
  const json = extractJsonBlock(raw)
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { shots?: unknown }).shots)
      ? (json as { shots: unknown[] }).shots
      : null
  if (!list) {
    return {
      ok: false,
      error: '没解析出分镜：模型回的不是 {"shots":[…]} 这种结构（可能是段文字）。',
    }
  }
  if (list.length !== count) {
    return {
      ok: false,
      error: `分镜条数对不上：要 ${count} 条，模型回了 ${list.length} 条。`,
    }
  }
  const analysis = productAnalysisOf(json)
  if (!analysis) {
    return {
      ok: false,
      error: '没有拿到商品原图分析：模型必须先看附图并返回 productAnalysis.summary。',
    }
  }
  const designSystem = designSystemOf(json)
  if (!designSystem) {
    return {
      ok: false,
      error: '没有拿到完整视觉系统：designSystem 必须包含名称、色彩、字体、光线、构图和质感。',
    }
  }
  const visualSystem = visualSystemSummary(designSystem)
  const shots: EcommerceShot[] = []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `第 ${i + 1} 条分镜不是对象，整批回落。` }
    }
    const row = item as Record<string, unknown>
    const title = (typeof row.title === 'string' ? row.title.trim() : '').slice(0, SHOT_TITLE_MAX)
    const brief = (typeof row.brief === 'string' ? row.brief.trim() : '').slice(0, SHOT_BRIEF_MAX)
    const prompt = (typeof row.prompt === 'string' ? row.prompt.trim() : '').slice(
      0,
      SHOT_PROMPT_MAX,
    )
    const rawRatio = (typeof row.ratio === 'string' ? row.ratio.trim() : '').slice(0, 20)
    const headline = (typeof row.headline === 'string' ? row.headline.trim() : '').slice(
      0,
      SHOT_HEADLINE_MAX,
    )
    const subheadline = (
      typeof row.subheadline === 'string' ? row.subheadline.trim() : ''
    ).slice(0, SHOT_SUBHEADLINE_MAX)
    /* brief 是这一条的**实质**：空的就是这条模型没写，不许拿 title 顶上 */
    if (!brief) return { ok: false, error: `第 ${i + 1} 条分镜没写清楚要什么，整批回落。` }
    if (!prompt) {
      return {
        ok: false,
        error: `第 ${i + 1} 条只有策划简报，没有最终生图提示词，已停止。`,
      }
    }
    if (looksLikePlanningPrompt(prompt)) {
      return {
        ok: false,
        error: `第 ${i + 1} 条的 prompt 仍是策划字段，不是生图提示词，已停止。`,
      }
    }
    if (options.ratio === ECOMMERCE_SMART_RATIO && !ECOMMERCE_BASE_RATIOS.includes(rawRatio)) {
      return {
        ok: false,
        error: `第 ${i + 1} 条没有给出可执行比例（智能比例只接受 ${ECOMMERCE_BASE_RATIOS.join(' / ')}）。`,
      }
    }
    const titleText = title || `第 ${i + 1} 张`
    if (
      options.usage === 'set' &&
      !/白底|纯白/.test(titleText) &&
      !headline
    ) {
      return {
        ok: false,
        error: `第 ${i + 1} 条属于套图正文画面，但 headline 为空；不能只生成无文案的画面。`,
      }
    }
    if (looksLikePlanningPrompt(headline) || looksLikePlanningPrompt(subheadline)) {
      return {
        ok: false,
        error: `第 ${i + 1} 条文案里混入了策划字段，无法直接排版到画面。`,
      }
    }
    shots.push({
      title: titleText,
      brief,
      prompt,
      ...(ECOMMERCE_BASE_RATIOS.includes(rawRatio) ? { ratio: rawRatio } : {}),
      ...(headline ? { headline } : {}),
      ...(subheadline ? { subheadline } : {}),
      visualSystem,
    })
  }
  if (shots.length > 1 && new Set(shots.map((shot) => shot.prompt)).size !== shots.length) {
    return { ok: false, error: '逐张最终提示词有重复，无法保证每张镜头不同，整批停止。' }
  }
  return { ok: true, shots, analysis, designSystem }
}
