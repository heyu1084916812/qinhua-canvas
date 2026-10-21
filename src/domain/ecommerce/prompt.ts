/**
 * 电商提示词拼装（对账 #384 / #380a）。
 *
 * 纯函数：进请求 + 平台，出一段写进生成节点的提示词。**可单测**是它的主要价值 ——
 * 提示词是这套功能里最容易被"看起来对"蒙混过去的一环。
 *
 * 三条口径：
 * 1. **参数写进提示词，不写进技能**：技能是"怎么做"（方法论），平台 / 语言 / 张数是
 *    "这次要什么"（参数）。把参数写进技能会让同一个技能出现 N 个副本 ——
 *    #381 明确否定的做法；
 * 2. **硬约束必须每次都在**：不改产品外观、不编造参数/认证/功效 —— 这三条是 AIGC
 *    电商图最常见的翻车方式，不给模型"这次可以编"的机会；
 * 3. **没选平台就说没选**：不编一个通用平台名，也不套别家的规则。
 */
import { platformById, type EcommercePlatform } from './platforms'
import {
  ECOMMERCE_BASE_RATIOS,
  ECOMMERCE_SMART_RATIO,
  ecommerceLanguageOptionLabel,
  ecommerceRatioLabel,
  usageLabel,
  type EcommerceRequest,
  type EcommerceUsage,
} from './types'
import {
  WHITE_BG_ANGLE_OPTIONS,
  whiteBgCountsOf,
} from './modeOptions'
import type { EcommerceModeOptions } from './types'

/** 单次请求里 note 允许的最大长度（再长应当写进提示词节点，而不是这个表单） */
export const ECOMMERCE_NOTE_MAX = 500

/** 每一次都要带上的硬约束（顺序固定，判据好写） */
export const ECOMMERCE_HARD_RULES: readonly string[] = [
  '不改产品的外观、颜色、材质与结构（以产品图为准）',
  '不编造参数、认证、功效与价格',
  '画面文字只用指定语言，不出现乱码与拼写错误',
]

/** 定向编辑时只锁“未点名项”，否则用户明确要求改产品颜色也会被硬规则挡住。 */
export const ECOMMERCE_EDIT_HARD_RULES: readonly string[] = [
  '只执行用户点名的那一项修改，未点名之处保持不变',
  '不编造参数、认证、功效与价格',
  '画面文字只用指定语言，不出现乱码与拼写错误',
]

/** 用途给模型的一句提示（与平台的规则摘要互补：一个说"要什么"，一个说"注意什么"） */
const USAGE_HINTS: Record<EcommerceUsage, string> = {
  main: '主图：产品为画面主体，构图干净、留白得当',
  'white-bg': '白底图：纯白背景、不要场景道具、产品边缘干净',
  detail: '详情页：按卖点分段表达，信息层级清楚',
  set: '套图：主图 + 场景图 + 细节图 + 卖点图，整套风格统一',
  recreate: '爆款复刻：保留参考图的构图、镜头、光影、版式与氛围，产品外观以产品图为准',
  edit: 'AI 编辑：只修改用户点名的那一项，其余画面、产品与版式尽量保持不变',
}

export interface BuildPromptOptions {
  /** 平台清单（默认用内置那份；测试可以喂一份假的） */
  platforms?: readonly EcommercePlatform[]
  /**
   * **逐张分镜**（对账 #406）：传了就用它替代确定性脚本。
   *
   * 长度**必须等于** `request.count` —— 不等就抛错，不许"悄悄补一条 / 截一条"：
   * 分镜与节点是一一对应的，长度对不上时"哪一张是哪句"就错了，
   * 而错位的分镜在出图结果里几乎看不出来（那正是 #406 要防的）。
   */
  shots?: readonly EcommerceShot[]
}

