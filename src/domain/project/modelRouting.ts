/**
 * 模型路由：一个**逻辑模型名** → 从多个渠道候选里按策略挑一个（产品文档 §7.4.1，M7）。
 *
 * 为什么需要它（而不只是 `modelMapping` 的单值映射）：
 * `modelMapping` 只解决「同一个模型在不同站点叫不同名字」；
 * 而「同一个逻辑模型在多个渠道都能出图时该用哪个」是**选路**问题。
 * 参考 `new-api` 的 `Ability`（group × model × channel × priority × weight），
 * 候选由**渠道派生**而非另建表 —— 渠道自己就带着「提供哪些模型」与「优先度 / 权重」。
 *
 * 纯函数、不依赖 platform / state / React，可在 node 下单测。
 */

/**
 * 选路策略。
 *
 * 只有**有数据支撑**的三档，不做需要数据的档位：
 *  - `priority`：用户手工排的优先度（渠道上的 `priority`）；
 *  - `performance`：渠道实测延迟（`lastTestLatency`，已在存）；
 *  - `balanced`：忽略优先度，按 `weight` 加权随机分摊（多站均摊成本 / 限额）。
 *
 * 「价格优先 / 质量优先」需要价格表与质量评分，本项目目前**没有这两类数据**，
 * 故不进枚举 —— 进了也只能假排序（那是本项目反复踩过的「假功能」）。
 * 等有了数据再把它们加进来，解析函数无需改结构。
 */
export type RouteStrategy = 'priority' | 'performance' | 'balanced'

export const ROUTE_STRATEGIES: { value: RouteStrategy; label: string; hint: string }[] = [
  { value: 'priority', label: '优先度', hint: '按后台设的优先度，高的先跑' },
  { value: 'performance', label: '性能优先', hint: '按实测延迟，快的先跑' },
  { value: 'balanced', label: '均衡分摊', hint: '按权重随机，多站分摊' },
]

/**
 * 一个候选项 = 「某渠道 × 某逻辑模型」。
 *
 * `upstreamModel` 是**已经按该渠道映射表解析过**的上游 ID（恒等映射即原名）。
 * 解析不出来（`null`）的渠道不参与选路 —— 该渠道没配这个模型。
 */
export interface RouteCandidate {
  channelId: string
  enabled: boolean
  /**
   * 该渠道**此刻能不能真发请求**：令牌是否已存（离线协议由调用方传 true）。
   *
   * 为什么选路要看它：只按「已启用 + 提供该模型」筛，会把一条**没存令牌**的
   * 渠道也选进来，请求发出去必然失败；而旁边明明有一条配好的站。
   * 选路的意义正是避开这种站。
   */
  hasToken: boolean
  /** 数值越大越优先（与 new-api 的 `priority DESC` 同向） */
  priority: number
  /** 权重，>=0；`balanced` 时按 weight+10 加权随机（+10 保证 0 权重也有机会） */
  weight: number
  /** 实测往返延迟（ms）；`null` = 从未验证过，排在有实测值的后面 */
  latencyMs: number | null
  /** 该渠道映射出来的上游 ID；`null` = 该渠道未提供此模型 */
  upstreamModel: string | null
}

export interface RouteSelection {
  channelId: string
  upstreamModel: string
}

/**
 * 退化用的「缺省权重」：weight=0 的候选也必须有机会被选中，
 * 否则「均衡分摊」会退化成只有配过权重的渠道能出图（new-api 的 `weight+10` 同款理由）。
 */
const WEIGHT_FLOOR = 10

/**
 * 未显式传 `resolve` 时的兜底：**恒等映射**（逻辑名即上游 ID）。
 *
 * 与 `modelMapping.resolveUpstreamModel` 的缺省语义一致 —— 无映射就是恒等，
 * 老渠道零迁移。这里不 import 它，是为了让本模块不依赖具体映射实现。
 */
function defaultResolve(
  map: Readonly<Record<string, string>> | null | undefined,
  name: string,
): string | null {
  const key = name.trim()
  if (!key) return null
  const mapped = map?.[key]
  if (mapped === undefined || mapped.trim() === '') return key
  return mapped
}

