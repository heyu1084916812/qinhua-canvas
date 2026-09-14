import { useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '../registry'
import type { PromptData } from '../../../../domain/canvas/model/node'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { usePromptTools } from '../../../../features/shared/promptTools/usePromptTools'
import type { PromptToolAction } from '../../../../features/shared/promptTools/promptTools'
import styles from './PromptNodeView.module.css'

/**
 * 提示词节点视图（M0-5 全链路的核心节点）。
 * 双击正文进入编辑态（产品文档 §4.3）；编辑中按键不透传画布快捷键。
 * 文本变更经 emit(updateData) 上抛，由页面装配层翻译成 node.updateData 命令。
 *
 * 底部栏（§6.7）：左字数裸放，右「优化 / 翻译」浅灰圆角容器；
 * LLM 结果覆盖文本且 transient:false 进撤销栈；失败保留原文显示可重试原因。
 */
export function PromptNodeView(props: NodeViewProps) {
  const data = props.node.data as PromptData
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const exec = useCanvasExecution()

  /**
   * 上游图片素材（§6.7 反推）：由 NodeLayer 用 `promptSpec.collectInputs` 算好注入，
   * 与真正发出去的请求同源——不在这里另扫一遍图。
   */
  const imageInputs = props.upstreamImageInputs ?? []

  const tools = usePromptTools({
    completeText: exec.completeText,
    channelId: data.channelId,
    model: data.model,
    imageInputs,
    onResult: (text) =>
      props.emit({ type: 'updateData', patch: { text }, transient: false }),
  })
  const [activeAction, setActiveAction] = useState<PromptToolAction | null>(null)
  useEffect(() => {
    if (tools.status !== 'running') setActiveAction(null)
  }, [tools.status])
  const busy = tools.status === 'running'

  const runTool = (action: PromptToolAction) => {
    // 运行中再点 = 取消（§6.7「请求期间进入进行中状态并可取消」）
    if (busy) {
      tools.cancel()
      return
    }
    setActiveAction(action)
    tools.run(data.text, action)
  }

  const toolButton = (action: PromptToolAction, label: string, idleTitle: string) => {
    const isActive = busy && activeAction === action
    // 反推的输入是**图**不是文本，所以它的禁用条件与其它两个动作相反：
    // 有图就能点（哪怕一个字都没有），没图点了也是空跑。
    const lacksInput = action === 'describe' ? imageInputs.length === 0 : data.text.length === 0
    return (
      <button
        type="button"
        data-prompt-tool={action}
        className={isActive ? styles.toolBtnBusy : styles.toolBtn}
        disabled={(lacksInput && !busy) || (busy && !isActive)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => runTool(action)}
        title={isActive ? '取消' : tools.error ?? idleTitle}
      >
        {isActive ? '■' : label}
      </button>
    )
  }

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  if (editing) {
    return (
      <textarea
        ref={ref}
        className={styles.textarea}
        value={data.text}
        placeholder="双击输入提示词…"
        onChange={(e) => props.emit({ type: 'updateData', patch: { text: e.target.value } })}
        onBlur={() => setEditing(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
          e.stopPropagation()
        }}
      />
    )
  }

  return (
    <div className={styles.body}>
      {/* §6.7：上游连了提示词节点时，文本区上方出现胶囊——它是「上游文本不会自动带进来」
          这件事唯一的界面说明（数量由 NodeLayer 注入，视图层不读图，架构 §4.7） */}
      {(props.upstreamPromptCount ?? 0) > 0 && (
        <span className={styles.linked} data-prompt-linked>
          上游已链接提示词节点
        </span>
      )}
      <div className={styles.text} onDoubleClick={() => setEditing(true)}>
        {data.text ? data.text : <span className={styles.placeholder}>双击输入提示词…</span>}
      </div>
      <div className={styles.footer}>
        <span className={styles.count} data-prompt-count>
          {data.text.length} 字
        </span>
        <span className={styles.tools} data-prompt-tools>
          {toolButton('optimize', '优化', '用文本模型优化此提示词')}
          {toolButton('translate', '翻译', '中文 ⇄ 英文互译')}
          {toolButton(
            'describe',
            '反推',
            imageInputs.length > 0
              ? `把上游 ${imageInputs.length} 张图发给文本模型，反推出绘画提示词（覆盖当前文本）`
              : '反推需要上游图片：先把一个已出图的生成节点连到本节点',
          )}
        </span>
      </div>
      {tools.error && (
        <div className={styles.toolError} data-prompt-tool-error>
          {tools.error}
        </div>
      )}
    </div>
  )
}
