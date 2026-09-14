/**
 * **叙事页码**（M6-11，纯函数）——缩略角标与导出页脚共用的唯一定义。
 *
 * 为什么抽出来：M6-9 把「页码角标」做进了 `overview/thumbnail`，M6-11 导出也要打页码。
 * 若两处各算一次，「总览看到的第 3 页」与「导出图上写的 3」就有可能对不上——
 * 这种不一致极难被发现（要人肉比对导出成品与总览）。所以页码定义**只留一份**，
 * 放在模型层（`model/`），缩略与导出都来取。
 *
 * 口径（与 `readerNav` 一致）：
 *   - 页码是**叙事序**——阅读方向只管「格内顺序」与「翻页手感」，页的先后不变；
 *   - 因此页码**不随 `rtl` 镜像**：第 1 页永远是第 1 页。
 *
 * 纯函数、无 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

/**
 * 页下标（0 起）→ 页码文案（1 起）。
 *
 * 越界 / 非有限数一律夹到 `"1"`：页码是给人看的标签，
 * 出现 `NaN` / `Infinity` 比显示错更糟，宁可退回首页。
 */
export function pageBadgeText(index: number): string {
  const raw = Number.isFinite(index) ? Math.trunc(index) : 0
  return String(Math.max(0, raw) + 1)
}