function weightedPick<T extends { weight: number }>(pool: readonly T[], random: number): T | null {
  if (pool.length === 0) return null
  const total = pool.reduce((sum, c) => sum + Math.max(0, c.weight) + WEIGHT_FLOOR, 0)
  // random 可能来自 Math.random()（含 1 的边界风险），夹回 [0,1)
  const r = Math.min(Math.max(random, 0), 0.999999)
  let acc = r * total
  for (const c of pool) {
    acc -= Math.max(0, c.weight) + WEIGHT_FLOOR
    if (acc <= 0) return c
  }
  return pool[pool.length - 1]!
}

/**
 * 分层：返回按「优 → 劣」排好的档位数组，每档是同分的候选列表。
 *
 * 为什么要分档而不是直接排序取第一个：new-api 的容错正是靠这个 ——
 * `retry` 时降到**下一档**，而不是原地重试同一渠道。
 */
function tiers(
  candidates: readonly RouteCandidate[],
  strategy: RouteStrategy,
): RouteCandidate[][] {
  if (strategy === 'balanced') return [candidates.slice()]

  if (strategy === 'performance') {
    // 未测过延迟（null）单独排在最后，不与「测过 = 慢」混为一档
    const measured = candidates.filter((c) => typeof c.latencyMs === 'number')
    const unknown = candidates.filter((c) => typeof c.latencyMs !== 'number')
    const groups = new Map<number, RouteCandidate[]>()
    for (const c of measured) {
      const key = c.latencyMs as number
      const list = groups.get(key)
      if (list) list.push(c)
      else groups.set(key, [c])
    }
    const ordered = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, list]) => list)
    return unknown.length > 0 ? [...ordered, unknown] : ordered
  }

  // priority：数值降序
  const groups = new Map<number, RouteCandidate[]>()
  for (const c of candidates) {
    const list = groups.get(c.priority)
    if (list) list.push(c)
    else groups.set(c.priority, [c])
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, list]) => list)
}

/**
 * 选路：返回应选的渠道与它对应的上游模型 ID；没有可用候选时返回 null。
 *
 * 三条口径：
 *  ① **只从「能用」的候选里选**：渠道必须启用、且该渠道确实提供了这个逻辑模型。
 *  ② **档内按权重随机**（不是固定取第一个）：同档多站时均摊，也避免所有流量压一个站。
 *  ③ **`attempt` 是降级不是重试**：attempt>0 时降到下一档（new-api 的 retry 语义）。
 *     用尽档位后停在最差一档 —— 有候选就用，总比直接失败好；是否失败由调用方决定。
 *
 * `random` 由调用方传入以保证可测（生产传 `Math.random()`）。
 */
export function selectRoute(
  candidates: readonly RouteCandidate[],
  strategy: RouteStrategy,
  options: { attempt?: number; random?: number } = {},
): RouteSelection | null {
  /**
   * 三个条件缺一不可：已启用、**有令牌**、且该渠道确实提供这个模型。
   *
   * 令牌这一条是补上的：少了它，一条没存令牌的渠道也会被选中 ——
   * 请求发出去必然失败，而旁边明明有一条配好的站。选路本就该避开这种站。
   */
  const usable = candidates.filter((c) => c.enabled && c.hasToken && c.upstreamModel)
  if (usable.length === 0) return null

  const attempt = Math.max(0, Math.floor(options.attempt ?? 0))
  const random = options.random ?? 0.5
  const tiersList = tiers(usable, strategy)
  if (tiersList.length === 0) return null

  // balanced 不分层：每次都是全池随机，attempt 只影响不到它
  const pool = tiersList[Math.min(attempt, tiersList.length - 1)]!
  const picked = weightedPick(pool, random)
  if (!picked) return null
  return { channelId: picked.channelId, upstreamModel: picked.upstreamModel as string }
}

/**
 * 候选的**最小渠道视图**：只取选路需要的字段。
 *
 * 之所以不直接 import `Channel`：让本模块保持「给什么就选什么」的纯函数形态，
 * 单测不必造一整条渠道（也避免 domain 层为选路反向依赖渠道实体）。
 */
