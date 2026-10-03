/** 逻辑名 → 该渠道上游 ID（M7-4）；缺映射时恒等（与 `modelMapping` 同口径） */
import { resolveUpstreamModel } from './modelMapping'
import { isPresetModelOfCategory, presetModelsOf } from './modelPresets'

/**
 * 哪些面板改动算「用户改了这套生成参数」（用户 2026-09-23 定稿）。
 *
 * 规则修订的背景：原本记录时机是「**生成成功**那一刻」，理由是「选了参数却没生成的那次
 * 不该影响默认值」。用户实测后明确否掉了这个口径：
 *
 * > 「只要我改了参数，他也给我记住。两种规则：第一个是新项目时有默认模型规则；
 * >  改完参数就记下来；后面每次新建的节点参数就来自上一次改的那套。」
 *
 * 也就是把「记配方」从**生成行为的副产品**，改成**编辑行为的直接结果**：
 * 用户在面板里动了什么，下一次新建就该继承什么，不必先跑一次生成。
 * 这与「参数是用户的偏好、不是某次请求的记录」这一直觉一致。
 *
 * 刻意**不含**提示词与素材：那些是「这一张图的内容」，继承给下一个节点
 * 只会让人先删掉再写（与产品文档 §6.8「不记内容」同一条边界）。
 *
 * 含 `mode`（图片 / 视频切换）：类别变了，模型与参数集都会跟着换，
 * 记下来才能让下一个节点直接落在同一个类别上。
 */
export const RECIPE_TRACKED_KEYS = [
  'mode',
  'channelId',
  'model',
  'ratio',
  'resolution',
  'quality',
  /** 图片「背景」（图一）：`auto` / `opaque` / `transparent` */
  'background',
  'count',
  'size',
  'durationSec',
  'refMode',
  /** 视频「生成模式」（图四/图五/图七/图九那种下拉） */
  'videoMode',
  /** 视频「生成音频」开关 */
  'generateAudio',
] as const

export type RecipeTrackedKey = (typeof RECIPE_TRACKED_KEYS)[number]

/**
 * 该面板事件是否算「改了配方」。
 *
 * 收成一个纯函数而不是在事件处理里逐个 `case` 判断，是因为**这份名单就是产品规则**：
 * 加参数时若忘了在这里登记，用户就会遇到「改了这一项、新建节点却没记住」——
 * 与「文档写了、链路没接上」同一类缺陷。集中一处，配套单测能钉住每一档。
 */
export function isRecipeEdit(eventType: string): boolean {
  /**
   * 事件名是 `setXxx` 形式（`setModel` / `setRatio` / …），而名单写的是字段名。
   * 这里把两者对齐：剥掉 `set` 前缀并把首字母转小写（`setModel` → `model`）。
   *
   * 用**映射**而不是「名单里存事件名」：名单随后要用来决定记哪些字段，
   * 存事件名会让「字段」与「事件」两个概念混在一起；而事件名是可推导的。
   */
  const field = eventType.startsWith('set')
    ? eventType.slice(3, 4).toLowerCase() + eventType.slice(4)
    : eventType
  /**
   * 两个事件名与字段名不同名，在这里对齐（而不是给它们各自开特例分支）：
   * `setChannel` 改的是 `channelId` 字段、`setMode` 改的是 `mode`。
   */
  const normalized = field === 'channel' ? 'channelId' : field
  return (RECIPE_TRACKED_KEYS as readonly string[]).includes(normalized)
}

