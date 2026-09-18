/**
 * 生成预设：新建生成 / 批量节点时**默认带上上次用过的渠道与模型**（用户 2026-09-17）。
 *
 * 解决的是一件很小但每天都碰到的事：新建节点的 `channelId` / `model` 默认是空串，
 * 于是每建一个节点都要重新选一次渠道和模型。而实际工作里，一个项目通常
 * 固定用同一个渠道的同一个模型——默认值应该是「上次那个」，不是「没选」。
 *
 * ## 为什么单独成域
 *
 * 「记住上次的选择」是一条**规则**（该记什么、什么时候记、失效了怎么办），
 * 不是某个组件的内部状态。塞进 `channelStore` 会让那个已经不小的 store
 * 再多一份无关职责；塞进 `CanvasPage` 则只能服务于「顶栏新建」这一条入口，
 * 右键菜单新建就享受不到。放在 domain 里，两处入口共用同一份规则。
 *
 * ## 存哪儿
 *
 * 全局一份（跟随浏览器，不跟随项目）——用户明确选了这个粒度：
 * 渠道配置本身就是跨项目共享的，预设跟它同粒度最不容易串。
 *
 * 纯数据 + 纯函数：不读时间、不碰 storage、不依赖 React，可在 node 下单测。
 * 真正的读写由 state 层用这里的编解码函数完成（见 state/project/presetStore）。
 */

/** 一份预设：渠道 id + 该渠道下的模型 id */
export interface GenerationPreset {
  channelId: string
  model: string
  /** 记录时间（仅用于诊断与将来进行性展示；不参与比较） */
  savedAt: number
}

/** 预设在库里的行形态（与任意表结构无关，由 state 层决定存哪） */
export interface PresetRow {
  id: string
  channelId: string
  model: string
  savedAt: number
}

/** 预设行的固定主键：全局只有一份 */
export const PRESET_ROW_ID = 'generation-default'

/** 空预设（没选过 / 数据不可信时的取值） */
export const NO_PRESET: GenerationPreset = { channelId: '', model: '', savedAt: 0 }

/**
 * 行 → 预设。
 *
 * 缺字段 / 类型不对一律退化为空预设，而不是抛错或留半个值——
 * 半份预设（有渠道没模型）比没有更糟：面板会显示一个渠道，
 * 而实际上跑不起来，用户得自己猜为什么。
 */
export function presetFromRow(row: unknown): GenerationPreset {
  if (!row || typeof row !== 'object') return NO_PRESET
  const r = row as Record<string, unknown>
  const channelId = typeof r.channelId === 'string' ? r.channelId : ''
  const model = typeof r.model === 'string' ? r.model : ''
  const savedAt = typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0
  if (!channelId || !model) return NO_PRESET
  return { channelId, model, savedAt }
}

/** 预设 → 行 */
export function presetToRow(preset: GenerationPreset): PresetRow {
  return { id: PRESET_ROW_ID, ...preset }
}

/**
 * 把「当前选的渠道 + 模型」记成预设。
 *
 * 只在**两个都有值**时才记：只选了渠道还没选模型就记下来，
 * 下次新建会得到「有渠道没模型」的半份预设（见 `presetFromRow` 的理由）。
 */
export function rememberPreset(channelId: string, model: string, now: number): GenerationPreset | null {
  if (!channelId || !model) return null
  return { channelId, model, savedAt: now }
}

/**
 * 预设是否仍然可用（渠道还在、且该模型仍在它已勾选的列表里）。
 *
 * 用户选的是「不可用时自动挑一个」而不是「留空」：
 * 渠道被删 / 模型被取消勾选属于少数情况，为此每次都让用户重选不划算；
 * 自动挑该渠道**第一个可用模型**，并在返回里标明这是兜底选择，
 * 好让调用方在需要时提示一句。
 */
export interface ResolvedPreset {
  channelId: string
  model: string
  /** true = 原预设已失效，这里用的是兜底模型 */
  substituted: boolean
}

/** 渠道的最小视图：本模块只需要「它有哪些已勾选模型」，不关心协议 / 地址 */
export interface PresetChannelLike {
  id: string
  models: readonly { id: string }[]
}

export function resolvePreset(
  preset: GenerationPreset,
  channels: readonly PresetChannelLike[],
): ResolvedPreset | null {
  if (!preset.channelId) return null
  const channel = channels.find((c) => c.id === preset.channelId)
  if (!channel) return null
  const has = channel.models.some((m) => m.id === preset.model)
  if (has) return { channelId: preset.channelId, model: preset.model, substituted: false }
  // 原模型不在了 → 兜底取该渠道第一个已勾选模型
  const first = channel.models[0]
  if (!first) return null
  return { channelId: preset.channelId, model: first.id, substituted: true }
}

/**
 * 没有任何预设时的兜底：**取第一个有已勾选模型的渠道**。
 *
 * 为什么需要它（用户 2026-09-18 又提了一次「新建节点还是没默认」）：
 * 预设只在「用户在面板里手动选过模型」之后才会存在。一个全新用户 ——
 * 或者刚配好渠道、直接从画布开始建节点的人 —— 从来没触发过那次记录，
 * 于是每个新节点都是空的，看起来像「默认功能没做」。
 *
 * 他配好的渠道本身就是意图表达：**有已启用渠道、且勾了模型，就该拿来当默认**。
 * 只认「已勾选模型」而不是 `modelCache`（后者是拉回来的全部，可能几十上百个，
 * 拿第一个当默认等于随机）。
 */
export function firstUsableChannel(
  channels: readonly PresetChannelLike[],
): ResolvedPreset | null {
  for (const c of channels) {
    const first = c.models[0]
    if (first) return { channelId: c.id, model: first.id, substituted: true }
  }
  return null
}
