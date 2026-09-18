/**
 * 生成配方：新建节点时的默认「渠道 + 模型 + 参数」。
 *
 * 解决一件很小但每天都碰到的事：新建节点的 `channelId` / `model` 默认是空串，
 * 于是每建一个节点都要重新选一次。而一个项目通常固定用同一个渠道与模型——
 * 默认值应该是「上次那套」，不是「没选」。
 *
 * ## 取值规则（用户 2026-09-18 口径）
 *
 * | 项目状态 | 默认值 |
 * | --- | --- |
 * | 从未生成过 | 后台设置的**第一个渠道 → 第一个模型** |
 * | 生成过 | **最后一次生成时用的那一套**（渠道 + 模型 + 生成参数） |
 *
 * ## 为什么按项目一份（修订自「全局一份」）
 *
 * 早先存全局，理由是「渠道配置跨项目共享，同粒度最不容易串」。那个理由站不住：
 * **渠道共享 ≠ 选择共享**——同一个渠道在不同项目里常配不同的模型与参数，
 * 全局一份会让 A 项目的选择跑到 B 项目去。用户要的是「打开这个项目时，
 * 用关闭它时最后一次生成选的那套」。
 *
 * ## 为什么记「生成时」而不是「选参数时」
 *
 * 用户要的是「最后一次**生成**用的」。选了参数却没点生成的那次不该影响默认值。
 *
 * 纯数据 + 纯函数：不读时间、不碰 storage、不依赖 React，可在 node 下单测。
 * 存哪儿由 state 层决定（见 state/project/presetStore，键带 projectId）。
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

/** 配方在库里的行形态：一行一个项目 */
export interface PresetRow {
  id: string
  projectId: string
  channelId: string
  model: string
  params: Record<string, unknown>
  savedAt: number
}

/** 行主键由 projectId 派生：一个项目一行 */
export function presetRowId(projectId: string): string {
  return `recipe:${projectId}`
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

/** 配方 → 行 */
export function recipeToRow(projectId: string, recipe: GenerationRecipe): PresetRow {
  return { id: presetRowId(projectId), projectId, ...recipe }
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

/** 渠道的最小视图：本模块只需要「它有哪些已勾选模型」，不关心协议 / 地址 */
export interface PresetChannelLike {
  id: string
  models: readonly { id: string }[]
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
): ResolvedRecipe | null {
  if (!recipe.channelId) return null
  const channel = channels.find((c) => c.id === recipe.channelId)
  if (!channel) return null
  const same = channel.models.find((m) => m.id === recipe.model)
  if (same) {
    return {
      channelId: recipe.channelId,
      model: recipe.model,
      params: recipe.params,
      substituted: false,
    }
  }
  const first = channel.models[0]
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
    const pick = category
      ? c.models.find((m) => (m as { category?: string }).category === category)
      : c.models[0]
    if (pick) {
      return { channelId: c.id, model: pick.id, params: {}, substituted: true }
    }
  }
  return null
}
