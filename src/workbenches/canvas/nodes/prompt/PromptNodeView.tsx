import { useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '../registry'
import type { PromptData } from '../../../../domain/canvas/model/node'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { usePromptTools } from '../../../../features/shared/promptTools/usePromptTools'
import type { PromptToolAction } from '../../../../features/shared/promptTools/promptTools'
import { parseMarkdown } from '../../../../domain/canvas/text/markdownRender'
import styles from './PromptNodeView.module.css'

/**
 * 正文的 Markdown 渲染（用户 2026-09-21：看格式、不看符号）。
 *
 * **认不出的语法原样显示**（由 `parseMarkdown` 保证）——用户写的每个字符
 * 都必须能看见，宁可少渲染一种格式，也不能吞掉内容。
 *
 * 用结构化块而不是 `dangerouslySetInnerHTML`：既免疫注入，也能被单测覆盖。
 */
function MarkdownBody({ source }: { source: string }) {
  const blocks = parseMarkdown(source)
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'divider') return <div key={i} className={styles.mdDivider} data-md-block="divider" />
        const cls =
          b.kind === 'h1'
            ? styles.mdH1
            : b.kind === 'h2'
              ? styles.mdH2
              : b.kind === 'h3'
                ? styles.mdH3
                : styles.mdParagraph
        return (
          <div key={i} className={cls} data-md-block={b.kind}>
            {(b.kind === 'bullet' || b.kind === 'ordered') && (
              <span className={styles.mdMarker}>{b.kind === 'bullet' ? '•' : `${b.order ?? 1}.`}</span>
            )}
            <span>
              {b.spans.length === 0 ? (
                <br />
              ) : (
                b.spans.map((s, j) => (
                  <span
                    key={j}
                    className={[s.bold ? styles.mdBold : '', s.italic ? styles.mdItalic : ''].filter(Boolean).join(' ')}
                  >
                    {s.text}
                  </span>
                ))
              )}
            </span>
          </div>
        )
      })}
    </>
  )
}

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

  /**
   * 双击正文 = **全选**（用户 2026-09-21）。
   *
   * 早先双击是「进入节点内编辑态」，但节点只有 240×160，长提示词写起来很憋屈；
   * 现在编辑统一走大编辑框，双击的语义改成「把正文全选起来，方便替换 / 复制」。
   * 用浏览器原生选区（不是自绘高亮），于是 Ctrl+C 立刻可用。
   */
  const selectAll = () => {
    const el = bodyRef.current
    if (!el) return
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
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
      <div className={styles.text} ref={bodyRef} onDoubleClick={selectAll}>
        {data.text ? (
          <MarkdownBody source={data.text} />
        ) : (
          <span className={styles.placeholder}>双击输入提示词…</span>
        )}
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
