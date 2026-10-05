import { useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '../registry'
import type { PromptData } from '../../../../domain/canvas/model/node'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { usePromptTools } from '../../../../features/shared/promptTools/usePromptTools'
import type { PromptToolAction } from '../../../../features/shared/promptTools/promptTools'
import { MarkdownBlocks } from '../../text/MarkdownBlocks'
import { usePresetTextOptional } from '../../../../app/providers/PresetTextProvider'
import { IconStop } from '../../toolbar/icons'
import styles from './PromptNodeView.module.css'

/**
 * 提示词节点视图（M0-5 全链路的核心节点）。
 *
 * **显示层**：正文按 Markdown 渲染（标题变大、粗体加粗），**符号不显示**
 * ——用户看到的是格式效果，不是 `##` `**`（用户 2026-09-21）。
 *
 * **编辑入口**（2026-09-21 改）：
 * - 双击正文 = **全选**，不再进节点内编辑态（用户明确要求）。
 * - 正文的编辑走两处：**节点跟随栏的格式工具栏**（整段处理）与
 *   **文本编辑灯箱**（按光标精细编辑，右键「全屏编辑」或工具栏最右按钮打开）。
 *
 * 文本变更经 emit(updateData) 上抛，由页面装配层翻译成 node.updateData 命令。
 * 底部栏（§6.7）：左字数裸放，右「优化 / 翻译」浅灰圆角容器；
 * LLM 结果覆盖文本且 transient:false 进撤销栈；失败保留原文显示可重试原因。
 */
export function PromptNodeView(props: NodeViewProps) {
  const data = props.node.data as PromptData
  const bodyRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  /** 是否处于**节点内编辑态**（双击进入；Esc / 失焦退出） */
  const [editing, setEditing] = useState(false)
  const exec = useCanvasExecution()
  /** 功能预设词（后台中枢）：节点本体上的优化 / 翻译 / 反推也要按改过的指令跑 */
  const presetText = usePresetTextOptional()

  /** 进入编辑态即聚焦并把光标放到末尾（用户双击就是要接着写） */
  useEffect(() => {
    if (!editing) return
    const ta = editRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [editing])

  /**
   * 上游图片素材（§6.7 反推）：由 画布表面 用 `promptSpec.collectInputs` 算好注入，
   * 与真正发出去的请求同源——不在这里另扫一遍图。
   */
  const imageInputs = props.upstreamImageInputs ?? []

  const tools = usePromptTools({
    completeText: exec.completeText,
    channelId: data.channelId,
    model: data.model,
    imageInputs,
    presetOverrides: presetText.overrides,
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
    // 与渲染处同一口径：`text` 按可选处理（缺字段时视作空文本，而不是崩）
    const lacksInput =
      action === 'describe' ? imageInputs.length === 0 : (data.text ?? '').length === 0
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
        {isActive ? <IconStop size={14} /> : label}
      </button>
    )
  }

  /**
   * 双击的**两态语义**（用户 2026-09-21 明确）。
   *
   * - **非编辑态** → 双击 = 进入编辑态（这是进入编辑的唯一入口，少了它节点没法输入）
   * - **编辑态 + 有文字** → 双击 = 全选正文（再点一次就是「改全部」，与浏览器
   *   地址栏、Word 的行为一致）
   *
   * ⚠️ 上一版把它写成「永远全选」并删掉了输入框，结果是**双击没反应、也打不了字**
   * ——功能被改坏。这条注释留着，避免以后又把它简化成单态。
   */
  const onBodyDoubleClick = () => {
    if (!editing) {
      setEditing(true)
      return
    }
    if (!data.text) return
    /*
     * 编辑态里全选**必须落在 textarea 自己的选区上**（`select()`），
     * 不能去动 window 的 Range——编辑时 `bodyRef` 指向的那个渲染层已经不在 DOM 里
     * （被 textarea 顶掉了），对它建 Range 会选中一个 0 尺寸的游离节点，
     * 实测表现为「双击只选了一个字」（浏览器默认的按词选中），而不是全选。
     */
    editRef.current?.select()
  }

  return (
    <div className={styles.body}>
      {/* §6.7：上游连了提示词节点时，文本区上方出现胶囊——它是「上游文本不会自动带进来」
          这件事唯一的界面说明（数量由 画布表面 注入，视图层不读图，架构 §4.7） */}
      {(props.upstreamPromptCount ?? 0) > 0 && (
        <span className={styles.linked} data-prompt-linked>
          上游已链接提示词节点
        </span>
      )}
      {editing ? (
        <textarea
          ref={editRef}
          className={styles.editArea}
          data-prompt-inline-input
          value={data.text}
          placeholder="输入提示词…"
          onChange={(e) => props.emit({ type: 'updateData', patch: { text: e.target.value } })}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={() => setEditing(false)}
          onDoubleClick={onBodyDoubleClick}
          onKeyDown={(e) => {
            // 编辑态里 Esc 退出；其余按键不透传给画布快捷键
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
            e.stopPropagation()
          }}
        />
      ) : (
        <div className={styles.text} ref={bodyRef} onDoubleClick={onBodyDoubleClick}>
          {data.text ? (
            <MarkdownBlocks source={data.text} />
          ) : (
            <span className={styles.placeholder}>双击输入提示词…</span>
          )}
        </div>
      )}
      <div className={styles.footer}>
        <span className={styles.count} data-prompt-count>
          {/*
            必须和上面那个 `data.text ? ... : ...` 用同一个兜底（用户 2026-09-23 报黑屏）。

            上面渲染正文时防了空值，这里却直接读 `.length` —— **同一份数据两处口径不一致**。
            只要 `text` 是 undefined（老库数据、或某条创建路径漏带该字段），
            这一行就抛 `Cannot read properties of undefined (reading 'length')`，
            React 整棵树随之挂掉 ⇒ **整个画布黑屏**。

            这里以「节点数据可能缺字段」为前提：视图层对数据一律按可选处理，
            崩一次的代价（整页白屏、用户丢掉所有未保存操作）远大于多写一个 `?? ''`。
          */}
          {(data.text ?? '').length} 字
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