/**
 * 镜头脚本（用户 2026-10-10 #10：「套图和详情页…每张图片都需要不一样，
 * 现在好像是出的图片的提示词都是一致的」）。
 *
 * 一张图 = 一个镜头（要什么视角 / 说什么卖点）。这里是**确定性脚本**：
 * 不依赖任何模型，纯数据，随张数取前 N 条；超出脚本长度时给一条"换构图"的通用项，
 * 保证 N 张永远有 N 条不同的意图（白底图例外，见下）。
 *
 * 为什么先做确定性的：套图 / 详情页的"每张不同"是**结构性**需求（第 3 张永远是细节、
 * 第 5 张永远是卖点），用模型现编反而每次都不一样、也没法单测。
 * 后续要"按用户那句话现场分镜"再接对话模型（对账 #405 的②）。
 */
export interface EcommerceShot {
  /** 这一张的短名（写进提示词，也便于日志里对号） */
  title: string
  /** 这一张具体要什么 */
  brief: string
  /**
   * 对话模型写出的最终生图提示词。
   * 有它时生成节点只发这一段；没有时才由确定性脚本拼一份可执行的画面描述。
   */
  prompt?: string
  /** 这一张实际使用的比例；智能比例模式下由策划模型逐张决定。 */
  ratio?: string
  /** 画面主文案；空 = 这一张按平台规则不需要文字。 */
  headline?: string
  /** 辅助文案，必须与主标题共用同一套字体与层级。 */
  subheadline?: string
  /** 本批共享的视觉系统摘要；逐张携带，确保方案落库后仍可追溯。 */
  visualSystem?: string
}

/**
 * **逐行改方案**（对账 #514）。
 *
 * 「先出方案再出图」如果只能看不能改，用户遇到"第 3 张不该拍材质"时
 * 只剩两条路：丢掉整份方案重新抽一次（再花一次对话额度），或者干脆不确认。
 * 这里只做纯数据更新，界面负责把空行拦在生成之前。
 *
 * 两条刻意保留的语义：
 * - **越界 / 无变化返回原引用**：`shotPlan` 是 React state，原引用不变就不会白重渲染；
 * - **不自动 trim / 不自动补**：用户正在输入时把空格吃掉会让光标乱跳，
 *   "空行怎么办"是界面上的校验，不是数据层偷偷替用户决定。
 */
export function updateEcommerceShot(
  shots: readonly EcommerceShot[],
  index: number,
  patch: Partial<EcommerceShot>,
): readonly EcommerceShot[] {
  const current = shots[index]
  if (!current) return shots
  const changed = patch.title !== undefined || patch.brief !== undefined
  const next: EcommerceShot = { ...current, ...patch }
  /*
   * 用户改标题 / 策划后，上一次模型写的最终提示词已经不对应这行，必须一起作废。
   * 比例、文案与视觉系统仍保留，方便用户只修正标题时不用重做整份方案。
   */
  if (changed && patch.prompt === undefined) delete next.prompt
  if (JSON.stringify(next) === JSON.stringify(current)) return shots
  const out = shots.slice()
  out[index] = next
  return out
}

const MAIN_SHOTS: readonly EcommerceShot[] = [
  { title: '正面全身', brief: '产品正对镜头、完整入画，背景干净、主体居中' },
  { title: '45° 侧面', brief: '产品转 45°，同时看到正面与侧面，突出体量感' },
  { title: '细节特写', brief: '贴近拍材质与工艺：纹理 / 缝线 / 接口等最能说明品质的一处' },
  { title: '使用场景', brief: '把产品放进真实使用环境，主体仍清晰可辨' },
  { title: '俯视平铺', brief: '自上而下平铺构图，展示整体轮廓与比例' },
  { title: '手持比例', brief: '有参照物或手持，交代真实尺寸感（不露脸、不出现多余文字）' },
]

