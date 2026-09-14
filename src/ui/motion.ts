/**
 * 动效时长与缓动（唯一来源，对应产品文档 §3.4）。
 * 与 ui/tokens.css 中的 --dur-* / --ease-* 保持同一组数值（CSS 用变量，JS 用这里）。
 * 画布缩放 / 平移走 transform + GPU 合成，无过渡（见 §3.4「画布缩放 / 平移」）。
 */

export const DURATION = {
  hover: 120,
  panel: 140,
  menu: 120,
  lightbox: 180,
  edge: 100,
  select: 0,
} as const

export type MotionName = keyof typeof DURATION

export const EASING = {
  out: 'ease-out',
  panel: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const

/** 返回 CSS transition 字符串，用于 JS 驱动的动画（如 element.animate 之外的内联样式） */
export function transition(name: MotionName): string {
  const easing = name === 'menu' || name === 'hover' || name === 'edge' ? EASING.out : EASING.panel
  return `${DURATION[name]}ms ${easing}`
}

/** 是否尊重「减少动态」偏好（产品文档 §3.4 末尾） */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
