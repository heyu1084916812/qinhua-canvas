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
 * | `P` | 整条流程重新运行（该节点 + 全部下游，Kahn 拓扑序） |
 * | `Shift+R` | 仅刷新陈旧节点（该节点下游的陈旧节点） |
 * | `Ctrl/Cmd+Enter` | 全图重跑（二次确认后执行） |
 *
 * 三条纪律：
 * - **不劫持浏览器键**：带 `Ctrl/Cmd` 的组合一律放行（`Ctrl+R` 刷新页面、`Ctrl+P` 打印），
 *   只例外接管 `Ctrl/Cmd+Enter`；
 * - **文本框 / 激活控件内不接管**（无障碍 §4.5：按钮上的按键归按钮）；
 * - **运行中不响应** `R` / `Alt+R` / `P` / `Shift+R`（§6.19.4：拓扑生成执行期间
 *   不响应这些键，直接按拓扑序覆盖下游），避免打断进行中的计划。
 *
 * 独立小组件而非塞进 CanvasSurface：它要订阅执行状态（isRunning），
 * 挂在 Surface 上会让整个画布随每个 task 状态变化重渲。
 */
export function RunHotkeys() {
  const store = useCanvasStore()
  const exec = useCanvasExecution()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      if (isTextEntryElement(target) || isActivationTarget(target)) return

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'Enter') {
          e.preventDefault()
          exec.requestRerunAll()
        }
        return
      }

      if (e.code !== 'KeyR' && e.code !== 'KeyP') return
      if (exec.isRunning) return

      const sel = store.getSelection()
      const nodeId = sel.length > 0 ? sel[sel.length - 1] : null
      if (!nodeId) return
      e.preventDefault()

      if (e.code === 'KeyP') {
        void exec.rerunFrom(nodeId)
      } else if (e.shiftKey) {
        void exec.refreshStale(nodeId)
      } else {
        void exec.runNode(nodeId, { alt: e.altKey })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, exec])

  return null
}