const DETAIL_SHOTS: readonly EcommerceShot[] = [
  { title: '首图：全貌 + 卖点主张', brief: '产品全貌打底，画面留出主标题位置' },
  { title: '材质与工艺', brief: '贴拍细节，说明它为什么耐用 / 好用' },
  { title: '使用场景', brief: '真实生活语境里的**一次**使用，让人代入' },
  { title: '尺寸与规格', brief: '标注示意，数字只以产品图或已知参数为准' },
  { title: '差异对比', brief: '与旧款 / 同类并置说明差别（不贬损竞品、不编造参数）' },
  { title: '包装与清单', brief: '包装外观与随附物品平铺，一眼看清买到什么' },
  { title: '使用步骤', brief: '分步示意，把"怎么用"讲清楚' },
  { title: '品质与承诺', brief: '强调做工与服务，不写无法兑现的承诺' },
]

const SET_SHOTS: readonly EcommerceShot[] = [
  { title: '白底图', brief: '纯白背景、正对镜头，产品边缘干净', ratio: '1:1' },
  { title: '商品主视觉', brief: '建立整套视觉主张，产品与主文案形成第一眼记忆', ratio: '1:1' },
  { title: '核心卖点图 1', brief: '第一核心卖点，标题与产品细节同层级表达', ratio: '1:1' },
  { title: '核心卖点图 2', brief: '第二核心卖点，换一种构图但沿用同一字体与色彩系统', ratio: '1:1' },
  { title: '商品细节图', brief: '材质与工艺近景，文字标注克制且可读', ratio: '4:3' },
  { title: '使用场景图 1', brief: '真实使用场景，人物与产品建立尺度关系', ratio: '1:1' },
  { title: '使用场景图 2', brief: '第二个生活场景，与上一张不重复但保持同一色调', ratio: '4:3' },
  { title: '场景氛围图', brief: '宽幅氛围镜头，给整套 Listing 建立情绪与空间感', ratio: '21:9' },
  { title: '核心对比卖点', brief: '用并置或前后对比说明价值，不贬损竞品、不编造数据', ratio: '16:9' },
  { title: '商品细节图 2', brief: '另一个关键细节，继续使用统一标注系统', ratio: '4:3' },
  { title: '核心卖点图 3', brief: '第三个核心价值点，方形构图便于平台裁切', ratio: '1:1' },
  { title: '使用建议图', brief: '用简洁步骤或注意事项说明怎么使用', ratio: '4:3' },
  { title: '场景氛围图 2', brief: '横幅场景收尾，强化整套图的生活方式联想', ratio: '16:9' },
  { title: '包装与清单', brief: '包装、配件与随附物品平铺，说明用户实际收到什么', ratio: '1:1' },
]

const RECREATE_SHOTS: readonly EcommerceShot[] = [
  { title: '同构图复刻', brief: '沿用参考图的机位、主体比例、光影与版式，替换成本次产品' },
  { title: '同风格换背景', brief: '保持参考图的色彩与光线语言，换一个不抢主体的近似场景' },
  { title: '近景质感版', brief: '沿用参考图的调性，推近到产品材质与工艺最能说明品质的一处' },
  { title: '生活场景版', brief: '保留参考图的镜头语言，把产品放进可信的日常使用环境' },
  { title: '留白文案版', brief: '沿用版式节奏，给指定语言的标题与卖点留出干净区域' },
  { title: '竖版裁切版', brief: '保持视觉重心与层级，按当前比例重新组织成适合竖屏的构图' },
]

const EDIT_SHOT: EcommerceShot = {
  title: '定向编辑',
  brief: '先读懂用户的修改要求，只改被点名的那一项；主体身份、产品结构与画面版式保持不变',
}

/** 白底图 = **抽卡**：N 张是同一件事的 N 次尝试，脚本故意只有一条（用户明确说这样没问题） */
const WHITE_BG_SHOT_BY_ANGLE = new Map(
  WHITE_BG_ANGLE_OPTIONS.map((angle) => [
    angle.id,
    {
      title: `白底图 · ${angle.label}`,
      brief: `纯白背景、不要场景道具，产品边缘干净；${angle.hint ?? angle.label}`,
    } satisfies EcommerceShot,
  ]),
)