/**
 * 生成配方：新建节点时的默认「渠道 + 模型 + 参数」。
 *
 * 解决一件很小但每天都碰到的事：新建节点的 `channelId` / `model` 默认是空串，
 * 于是每建一个节点都要重新选一次。而一个项目通常固定用同一个渠道与模型——
 * 默认值应该是「上次那套」，不是「没选」。
 *
 * ## 取值规则（2026-09-18 定稿：**按渠道记忆**）
 *
 * | 情形 | 默认值 |
 * | --- | --- |
 * | 该渠道记过 | 该渠道**上一次生成用的那一套**（模型 + 生成参数） |
 * | 从没记过 | 后台设置的**第一个可用渠道 → 它的第一个可用模型** |
 *
 * ## 为什么按渠道一份（修订自「按项目一份」「全局一份」）
 *
 * 全局一份会让 A 项目的选择跑到 B 项目去，站不住。改成「按项目一份」后仍不理想：
 * 同一个项目里换渠道（生图站 vs 对话站）本该各记各的，按项目只会互相覆盖。
 * 对照参考项目「大雄无限画布」后确认：它把记忆按**执行模式**分桶，而本项目
 * **统一走渠道**、执行引擎不分叉——故它的「模式桶」在这里天然等价于**渠道这一层**。
 *
 * ## 解析链（创建与面板兜底**共用**）
 *
 * 1. 节点自身已有的 `channelId` / `model`
 * 2. 该渠道上次记录（模型失效 → 该渠道第一个可用模型）
 * 3. 第一个可用渠道的第一个可用模型
 * 4. 都没有 → `null`（调用方给出可诊断的解释，不留空白下拉）
 *
 * 早期只在**创建那一刻**算一次、算不出就写空，且面板侧没有第二道兜底，
 * 于是「渠道已配置、模型只进了 `modelCache`、尚未勾选」这条最常见路径下永远为空。
 * 把解析链收成这一个函数，创建与面板都调它，是修这个 bug 的关键。
 *
 * ## 为什么记「生成时」而不是「选参数时」
 *
 * 用户要的是「最后一次**生成**用的」。选了参数却没点生成的那次不该影响默认值。
 *
 * 纯数据 + 纯函数：不读时间、不碰 storage、不依赖 React，可在 node 下单测。
 * 存哪儿由 state 层决定（见 state/project/presetStore，键带 channelId）。
 */

/**
 * 一次生成的「配方」。
 *
 * `params` 只收**生成参数**（比例 / 画质 / 数量 / 时长……），**不收**提示词与素材——
 * 那些是「这一张图的内容」，继承给下一个节点只会让人先删掉再写。
 */
export interface GenerationRecipe {
  channelId: string
  model: string
  params: Record<string, unknown>
  /** 记录时间（仅供诊断；不参与比较） */
  savedAt: number
}

/**
 * 配方在库里的行形态：**一行一渠道**（按渠道记忆，2026-09-18 收口）。
 *
 * 为什么从「一项目一行」收到「一渠道一行」：对照参考项目「大雄无限画布」后确认——
 * 它把「记住上次设置」按**执行模式**分桶（api 生图 / api 视频 / comfy 文案…），
 * 必须分桶是因为那几档对应**完全不同的执行引擎**、参数结构不通用；
 * 本项目**统一走渠道**、执行引擎不分叉，故它的「模式桶」在这里天然等价于「渠道这一层」。
 *
 * 配方以 `channelId` 作身份，所以这里**不再需要 projectId**。
 */
export interface PresetRow {
  id: string
  channelId: string
  model: string
  params: Record<string, unknown>
  savedAt: number
}

/** 行主键由 channelId 派生：一个渠道一行 */
/**
 * 配方行的主键前缀。
 *
 * `presets` 是**一张表住三样偏好**：生成配方（`recipe:*`）、全局选路策略
 * （`routing:strategy`）、Agent 默认模型（`agent:default`）。
 * 全表扫描（`loadAll`）时**只能认自己那一类前缀** —— 不认前缀的话，
 * `agent:default` 那行恰好也带 `channelId` + `model`，会被读成一条生成配方。
 * 后果不是「少了一条偏好」而是**画布拿到对话模型去出图**：
 * 用户点「设为默认模型」之后，新建的生成节点带着一个没有渠道能提供的对话模型，
 * 点生成静默失败（2026-10-02 实测到的就是这个）。
 */
export const RECIPE_ROW_PREFIX = 'recipe:'

