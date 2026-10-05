import { useEffect, useState } from 'react'
import { isTextEntryElement, isActivationTarget } from '../shared/textTarget'

/**
 * 「空格键被按住」的跟踪（产品文档 §6.3：空格 + 拖拽 = 平移画布）。
 *
 * 为什么要有这个 hook：老表面把这段逻辑写在自己组件里（`CanvasSurface` 的 effect），
 * 而 React Flow **不带**这条语义 —— 它的 `panActivationKeyCode='Space'` 只影响 d3-zoom
 * 的过滤条件（见 `createFilter`），指针落在**节点**上时照样走节点拖动：空格 + 拖节点 = 拖节点，
 * 画布纹丝不动（G4 实测 `(0,0) → (0,0)`）。
 *
 * 文本输入框内要能打出空格、焦点在按钮上时空格要激活控件（无障碍 §4.5），这两条不接管。
 */
export function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      if (isTextEntryElement(target) || isActivationTarget(target)) return
      e.preventDefault()
      setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setHeld(false)
    }
    // 切走窗口 / 失焦时松开：否则回来时画布还卡在平移模式（老表面同一处理）
    const reset = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return held
}