/**
 * 这一次要出几张 × 每张要什么。
 *
 * - 白底图：N 条**完全相同**（抽卡语义）；
 * - 主图 / 详情页 / 套图：按脚本顺序取，N 超过脚本长度时给"换构图"的通用项
 *   （保证 N 张不同，而不是把前几张重复一遍）。
 */
export function ecommerceShots(
  usage: EcommerceUsage,
  count: number,
  modeOptions?: EcommerceModeOptions,
): readonly EcommerceShot[] {
  if (usage === 'white-bg') {
    const counts = whiteBgCountsOf(modeOptions ?? {})
    const shots = WHITE_BG_ANGLE_OPTIONS.flatMap((angle) =>
      Array.from(
        { length: Math.max(0, counts[angle.id] ?? 0) },
        () => WHITE_BG_SHOT_BY_ANGLE.get(angle.id)!,
      ),
    )
    while (shots.length < count) {
      shots.push(WHITE_BG_SHOT_BY_ANGLE.get('front')!)
    }
    return shots.slice(0, count)
  }
  if (usage === 'edit') return Array.from({ length: count }, () => EDIT_SHOT)
  const base =
    usage === 'main'
      ? MAIN_SHOTS
      : usage === 'detail'
        ? DETAIL_SHOTS
        : usage === 'recreate'
          ? RECREATE_SHOTS
          : SET_SHOTS
  return Array.from({ length: count }, (_, i) => {
    const hit = base[i]
    if (hit) return hit
    return {
      title: `第 ${i + 1} 张`,
      brief: '围绕同一卖点换一个与前几张不重复的构图与视角（不要重复已出现的画面）',
    }
  })
}

/**
 * 这一张真正发给图片模型的比例。
 *
 * 固定比例是用户明确选择，模型无权改；只有 `smart` 才读取逐张策划值。
 */
export function effectiveEcommerceShotRatio(
  request: Pick<EcommerceRequest, 'ratio' | 'usage'>,
  shot?: Pick<EcommerceShot, 'ratio'>,
): string {
  if (request.ratio !== ECOMMERCE_SMART_RATIO) return request.ratio
  if (request.usage !== 'set') return '1:1'
  return shot?.ratio && ECOMMERCE_BASE_RATIOS.includes(shot.ratio) ? shot.ratio : '1:1'
}