/** 这一行的主键是不是配方行（`loadAll` 用它把同表的其它偏好挡在外面） */
export function isRecipeRowId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(RECIPE_ROW_PREFIX)
}

export function presetRowId(channelId: string): string {
  return `${RECIPE_ROW_PREFIX}${channelId}`
}

/** 空配方（没生成过 / 数据不可信时的取值） */
export const NO_RECIPE: GenerationRecipe = { channelId: '', model: '', params: {}, savedAt: 0 }

/**
 * 行 → 配方。
 *
 * 缺字段 / 类型不对一律退化为空配方，而不是抛错或留半个值——
 * 半份配方（有渠道没模型）比没有更糟：面板显示一个渠道，实际却跑不起来。
 */
export function recipeFromRow(row: unknown): GenerationRecipe {
  if (!row || typeof row !== 'object') return NO_RECIPE
  const r = row as Record<string, unknown>
  const channelId = typeof r.channelId === 'string' ? r.channelId : ''
  const model = typeof r.model === 'string' ? r.model : ''
  const params =
    r.params && typeof r.params === 'object' && !Array.isArray(r.params)
      ? (r.params as Record<string, unknown>)
      : {}
  const savedAt = typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0
  if (!channelId || !model) return NO_RECIPE
  return { channelId, model, params, savedAt }
}

/** 配方 → 行（主键由渠道派生） */
export function recipeToRow(recipe: GenerationRecipe): PresetRow {
  return { id: presetRowId(recipe.channelId), ...recipe }
}

/**
 * 把「这次生成实际用的渠道 + 模型 + 参数」记成配方。
 *
 * 只在渠道与模型**都有值**时记：只选了渠道还没选模型就记下来，
 * 下次新建会得到「有渠道没模型」的半份配方（见 `recipeFromRow` 的理由）。
 */
export function rememberRecipe(
  channelId: string,
  model: string,
  params: Record<string, unknown>,
  now: number,
): GenerationRecipe | null {
  if (!channelId || !model) return null
  return { channelId, model, params, savedAt: now }
}

/** 解析结果：可用的渠道 + 模型 + 参数，以及它是不是兜底来的 */
export interface ResolvedRecipe {
  channelId: string
  model: string
  params: Record<string, unknown>
  /** true = 走的是兜底（没有记录 / 记录已失效），调用方需要时可用它提示 */
  substituted: boolean
}

/**
 * 渠道的最小视图：本模块只关心「它有哪些模型可选」，不关心协议 / 地址。
 *
 * `models` = 用户**已勾选**的（画布下拉的数据源）；
 * `modelCache` = 「拉取模型」拉回来的**全部**（选择面板的数据源）。
 * 两者都要：优先用勾选的，勾选为空时回落到缓存（见 `pickModel`）。
 */
export interface PresetChannelLike {
  id: string
  /**
   * `category` 可选：候选的模型能力分类（`image` / `chat` / `video`）。
   *
   * 解析链在**指定类别**时必须按它过滤，否则「图片 → 视频」切类别时会把
   * 上次记的生图模型当成有效记录原样填回视频模式（用户 2026-09-27 实测暴露）。
   * 老调用方的简化渠道没有这一项 → 视为「不分类」，行为与以前一致。
   */
  models: readonly { id: string; category?: string }[]
  modelCache?: readonly { id: string; category?: string }[]
  /**
   * M7-4：逻辑名 → 该渠道上游 ID 的映射。解析链要按它把逻辑名归一后再比对，
   * 否则逻辑名会被误判成「渠道没有这个模型」。
   *
   * 可选：老调用方（单测里的简化渠道）没有这一项时按「恒等」处理，行为不变。
   */
  modelMap?: Readonly<Record<string, string>> | null
}

