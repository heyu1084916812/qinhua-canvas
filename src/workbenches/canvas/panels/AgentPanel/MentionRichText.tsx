import styles from '../../text/MentionEditor.module.css'
import {
  MENTION_ICON,
  MENTION_SPLIT_RE,
  mentionIdOf,
  mentionKindOf,
  mentionLabel,
} from '../../text/MentionEditor'

/**
 * **只读**的 @ 引用渲染：把 `@[名字](node:id)` 渲染成与输入框**同一套**的矩形框。
 *
 * 为什么要它（用户 2026-10-05 第 5 条：「艾特的图片、模型或者选择的 skill 在输入框内
 * 是有一个自己的框的，但是发出去在对话中就没有了，这样会让我分辨不了」）：
 * 发出去之后那条用户消息被当成纯文本渲染 —— 用户写了三个框，回看只剩一串名字，
 * 「我到底引用了哪个节点」就无从判断。
 *
 * 三条纪律：
 * ① **复用 `MentionEditor` 的图标与 CSS**，不另画一套外观 —— 输入框里长什么样，
 *    对话里就长什么样（两套样式迟早分叉）；
 * ② 节点引用能带缩略图（与输入框一致），拿不到就只显示图标 + 名字；
 * ③ 解析走 `MENTION_SPLIT_RE` 同一份正则，不在这里重写一遍语法。
 */
export function MentionRichText({
  text,
  thumbOf,
}: {
  text: string
  /** 按节点 id 取缩略图（objectURL）；拿不到返回 null */
  thumbOf?: (nodeId: string) => string | null
}) {
  return (
    <>
      {String(text ?? '')
        .split(MENTION_SPLIT_RE)
        .map((part, i) => {
          const kind = part.startsWith('@[') ? mentionKindOf(part) : null
          if (!kind) return part ? <span key={i}>{part}</span> : null
          const id = mentionIdOf(part) ?? ''
          const url = kind === 'node' ? (thumbOf?.(id) ?? null) : null
          return (
            <span
              key={i}
              className={styles.chip}
              data-mention-kind={kind}
              {...(url ? { 'data-has-thumb': 'true' } : {})}
            >
              <span className={styles.chipThumb}>
                {url ? <img className={styles.chipThumbImg} src={url} alt="" /> : null}
              </span>
              <span
                className={styles.chipIcon}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: MENTION_ICON[kind] }}
              />
              <span className={styles.chipLabel}>{mentionLabel(part)}</span>
            </span>
          )
        })}
    </>
  )
}