export function buildEcommercePrompt(
  request: EcommerceRequest,
  options: BuildPromptOptions = {},
  shot?: EcommerceShot,
): string {
  /*
   * 对话模型给出的已经是可直接交给生图模型的最终正文。
   * 这里再拼平台、视觉系统和硬约束会制造中英混用；模型专属包装由
   * `imagePromptProfile` 在解析目标模型后统一完成。
   */
  const modelPrompt = shot?.prompt?.trim()
  if (modelPrompt) return modelPrompt

  const platform = options.platforms
    ? (options.platforms.find((p) => p.id === request.platformId) ?? null)
    : platformById(request.platformId)

  const lines: string[] = []
  const note = [shot?.prompt ? '' : request.modePrompt, shot?.prompt ? '' : request.note]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, ECOMMERCE_NOTE_MAX))
    .join('\n')
    .trim()
    .slice(0, ECOMMERCE_NOTE_MAX * 2)
  if (note) lines.push(note)

  if (request.mediaKind === 'video') {
    lines.push(
      `生成一段 ${request.durationSec ?? 5} 秒的${request.modeLabel || '电商商品视频'}，` +
        `产品外观、颜色、材质、结构、比例与细节严格以输入商品图为准，多张商品图视为同一商品的不同角度。`,
    )
    lines.push(
      '使用自然、连续、有商业摄影质感的镜头和运动，主体清晰，不闪烁、不变形、不突然换商品。',
    )
    lines.push(
      '不要新增品牌 Logo、水印、认证、价格或无法核实的参数，也不要复制参考素材中的品牌标识与人物身份。',
    )
    return lines.join('\n')
  }

  const shotTitle = shot?.title || usageLabel(request.usage)
  const shotBrief = shot?.brief || USAGE_HINTS[request.usage]
  const effectiveRatio = effectiveEcommerceShotRatio(request, shot)
  lines.push(
    `专业电商商品摄影，镜头「${shotTitle}」：${shotBrief}。整套画面保持统一的产品气质、色温与光线语言` +
      (request.count > 1
        ? '，但这一张的镜头、景别和构图必须与同批其他图片不同。'
        : '。'),
  )
  if (request.usage === 'recreate') {
    lines.push(
      '只借鉴参考图的构图、机位、光影、色温、版式节奏与氛围，产品外观、颜色、材质、结构仍以商品原图为准；' +
        '不要复制参考图的品牌 Logo、商标、水印、人物身份或不可核实文案。',
    )
  }
  if (request.usage === 'edit') {
    lines.push(
      '只执行用户明确点名的修改，未点名的产品、人物、构图、光影、文字与背景保持不变；' +
        '不要新增品牌 Logo、水印、认证、价格或无法核实的信息。',
    )
  }
  if (platform) {
    lines.push(`构图与画面层级遵循${platform.name}常见商品图做法：${platform.rules}`)
  } else {
    lines.push('按通用电商商品图要求处理，产品为画面主体，背景与道具不抢主体。')
  }
  if (shot?.visualSystem) {
    lines.push(`本批共享视觉系统：${shot.visualSystem}`)
    lines.push(
      '逐张沿用同一套字体家族与字重层级、同一文字定位与留白节奏、同一品牌色与辅助色、同一光线方向与材质表现；' +
        '不要把每张图做成互不相关的风格，也不要随意混用字体。',
    )
  }
  if (shot?.headline?.trim()) {
    lines.push(
      `画面必须直接排版主文案「${shot.headline.trim()}」，文字清晰可读且拼写逐字准确；` +
        '文字作为商业画面的一部分，不覆盖商品关键结构。',
    )
  }
  if (shot?.subheadline?.trim()) {
    lines.push(
      `画面辅助文案「${shot.subheadline.trim()}」使用与主文案相同的字体家族和层级系统，字号与字重低于主文案。`,
    )
  } else if (request.usage === 'set' && !/白底|纯白/.test(shotTitle)) {
    lines.push('这一张只保留必要且可核实的画面文字，不添加画外说明或虚构卖点。')
  }
  lines.push(
    `按 ${ecommerceRatioLabel(effectiveRatio)} 画幅组织画面。画面文字只使用${ecommerceLanguageOptionLabel(request.language, request.usage)}，保持拼写正确、排版清晰，不出现乱码。`,
  )
  lines.push(
    '商品外观、颜色、材质与结构必须严格参照输入商品图；不要编造参数、认证、功效、价格、品牌或图中不存在的结构。',
  )

  return lines.join('\n')
}

/** 一次请求的**逐张**提示词：长度与 `count` 一致，顺序与落位顺序一致 */
export function buildEcommercePrompts(
  request: EcommerceRequest,
  options: BuildPromptOptions = {},
): string[] {
  const shots =
    options.shots ?? ecommerceShots(request.usage, request.count, request.modeOptions)
  if (shots.length !== request.count) {
    throw new Error(
      `分镜条数（${shots.length}）与张数（${request.count}）对不上 —— 不接受悄悄补齐或截断`,
    )
  }
  return shots.map((shot) =>
    buildEcommercePrompt(request, options, {
      ...shot,
      ratio: effectiveEcommerceShotRatio(request, shot),
    }),
  )
}