/**
 * 挑一个能用的模型：**先看已勾选，再看拉取回来的缓存**。
 *
 * 为什么必须回落到 `modelCache`（2026-09-18 实测踩到）：
 * 「拉取模型」只是把模型放进缓存，**不等于勾选**——用户还得在「选择模型」面板里
 * 勾上并点应用，那次操作才写进 `models`。于是「我只配了一个渠道、点了拉取、
 * 就直接回画布建节点」这条**最常见**的路径下，`models` 是空的，
 * 默认值就什么都拿不到，表现成「明明配好了渠道，新建节点还是空的」。
 *
 * 原先不回落的理由是「缓存可能几十上百个，拿第一个等于随机」——那只在
 * **多模型**时成立；一个都不勾选的情况下，退回第一个（也就是列表里最靠前的那个）
 * 显然比留空更符合用户预期。
 */
function pickModel(
  channel: PresetChannelLike,
  category?: string,
): { id: string } | undefined {
  const byCategory = (list: readonly { id: string }[]) =>
    category ? list.find((m) => (m as { category?: string }).category === category) : list[0]
  const hit = byCategory(channel.models) ?? byCategory(channel.modelCache ?? [])
  /**
   * **对话类**默认取固定显示名的第一个（用户 2026-09-27 第 8 轮：
   * 「目前需要一个默认的显示，不是 advanced-voice」）。
   *
   * 渠道里的勾选顺序是**上游给的**，`advanced-voice` 这类与创作无关的条目
   * 经常排在前面 —— 用户看到的默认模型就成了它。固定清单是用户自己拍板的那几行，
   * 第一项（`GPT-6 Astra`）才是合适的默认值。
   *
   * 两个边界都要守住：
   *  ① **只在对话类替换**：生图 / 视频的既有默认（渠道第一个模型）不动，
   *     否则一次「修提示词默认值」会把生成节点的默认也悄悄改掉；
   *  ② **仍要求这个渠道真有对话模型**（`hit` 存在）才替换 —— 否则一个
   *     只有生图模型的渠道会「凭一个固定名」被选成对话节点的默认渠道。
   */
  if (hit && category === 'chat') {
    /**
     * 挑哪个显示名当默认：**优先这条渠道真有的那个**（用户 2026-10-01 加了 Agnes 自有显示名之后）。
     *
     * 固定清单现在跨多个厂商（Agnes / OpenAI / Google…）。无脑取第一项，
     * 会把「Agnes 2.5 Pro」塞给一条根本没有 Agnes 模型的渠道，
     * 发出去就是一个它不认识的名字 —— 节点建出来看着正常，一跑就报错。
     *
     * 判据用 `aliases`（该显示名已知的上游 ID 写法）与渠道已勾选 / 已拉取的 ID 求交：
     * 命中说明「这条渠道本来就以这个模型的形式存在」。都不命中才退回第一项
     * （保持既有兜底：总要给个非空的默认值，让用户能改）。
     */
    const available = new Set(
      [...channel.models, ...(channel.modelCache ?? [])].map((m) => m.id),
    )
    const presets = presetModelsOf('chat')
    const preset =
      presets.find((p) => (p.aliases ?? []).some((a) => available.has(a))) ?? presets[0]
    if (preset) return { id: preset.id }
  }
  return hit
}

/**
 * 按项目配方解析默认值。
 *
 * 记录里的模型如果**已不在该渠道**（被取消勾选 / 渠道换了），落到该渠道第一个可用模型——
 * 用户选的是「失效时自动兜底」，而不是留空让人重选（渠道被删属少数情况，
 * 为此每次都让人重选不划算）。
 */
