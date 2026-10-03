/**
 * 逻辑模型目录（M7-4，§7.4.1）。
 *
 * 用户要的正是这件事：**前端只显示一个模型名**，同一个模型在不同站点
 * 用各自的 ID 去调（A 站 `gpt-image-2`、B 站 `image-2`，其实是同一个模型）。
 *
 * 于是「下拉里列什么」与「请求发出去用什么」必须分开：
 *   - 下拉 = **逻辑名**（跨站点稳定，只有一个）；
 *   - 请求 = 该渠道 `modelMap` 翻译出来的**上游 ID**（M7-3 已接好）。
 *
 * 纯函数、不依赖 platform / state / React。
 */
import type { ModelCapability } from '../shared/capability'
import { resolveUpstreamModel } from './modelMapping'
import {
  PRESET_MODELS,
  presetIdForUpstream,
  presetModelsOf,
  type PresetModel,
} from './modelPresets'

/** 目录只需渠道的这几项，不认识整条渠道实体（与选路同款的最小视图做法） */
export interface CatalogChannelLike {
  id: string
  enabled: boolean
  /** 用户勾选的（画布下拉的数据源） */
  models: readonly ModelCapability[]
  /** 拉取回来的全部 */
  modelCache?: readonly ModelCapability[]
  modelMap: Readonly<Record<string, string>> | null | undefined
}

/**
 * 被当作**别名目标**的 ID 集合：某条渠道把逻辑名映射到了它。
 *
 * 例：A 站 `image-2 → gpt-image-2`，则 `gpt-image-2` 是别名目标
 * ⇒ 它不再单独占一个逻辑名（否则下拉里会同时出现 `image-2` 与
 * `gpt-image-2` 两个名字，而用户眼里那是同一个模型）。
 */
export function aliasTargets(channels: readonly CatalogChannelLike[]): Set<string> {
  const out = new Set<string>()
  for (const c of channels) {
    for (const [logical, v] of Object.entries(c.modelMap ?? {})) {
      const t = v.trim()
      const key = logical.trim()
      /**
       * 只把「**被别的名字**映射走」的目标排除。
       *
       * 自己映射到自己（恒等，`image-2 → image-2`）不该被排除 ——
       * 否则一个只是登记过恒等映射的模型会凭空从目录里消失
       * （G46 回归的直接原因：chip 取不到能力 ⇒ 视频参数不出现、旧模型清不掉）。
       */
      if (t && t !== key) out.add(t)
    }
  }
  return out
}

/**
 * 逻辑名全集。
 *
 * 两条来源：
 *  ① 各渠道 `modelMap` 的**键**（用户显式定义的逻辑名，跨站点是同一个）；
 *  ② 渠道里出现、但**没有给别人当别名**的模型 ID（尚未归一的，按原名显示）。
 *
 * ② 是兼容的关键：加此功能前，节点存的就是上游 ID；没有任何映射时
 * 逻辑名 = 上游 ID，下拉与以前**一字不差**（老项目零迁移）。
 */
export function logicalNames(channels: readonly CatalogChannelLike[]): string[] {
  const targets = aliasTargets(channels)
  const out = new Set<string>()
  for (const c of channels) {
    for (const k of Object.keys(c.modelMap ?? {})) {
      const key = k.trim()
      if (!key) continue
      /**
       * ⚠️ **恒等映射（`agnes-2.5-pro → agnes-2.5-pro`）不贡献逻辑名**。
       *
       * 用户 2026-10-02 报的正是这一条：「agent 上的模型选择要从前端显示名映射来，
       * 我的对话模型 Agnes 就只有一个，但 agent 里显示了很多个 agnes 的模型」。
       *
       * 现象的出处在**拉取模型**：设置页给每个拉回来的模型都登记了一行恒等映射
       * （只是「这个名字存在」的登记，不是重命名）。下面第二个循环（勾选 / 缓存）
       * 本来就按 `勾选优先，勾选为空才回落缓存` 收敛过一次，但第一个循环把
       * **所有**映射键都收了进来 —— 于是那些用户**没有勾选**的模型从恒等映射
       * 这条后门又漏回下拉里。
       *
       * 恒等映射本身不携带任何信息（键与值同名），模型一定由第二个循环覆盖；
       * 跳过它不丢任何模型，只堵掉这条后门。
       */
      const value = (c.modelMap?.[k] ?? '').trim()
      if (value === key) continue
      out.add(key)
    }
  }
  for (const c of channels) {
    /**
     * ⚠️ **勾选优先，勾选为空才回落 `modelCache`** —— 不能无条件把缓存全量算进来。
     *
     * 这是曾经踩过的口子（用户 2026-09-27 报「我的模型上又很多很多模型」）：
     * 中转站一次拉回几百个模型，`modelCache` 是**全部**、`models` 才是用户勾选的
     * （§7.4 的分工）。无条件合并两者，等于把用户特意筛掉的全又倒回下拉里。
     * 回落本身是必要的（「拉取了但还没勾」的渠道不该是空下拉），
     * 但它只在**勾选为空**时生效 —— 与 `generationPreset.pickModel` 同一条口径。
     */
    const selectable = c.models.length > 0 ? c.models : (c.modelCache ?? [])
    for (const m of selectable) {
      const id = m.id.trim()
      if (!id || targets.has(id)) continue
      /**
       * 已知的上游 ID 先归一成**显示名**（用户 2026-09-27 第 8 轮）。
       *
       * 渠道里勾的是 `gpt-image-2`，而用户拍板要看到 `GPT Image 2` ——
       * 目录这一层不收口的话，固定清单与渠道模型会在下拉里各占一行，
       * 看起来像两个模型（正是用户报「id 格式不一样」的现象）。
       * 认不出来的 ID 原样保留，不猜。
       */
      out.add(presetIdForUpstream(id))
    }
  }
  return [...out]
}

