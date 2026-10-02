import { parseMarkdown } from '../../../domain/canvas/text/markdownRender'
import styles from './MarkdownBlocks.module.css'

/**
 * 正文的 Markdown 只读渲染。**两个消费方共用这一份实现**：
 * 提示词节点本体（用户 2026-09-21）与画布 Agent 的助手气泡（用户 2026-10-02）。
 *
 * 要的效果是「**看格式、不看符号**」：`**粗**` 显示成粗体、`- ` 显示成圆点列表，
 * 而 `**` 与 `- ` 这些标记本身不出现。认不出的语法一律**原样显示**
 * （由 `parseMarkdown` 保证）—— 用户写的每个字符都必须能看见，
 * 宁可少渲染一种格式，也不能吞内容。
 *
 * 为什么从提示词节点里搬出来：助手气泡原先直接渲染纯文本，于是模型回的
 * `- **看看画布现状**` 把星号和杠原样打在界面上（用户 2026-10-02 的截图）。
 * 再抄一份渲染器是错的解法 —— 两处各写一份，下次补语法只会补一处。
 */
export function MarkdownBlocks({ source }: { source: string }) {
  const blocks = parseMarkdown(source)
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'divider') {
          return <div key={i} className={styles.mdDivider} data-md-block="divider" />
        }
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
              <span className={styles.mdMarker}>
                {b.kind === 'bullet' ? '•' : `${b.order ?? 1}.`}
              </span>
            )}
            <span>
              {b.spans.length === 0 ? (
                <br />
              ) : (
                b.spans.map((s, j) => (
                  <span
                    key={j}
                    className={[s.bold ? styles.mdBold : '', s.italic ? styles.mdItalic : '']
                      .filter(Boolean)
                      .join(' ')}
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
