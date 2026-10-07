import { useEffect, useState } from 'react'

/**
 * 「Ctrl / ⌘ 被按住」的跟踪 —— 也就是 React Flow 的**框选键**（`selectionKeyCode`）生效中。
 *
 * 为什么要单独知道这件事：框选的手势是"按住 Ctrl 在画布上拖一个框"，而**端点命中层挂在
 * `.react-flow__pane` 外面**（它是 `<ReactFlow>` 的兄弟元素，见 `FlowPortLayer` 的说明）——
 * 按下落在它身上时，RF 的框选根本不会启动，于是"贴着节点边缘 / 贴着连线起手框选"
 * 会变成拖一条线（用户第 17 批 #1「有时候框选多选不了」的另一种表现）。
 *
 * 解法：按住选择键时让命中层**整层不吃指针**（`data-port-selecting` → CSS 里
 * `pointer-events: none`），框选于是处处起得来 —— 与"按住空格 = 平移"同一类
 * "修饰键改手势语义"的处理（见 `useSpaceHeld`）。
 *
 * 文本输入框里按住 Ctrl（复制粘贴）与控件上的修饰键手势不接管，避免抢键。
 */
export function useSelectionKeyHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return
      setHeld(false)
    }
    /** 切走窗口 / 失焦时松开：否则回来时命中层一直不吃指针（与 `useSpaceHeld` 同一处理） */
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