/**
 * 逻辑名 → 它在某渠道上的**能力**（分类 / 张数上限等）。
 *
 * 先看映射出的上游 ID 在该渠道的能力，再看同名直配 ——
 * 分类决定它出现在「生图 / 视频 / 文本」哪一档，取不到就返回 undefined
 * （调用方按「未知即不显示」处理，不猜）。
 */
function findProvider(
  channels: readonly CatalogChannelLike[],
  logicalName: string,
  channelId?: string,
): { channelId: string; capability: ModelCapability } | undefined {
  const name = logicalName.trim()
  if (!name) return undefined
  const ordered = channelId
    ? [...channels].sort((a, b) => (a.id === channelId ? -1 : b.id === channelId ? 1 : 0))
    : channels
  for (const c of ordered) {
    const upstream = resolveUpstreamModel(c.modelMap, name)
    if (!upstream) continue
    /**
     * 名称匹配允许两种：**上游 ID**（常态）与**逻辑名本身**。
     *
     * 后者是为固定显示名准备的（用户 2026-09-27）：前端显示 `GPT Image 2.5 Flare`，
     * 中转站里叫 `gpt-image-2.5-flare`；用户在设置页映射之前，渠道里能对上的
     * 只有逻辑名那一侧，也必须能取到能力（否则面板会把它当成「不认识」而隐藏）。
     */
    const hit = [...c.models, ...(c.modelCache ?? [])].find(
      (m) => m.id === upstream || m.id === name,
    )
    if (hit) return { channelId: c.id, capability: hit }
  }
  // 没有映射（恒等）时按同名直配找
  for (const c of ordered) {
    const hit = [...c.models, ...(c.modelCache ?? [])].find((m) => m.id === name)
    if (hit) return { channelId: c.id, capability: hit }
  }
  return undefined
}

export function capabilityOfLogical(
  channels: readonly CatalogChannelLike[],
  logicalName: string,
  channelId?: string,
): ModelCapability | undefined {
  return findProvider(channels, logicalName, channelId)?.capability
}

/**
 * 逻辑名 → **哪条渠道**能提供它（用户 2026-10-02：「不要有选择渠道」）。
 *
 * 对话窗把「选渠道」这一档去掉了：用户眼里只有模型名，渠道是实现细节。
 * 但请求必须带渠道（`completeWithTools` 拿 channelId 去找适配器与令牌），
 * 所以这一步在**选模型的同时**把渠道定下来，而不是留个空让用户去配。
 *
 * 判据与 `capabilityOfLogical` **同一条搜索**（映射优先、同名直配兜底）——
 * 各写一份的话，会出现「这个模型在下拉里选得出来、渠道却找不到」的幽灵项，
 * 表现是发消息报看不懂的渠道错误。
 *
 * `preferChannelId`：当前会话已经在用的渠道若能提供它，就**不要换** ——
 * 换渠道会让同一个模型突然走另一条线，用户没有要求这件事。
 */
export function channelIdForLogical(
  channels: readonly CatalogChannelLike[],
  logicalName: string,
  preferChannelId?: string,
): string | undefined {
  return findProvider(channels, logicalName, preferChannelId)?.channelId
}

/**
 * 逻辑名属于哪一档（生图 / 对话 / 视频）；取不到返回 undefined，不猜。
 *
 * 固定显示名（`modelPresets`）自带分类：它在渠道里往往**还没有对应条目**
 * （用户就是要先在前端看到名字、再去后台映射），此时按清单给的分类返回，
 * 否则切类别时 `modelBelongsTo` 会把它误判成「不属于新类别」而清掉。
 */
export function categoryOfLogical(
  channels: readonly CatalogChannelLike[],
  logicalName: string,
  channelId?: string,
): ModelCapability['category'] | undefined {
  const fromChannel = capabilityOfLogical(channels, logicalName, channelId)?.category
  if (fromChannel) return fromChannel
  return presetOf(logicalName)?.category
}

/** 某一档的逻辑名（下拉的数据源），保持目录顺序 */
export function logicalOptions(
  channels: readonly CatalogChannelLike[],
  category: ModelCapability['category'],
  channelId?: string,
): string[] {
  return logicalNames(channels).filter(
    (n) => categoryOfLogical(channels, n, channelId) === category,
  )
}