export function resolveRecipe(
  recipe: GenerationRecipe,
  channels: readonly PresetChannelLike[],
  category?: string,
): ResolvedRecipe | null {
  if (!recipe.channelId) return null
  const channel = channels.find((c) => c.id === recipe.channelId)
  if (!channel) return null
  /**
   * 记录里的模型如果**这个渠道还提供**（已勾选或已在缓存里），就用它。
   *
   * 两边都查：勾选列表是用户显式选择的，但「拉取了却没勾」的渠道里
   * 那个模型仍然出现在缓存里——只看勾选会把一个完全可用的记录判成失效。
   */
  const available = [...channel.models, ...(channel.modelCache ?? [])]
  /**
   * M7-4：记录/节点上的模型是**逻辑名**，可能与渠道里的上游 ID 不同名
   * （`逻辑名 → 上游ID` 映射）。直接按原名比会判成「渠道没有这个模型」，
   * 于是被当作失效并随即覆盖 —— 表现为切类别后旧模型清不掉（G46 回归）。
   * 故先归一（逻辑名 → 该渠道的上游 ID），再去比对；两者任一命中即算可用。
   */
  const logicalUpstream = resolveUpstreamModel(channel.modelMap, recipe.model)
  const same =
    available.find((m) => m.id === recipe.model) ??
    (logicalUpstream ? available.find((m) => m.id === logicalUpstream) : undefined)
  /**
   * 记录里的模型还必须属于**本次要的类别**（用户 2026-09-27 实测暴露）。
   *
   * 只判「这个模型渠道还提供吗」是不够的：图片 → 视频切类别时，记录的仍是
   * 上次那张图用的**生图模型**，它确实还在渠道里 ⇒ 被当成有效记录原样返回，
   * 于是面板又把生图模型填回视频模式（界面看着换过来了，请求却带着图片模型）。
   *
   * 有 `category` 时按它过滤；没传 `category` 的调用方（生成节点不分类检索）
   * 保持原行为，零迁移。
   */
  const sameMatchesCategory =
    !category || (same as { category?: string } | undefined)?.category === category
  if (same && sameMatchesCategory) {
    return {
      channelId: recipe.channelId,
      model: recipe.model,
      params: recipe.params,
      substituted: false,
    }
  }
  /**
   * 记录里的是**固定显示名**（用户 2026-09-27 第 8 轮）→ 直接沿用。
   *
   * 固定显示名在渠道里通常**没有对应条目**（渠道里叫 `gpt-image-2`，界面叫
   * `GPT Image 2`），上面的「渠道还提供吗」永远查不到它。不认这条会怎样：
   * 用户每次新开面板，选好的 `GPT Image 2` 都被判成失效、又被兜底换成别的 ——
   * 表现为「选了下拉自己变回去」。
   */
  if (isPresetModelOfCategory(recipe.model, category)) {
    return {
      channelId: recipe.channelId,
      model: recipe.model,
      params: recipe.params,
      substituted: false,
    }
  }
  const first = pickModel(channel, category)
  if (!first) return null
  return { channelId: recipe.channelId, model: first.id, params: recipe.params, substituted: true }
}

/**
 * 没有配方时的兜底：**取第一个有已勾选模型的渠道**。
 *
 * 这是「项目从未生成过」那条规则（用户 2026-09-18：用后台设置的第一个渠道的
 * 第一个模型）。只认「已勾选模型」而不是 `modelCache`——后者是拉回来的全部，
 * 可能几十上百个，拿第一个当默认等于随机。
 *
 * `category` 可选：提示词节点只要文本模型（生成节点用不到这个参数）。
 */
export function firstUsableChannel(
  channels: readonly PresetChannelLike[],
  category?: string,
): ResolvedRecipe | null {
  for (const c of channels) {
    const pick = pickModel(c, category)
    if (pick) {
      return { channelId: c.id, model: pick.id, params: {}, substituted: true }
    }
  }
  return null
}

/**
 * **统一入口**：给节点算「该用哪个渠道 / 模型 / 参数」。
 *
 * 为什么必须是**一个函数**、创建与面板都调它：早期两条路径各写一份——
 * 创建时算一次写进节点，面板则只看节点上的值。两条路一漂移就出现
 * 「新建节点渠道是空的，而面板明明有可用渠道」这种自相矛盾的状态。
 *
 * 解析链：
 * 1. 节点自身已有的 `channelId` / `model`（用户手动选过，最优先）
 * 2. 该渠道（或任一渠道）上次记录（`lookupRecipe`）
 * 3. 第一个可用渠道的第一个可用模型
 * 4. `null`
 *
 * @param owned    节点自身已带的渠道 / 模型（可空）
 * @param channels 可用渠道（调用方已按 enabled 过滤）
 * @param lookupRecipe 按 channelId 取上次记录；没记过返回空配方
 * @param category 模型类别过滤：提示词节点传 `'chat'`，生成节点不传
 */
