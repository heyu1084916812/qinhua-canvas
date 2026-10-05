import { useEffect } from 'react'
import { useCanvasStore } from '../storeContext'
import { useCanvasExecution } from './CanvasExecutionProvider'
import { isTextEntryElement, isActivationTarget } from '../../../features/shared/textTarget'

/**
 * 执行模式快捷键（产品文档 §6.20 / §6.19.1）。
 *
 * | 键 | 模式 |
 * |---|---|
 * | `R` | 单点生成（当前选中节点） |
 * | `Alt+R` | 单点生成 + 保留旧内容（拓扑方向铺新下游） |
 *
 * 已下线的三个（用户 2026-09-17）：`P` 整条流程重跑、`Shift+R` 仅刷新陈旧、
 * `Ctrl/Cmd+Enter` 全图重跑。三者都是**覆盖式**重跑（产物写回原节点、旧结果被冲掉），
 * 与「每次生成新建一个右侧节点、旧的留着对比」的落位模型相反，故一并移除。
 *
 * 两条纪律：
 * - **不劫持浏览器键**：带 `Ctrl/Cmd` 的组合一律放行（`Ctrl+R` 刷新页面、`Ctrl+P` 打印）；
 * - **文本框 / 激活控件内不接管**（无障碍 §4.5：按钮上的按键归按钮）；
 * - **运行中不响应** `R` / `Alt+R`，避免打断进行中的计划。
 *
 * 独立小组件而非塞进画布表面：它要订阅执行状态（isRunning），
 * 挂在 Surface 上会让整个画布随每个 task 状态变化重渲。
 */
export function RunHotkeys() {
  const store = useCanvasStore()
  const exec = useCanvasExecution()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 带 Ctrl/Cmd 的组合一律放行（不劫持浏览器键）。
      // Alt 不算——它是 Alt+R 的修饰键，属于本组件的语义。
      if (e.ctrlKey || e.metaKey) return
      // 文本框 / 激活控件内的按键归控件（无障碍 §4.5）
      const t = e.target as HTMLElement | null
      if (isTextEntryElement(t) || isActivationTarget(t)) return
      if (exec.isRunning) return

      const sel = store.getSelection()
      const nodeId = sel.length === 1 ? sel[0]! : null
      if (!nodeId) return
      if (e.key === 'r' || e.key === 'R') {
        void exec.runNode(nodeId, { alt: e.altKey })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, exec])

  return null
}