/**
 * 创作面板的模型下拉数据源（用户 2026-09-27 第 7 轮）。
 *
 * = **固定显示名清单**（用户拍板的那几档，按类别给）。
 *
 * **2026-10-03 收窄口径**（用户：「提示词节点的模型和我前端的模型没有对应上，
 * 多了两个框住的模型……项目中所有有模型的地方，都需要从前端选择，不要给我多余的东西」）：
 *
 * 一条渠道只要**有任何模型**被前端清单认领（例如 Agnes 给了 `agnes-3.0-flash`
 * → `Agnes 3.0 Flash`），它贡献的**裸名字一律不进下拉** —— 既包括 `agnes-2.5-flash`
 * 这种上游 ID、`Agnes 2.5 Pro` 这种已经不在清单里的陈旧映射键（用户反复看到的
 * 「多出来的两个」），也包括同一站点里那一大串没归一过的 ID
 * （Comfy-gpt 视频档有 40 多个 kling / grok / wan，全摆出来就是灾难）。
 *
 * 只有**整条渠道这一档一个都没被认领**时才补它的裸名字：否则用户新接一个站、
 * 还没来得及配映射时，会出现「一个模型都选不出来」——那比列表长更糟。
 * 去重：渠道模型恰好与固定名同名（或能归一成固定名）时只出一个。
 *
 * `logicalOptions` 保持原样（只按渠道算），单测与其它调用方不受影响 ——
 * 这条「面板数据源」的口径只在这里定义一次，面板与设置页共用。
 */
export function panelModelOptions(
  channels: readonly CatalogChannelLike[],
  category: ModelCapability['category'],
  channelId?: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of presetModelsOf(category)) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m.id)
  }
  const scoped = channelId ? channels.filter((c) => c.id === channelId) : channels
  for (const channel of scoped) {
    const all = logicalNames([channel])
    /**
     * 这条渠道**有没有任何名字被前端清单认领**？有 ⇒ 它的裸名字全部让位
     * （用户 2026-10-03：不许出现清单之外的多余项）。
     */
    const recognized = all.some((n) => !!presetOf(presetIdForUpstream(n)))
    if (recognized) continue
    for (const n of all) {
      if (categoryOfLogical([channel], n, channel.id) !== category) continue
      /**
       * 渠道模型的**上游 ID** 先归一成显示名（用户 2026-09-27 第 8 轮）：
       * 渠道里勾的是 `gpt-image-2`，而固定清单里已经有 `GPT Image 2` ——
       * 不归一的话用户会在下拉里同时看到这两行，看起来像两个模型。
       */
      const display = presetIdForUpstream(n)
      if (seen.has(display)) continue
      seen.add(display)
      out.push(display)
    }
  }
  return out
}

/** 固定清单里的条目（含厂商，供面板取图标）；不是固定名则返回 undefined */
export function presetOf(name: string): PresetModel | undefined {
  const key = name.trim()
  return PRESET_MODELS.find((m) => m.id === key)
}

/**
 * 把节点上存的模型名**归一成逻辑名**（老数据迁移用）。
 *
 * 老节点存的是上游 ID。若它恰好是别人映射的目标
 * （例：节点存 `gpt-image-2`，而 A 站把 `image-2` 映射到它），
 * 显示/选择时应当按逻辑名 `image-2` 走 —— 否则用户看到的名字
 * 与下拉里的名字对不上，看起来像「这个模型没了」。
 *
 * 找不到别名关系就原样返回（恒等，与以前一致）。
 */
export function toLogicalName(
  channels: readonly CatalogChannelLike[],
  modelName: string,
): string {
  const name = modelName.trim()
  if (!name) return ''
  if (logicalNames(channels).includes(name)) return name
  for (const c of channels) {
    for (const [logical, upstream] of Object.entries(c.modelMap ?? {})) {
      const key = logical.trim()
      const target = upstream.trim()
      /**
       * 只认**真的重命名**那一行（键 ≠ 值）。
       *
       * 恒等行（`agnes-2.5-pro → agnes-2.5-pro`）是「拉取模型」顺手登记的，
       * 先撞上它会把 `agnes-2.5-pro` 原样返回，下面那条
       * 「已知上游 ID → 显示名」的兜底就永远走不到 —— 用户在老会话 / 老节点上
       * 看到的仍是裸 ID，而同一下拉里列的是 `Agnes 2.5 Pro`，看起来像两个模型。
       */
      if (target === name && key !== target) return key
    }
  }
  /**
   * 最后一道：**已知的上游 ID 写法 → 它的显示名**（用户 2026-09-27 第 8 轮）。
   *
   * 场景正是用户截图里的那个：节点上存的是 `gpt-image-2`（老数据或中转站
   * 拉回来的 ID），而用户要看到的是 `GPT Image 2`。上面两道都认不出来时，
   * 用固定清单里登记的别名兜底 —— 认不出来才原样返回，不硬塞。
   */
  return presetIdForUpstream(name)
}
