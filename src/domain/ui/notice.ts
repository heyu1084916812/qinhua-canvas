/**
 * 提示**语气**与它对无障碍播报的意义（产品文档 §4.5「动态播报」）。
 *
 * 原文：*保存 / 生成 / 重试 / 失败 / 取消与导入完成用 `aria-live` 播报；
 * 错误 `role=alert`，状态 `role=status`。*
 *
 * 为什么收成一个模块：画布的瞬时提示（`CanvasNotice`）与页面级状态行
 * （项目页 / 素材页 / 技能页 / 设置页）是**同一件事的两副面孔** ——
 * 两处各写一遍 `tone === 'error' ? 'alert' : 'status'`，迟早一边改了另一边没改。
 * 这里只有两张牌：**语气 → 该挂的 role / aria-live**。
 *
 * 纯数据 + 纯函数，不依赖任何上层（`domain/` 的依赖规则管着）。
 */
export type NoticeTone = 'info' | 'error'

/**
 * 语气 → 无障碍属性。
 *
 * - `error` ⇒ `role=alert` + `aria-live=assertive`：**打断当前朗读**，适合"被拒绝 / 失败"；
 * - `info` ⇒ `role=status` + `aria-live=polite`：等当前朗读完再念，适合"已保存 / 已导入"。
 *
 * ⚠️ 别把 `error` 用在"只是提示一下"的地方（比如"组内已经很整齐了"）——
 * 满屏 assertive 与满屏 alert 一样，会让用户把这个入口整个忽略掉。
 */
export function noticeA11y(tone: NoticeTone): { role: 'alert' | 'status'; 'aria-live': 'assertive' | 'polite' } {
  return tone === 'error'
    ? { role: 'alert', 'aria-live': 'assertive' }
    : { role: 'status', 'aria-live': 'polite' }
}