export function resolveForNode(
  owned: { channelId?: string; model?: string },
  channels: readonly PresetChannelLike[],
  lookupRecipe: (channelId: string) => GenerationRecipe,
  category?: string,
): ResolvedRecipe | null {
  const channelId = owned.channelId ?? ''
  const model = owned.model ?? ''

  /** 第 1 档：节点自己带了渠道——只看这个渠道的记录 / 首模型，不跨渠道兜底。 */
  if (channelId) {
    const channel = channels.find((c) => c.id === channelId)
    if (channel) {
      const available = [...channel.models, ...(channel.modelCache ?? [])]
      /** 节点上的模型若仍可用，原样保留（连参数一起给回）。 */
      /**
       * 同上方 `resolveRecipe` 的理由：节点上存的是逻辑名，
       * 需按该渠道的映射归一后再判「它还提不提供这个模型」。
       */
      const modelUpstream = resolveUpstreamModel(channel.modelMap, model)
      if (
        model &&
        (available.some((m) => m.id === model) ||
          (modelUpstream ? available.some((m) => m.id === modelUpstream) : false) ||
          /**
           * 固定显示名：渠道里没有对应条目也算可用（理由见 `resolveRecipe` 的同一段）。
           * 少了这一条，用户新选的固定名会在下一次解析时被判失效、被兜底覆盖回去。
           */
          isPresetModelOfCategory(model, category))
      ) {
        const recipe = lookupRecipe(channelId)
        return { channelId, model, params: recipe.params, substituted: false }
      }
      /** 模型失效 / 没选：该渠道记录 → 该渠道第一个可用模型。 */
      const byRecipe = resolveRecipe(lookupRecipe(channelId), channels, category)
      if (byRecipe) return byRecipe
      const first = pickModel(channel, category)
      if (first) return { channelId, model: first.id, params: {}, substituted: true }
    }
  }

  /**
   * 第 2 档：节点没带渠道（或渠道已失效）——找**最近一次改过的**那份配方。
   *
   * 为什么要遍历：节点空着时（新建刚建出来），解析必须能捡回「上次那套」，
   * 否则「记过」这条规则在创建路径上形同虚设——直接掉到第 3 档、白丢参数。
   *
   * ⚠️ **按 `savedAt` 倒序，而不是按渠道顺序**（2026-09-23 修正）。
   * 原实现按渠道列表顺序取第一条记过的，多渠道时必然出错：用户明明刚在渠道乙上
   * 改过参数，而渠道甲恰好排在列表前面，新建就拿甲那套——表现为「改了参数却没带上」
   * （用户实测报的就是这个）。「最近改的」才符合直觉，也不依赖列表顺序这种无关状态。
   *
   * `model` 若也带了（渠道失效但模型名还在）优先找匹配该模型的记录，
   * 命中不了再按时间倒序退——两者都优于「什么都不看直接取首模型」。
   */
  const byRecency = [...channels].sort(
    (a, b) => lookupRecipe(b.id).savedAt - lookupRecipe(a.id).savedAt,
  )
  const candidates = model
    ? [
        ...byRecency.filter((c) => lookupRecipe(c.id).model === model),
        ...byRecency.filter((c) => lookupRecipe(c.id).model !== model),
      ]
    : byRecency
  for (const c of candidates) {
    const resolved = resolveRecipe(lookupRecipe(c.id), [c], category)
    if (resolved) return resolved
  }

  /** 第 3 档：第一个可用渠道的首模型。 */
  return firstUsableChannel(channels, category)
}
