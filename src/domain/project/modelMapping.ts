/**
 * 模型映射：逻辑模型名 ↔ 上游模型 ID（产品文档 §7.4.1 / 架构 §6.3）。
 *
 * 为什么要有这一层：不同中转站对同一个模型的名字不一样（A 站 `gpt-image-2`、
 * B 站 `image-2`）。节点若直接存上游 ID，换渠道就要改遍所有节点。
 * 故节点与界面一律只认**逻辑名**，由渠道的映射表翻译成该站真实 ID 再发请求。
 *
 * 纯函数、不依赖 platform / state / React，可在 node 下单测。
 */

/**
 * 每条渠道一份：`逻辑名 → 上游 ID`。
 *
 * 键一定是**逻辑名**（界面与节点存储用的名字），值是该渠道发请求时真正要带的 ID。
 * 空对象 = 恒等映射（见 `resolveUpstreamModel`），老渠道零迁移。
 */
export type ModelMap = Readonly<Record<string, string>>

/**
 * 把逻辑名解析成上游 ID。
 *
 * 三条口径：
 *  ① **无映射 = 恒等映射**：映射表里没有这一项时，逻辑名本身就是上游 ID。
 *     这是兼容老项目 / 老渠道的关键 —— 加这个功能前，节点存的就是上游 ID。
 *  ② **解析不到就如实报错**，绝不静默回落到别的模型：换一个模型出图
 *     比报「这个渠道没配这个模型」更难查（画面不对，但流程全绿）。
 *  ③ 显式映射成**空串**也算没配：用户清空输入框的语义是「不映射」，
 *     不是「映射成空 ID」，后者只会让请求发出去后被上游拒绝。
 *
 * 返回上游 ID；缺失时返回 null，由调用方转成 `channel/missingModel`。
 */
export function resolveUpstreamModel(map: ModelMap | null | undefined, logicalName: string): string | null {
  const name = logicalName.trim()
  if (!name) return null
  const mapped = map?.[name]
  // 恒等映射：没配、或配了空串，都退回逻辑名本身（空串是「未配」不是「配成空」）
  if (mapped === undefined || mapped.trim() === '') return name
  return mapped
}

/**
 * 拉取模型后建立**默认映射**：能自动对上的先填上，对不上的留空待用户填。
 *
 * 口径（产品文档 §7.4.1）：逻辑名与上游 ID 同名时自动建立恒等映射；
 * 不同名则留空。所以「自动填」只在两者同名时发生 —— 此时映射是恒等的，
 * 写不写行为一致，写出来是为了让用户在界面上看得到这一行、能改。
 *
 * 只补不删：已有条目（含用户手填的）原样保留，上游下线的模型也不清掉
 * （清掉等于静默改用户配置，且它可能只是临时取不到）。
 */
export function buildDefaultModelMap(
  existing: ModelMap | null | undefined,
  logicalNames: readonly string[],
  upstreamIds: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = { ...(existing ?? {}) }
  const upstream = new Set(upstreamIds.map((s) => s.trim()).filter(Boolean))
  for (const name of logicalNames) {
    const key = name.trim()
    if (!key) continue
    if (out[key] !== undefined) continue // 只补不删
    if (upstream.has(key)) out[key] = key // 同名 ⇒ 恒等映射
  }
  return out
}

/**
 * 写映射表：值为空（空串 / 只空白）时**删掉这一条**。
 *
 * 为什么删而不是存空串：存空串会让「未配置」与「配置成空」混成一个状态，
 * 而两者的界面含义不同（前者显示恒等、后者像是配坏了）。删掉后一切回到
 * 恒等映射的默认行为，语义单一。
 */
export function setModelMapping(
  existing: ModelMap | null | undefined,
  logicalName: string,
  upstreamId: string,
): Record<string, string> {
  const out: Record<string, string> = { ...(existing ?? {}) }
  const key = logicalName.trim()
  if (!key) return out
  const value = upstreamId.trim()
  if (!value) delete out[key]
  else out[key] = value
  return out
}

/**
 * 读回时补默认值（仓储层用）：老行没有 `modelMap` 键 → 空对象 = 恒等映射。
 *
 * 与 `models` 的补默认同口径（**只补不删**）：缺字段补默认值，已有字段原样带回。
 * 顺带丢掉非法条目（空键 / 空值），避免坏数据一路流到请求里。
 */
export function normalizeModelMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.trim()
    if (!key) continue
    if (typeof v !== 'string') continue
    const val = v.trim()
    if (!val) continue
    out[key] = val
  }
  return out
}

/**
 * 当前映射是否等价于恒等映射（界面上可提示「未配置，按原名发送」，
 * 也让「配了但和原名一样」不至于被当成已配置而误导）。
 */
export function isIdentityMapping(map: ModelMap | null | undefined, logicalName: string): boolean {
  return resolveUpstreamModel(map, logicalName) === logicalName.trim()
}