export interface RouteChannelSource {
  id: string
  enabled: boolean
  /** 是否已存令牌；离线协议（不发真实请求）由调用方传 true */
  hasToken: boolean
  priority: number
  weight: number
  lastTestLatency: number | null
  /** 该渠道提供的模型（已选 `models` 即画布可见的那些） */
  modelIds: readonly string[]
  modelMap: Readonly<Record<string, string>> | null | undefined
  /** 该渠道自己的选路策略 */
  routeStrategy: RouteStrategy
}

/**
 * 渠道 → 候选项：按逻辑名派生。
 *
 * 与 new-api 的差别值得说明：它把这条关系**物化**成 `abilities` 表
 * （渠道 × 模型 × 分组），换来查询快；本项目渠道数量是个位数、模型几十个，
 * 每次选路现算即可 —— 少一张要维护同步的表，就不会出现「表与渠道不一致」
 * （new-api 为此专门写了 `FixAbility()` 来修，正是物化的代价）。
 *
 * 口径：渠道**提供**这个逻辑名（在其 `models` 里）才成为候选；
 * 上游 ID 由该渠道的映射表解析，解析不出来则 `upstreamModel` 为 null（不参与选路）。
 */
export function routeCandidatesFor(
  channels: readonly RouteChannelSource[],
  logicalName: string,
  resolve: (map: Readonly<Record<string, string>> | null | undefined, name: string) => string | null,
): RouteCandidate[] {
  const name = logicalName.trim()
  if (!name) return []
  return channels
    /**
     * 「该渠道提供这个逻辑模型」有**两种**成立方式（用户 2026-09-27 第 7 轮）：
     *  ① 勾选列表里有同名模型（老路，逻辑名 = 上游 ID 时）；
     *  ② 该渠道的 `modelMap` 里有这个**逻辑名**的条目（新路）。
     *
     * ② 是固定显示名能跑起来的关键：前端显示 `GPT Image 2.5 Flare`，
     * 而站点的模型列表里叫 `gpt-image-2.5-flare` —— ② 没接上时，
     * 用户配好了映射，选路却找不到任何候选，请求发不出去。
     */
    .filter((c) => c.modelIds.includes(name) || Boolean((c.modelMap ?? {})[name]?.trim()))
    .map((c) => ({
      channelId: c.id,
      enabled: c.enabled,
      hasToken: c.hasToken,
      priority: c.priority,
      weight: c.weight,
      latencyMs: c.lastTestLatency,
      upstreamModel: resolve(c.modelMap, name),
    }))
}

/**
 * 「这次该发给谁」：按逻辑模型名解析出**最终渠道 + 该渠道的上游 ID**。
 *
 * 为什么需要一个「主导策略」：策略住在渠道上，而选路是**跨渠道**比较 ——
 * 候选们可能各自声明了不同策略，必须有唯一一把尺子。
 * 取 `governingChannelId`（节点自己选的那条渠道）的策略：它就是用户心里
 * 的「主站」，用它决定这次怎么挑；该渠道不在候选里时回落 `priority`
 * （手工排的优先度，不需要任何实测数据，行为最可预测）。
 *
 * 返回 `null` = **没有任何渠道提供这个逻辑模型** —— 调用方必须如实报错，
 * 不要退回「照原样发出去」（那会拿一个已下线的模型名去请求，失败原因难查）。
 */
export function resolveRouteFor(
  channels: readonly RouteChannelSource[],
  logicalModel: string,
  options: {
    governingChannelId?: string
    attempt?: number
    random?: number
    /**
     * 解析「逻辑名 → 上游 ID」的函数，显式传入而非 import。
     *
     * 它住在 `modelMapping.ts`；这里若直接 import 会形成一个可避免的耦合，
     * 且调用方（执行宿主）已经持有它 —— 传进来即可，本模块保持纯粹。
     */
    resolve?: (map: Readonly<Record<string, string>> | null | undefined, name: string) => string | null
  } = {},
): RouteSelection | null {
  const name = logicalModel.trim()
  if (!name) return null
  const resolve = options.resolve ?? defaultResolve
  const candidates = routeCandidatesFor(channels, name, resolve)
  if (candidates.length === 0) return null

  const governing = options.governingChannelId
    ? channels.find((c) => c.id === options.governingChannelId)
    : undefined
  const strategy: RouteStrategy = governing?.routeStrategy ?? 'priority'

  return selectRoute(candidates, strategy, {
    attempt: options.attempt,
    random: options.random,
  })
}
