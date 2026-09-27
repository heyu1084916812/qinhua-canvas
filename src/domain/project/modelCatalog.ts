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
      if (key) out.add(key)
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
      out.add(id)
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
export function capabilityOfLogical(
  channels: readonly CatalogChannelLike[],
  logicalName: string,
  channelId?: string,
): ModelCapability | undefined {
  const name = logicalName.trim()
  if (!name) return undefined
  const ordered = channelId
    ? [...channels].sort((a, b) => (a.id === channelId ? -1 : b.id === channelId ? 1 : 0))
    : channels
  for (const c of ordered) {
    const upstream = resolveUpstreamModel(c.modelMap, name)
    if (!upstream) continue
    const hit = [...c.models, ...(c.modelCache ?? [])].find((m) => m.id === upstream)
    if (hit) return hit
  }
  // 没有映射（恒等）时按同名直配找
  for (const c of ordered) {
    const hit = [...c.models, ...(c.modelCache ?? [])].find((m) => m.id === name)
    if (hit) return hit
  }
  return undefined
}

/** 逻辑名属于哪一档（生图 / 对话 / 视频）；取不到返回 undefined，不猜 */
export function categoryOfLogical(
  channels: readonly CatalogChannelLike[],
  logicalName: string,
  channelId?: string,
): ModelCapability['category'] | undefined {
  return capabilityOfLogical(channels, logicalName, channelId)?.category
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
      if (upstream.trim() === name) return logical.trim()
    }
  }
  return name
}
