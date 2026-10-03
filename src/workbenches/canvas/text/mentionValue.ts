import { mentionToken, stripMentionMarkup } from './MentionEditor'

/**
 * 节点正文里的 `@` 引用：**存储形态 ↔ 可显示文本** 的一对纯函数
 * （用户 2026-10-05 第 15 条：创作面板也要能 @ 本节点的上游素材）。
 *
 * ## 为什么存储里不留引用形态
 *
 * 提示词节点的 `data.text` / 生成节点的 `data.prompt` **不只是输入框里的字** —— 它
 * 直接就是发给模型的提示词，还被下游节点、反推 / 优化 / 翻译、节点本体正文读。
 * 一旦把 `@[图一](node:node_7)` 这种形态存进去，它就会顺着这些路漏进请求里
 * （读起来是一串给机器看的括号）。
 *
 * 所以定死：**存储里只有纯文本 `@图一`**，引用形态只在编辑器那一层存在。
 * 两边互转就是下面这两个函数，别在别处再写一份转换：
 * - 打开面板：`expandMentions(纯文本, 候选)` → 编辑器 value（chip 由此而来）；
 * - 用户一改：`collapseMentions(编辑器文本)` → 存回节点的纯文本。
 *
 * 这样做的代价（如实记下）：引用的**节点 id 不进存储**，所以节点改名 / 断线之后
 * 那颗 chip 会退回成普通文字 `@旧名字`。文字本身不会丢，只是不再是一个引用框 ——
 * 拿这个换「提示词永远是干净的纯文本」，是划算的。
 */

export interface MentionCandidate {
  /** 节点的 id（chip 要按它取缩略图） */
  id: string
  /** chip 上显示、同时也是正文里那个 `@名字` 用的名字 */
  label: string
}

/** 编辑器文本 → 纯文本（引用形态还原成 `@名字`） */
export function collapseMentions(text: string): string {
  return stripMentionMarkup(text)
}

/**
 * 纯文本 → 编辑器文本（命中候选名字的 `@名字` 变成引用形态）。
 *
 * 为什么是「手写扫描」而不是拼正则：候选名字是**用户起的标题**，里面出现
 * `(` `)` `[` `.` `*` 都很正常，拼进正则就是一类「有的名字能引用、有的不能」
 * 的隐藏雷。逐字符匹配没有这个问题。
 *
 * 长名字优先：上游同时有「图」和「图 2」两个节点时，先匹配长的那个，
 * 否则 `@图 2` 会被「图」抢先吃掉、剩下一个孤零零的 `2`。
 */
export function expandMentions(plain: string, candidates: readonly MentionCandidate[]): string {
  const list = [...candidates]
    .filter((c) => c.id && c.label.trim())
    .sort((a, b) => b.label.length - a.label.length)
  const text = String(plain ?? '')
  if (list.length === 0) return text

  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '@') {
      const hit = list.find((c) => text.startsWith(c.label, i + 1))
      if (hit) {
        out += mentionToken('node', hit.id, hit.label)
        i += 1 + hit.label.length
        continue
      }
    }
    out += text[i]
    i += 1
  }
  return out
}
