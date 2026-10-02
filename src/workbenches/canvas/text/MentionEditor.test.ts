import { describe, expect, it } from 'vitest'
import {
  mentionKindOf,
  mentionLabel,
  mentionToken,
  parseMentions,
  stripMentionMarkup,
} from './MentionEditor'

/**
 * @ 引用的**存储形态**（用户 2026-10-02：引用要「作为文本内容的一部分」）。
 *
 * 芯片只是显示层，真正会被保存与发送的是 `@[显示名](kind:id)` 这串纯文本。
 * 所以这里钉的是「拼出来 → 解析回来是不是同一个人」以及「发给模型的正文里
 * 还留不留机器串」—— 这两件事一坏，表现就是「界面看着有引用、发出去却没有」。
 */
describe('@ 引用 · 存储形态', () => {
  it('★ 往返：拼出来能解析回同一个人', () => {
    const t = mentionToken('node', 'node_a1', '小猫钓鱼')
    expect(t).toBe('@[小猫钓鱼](node:node_a1)')
    expect(mentionLabel(t)).toBe('小猫钓鱼')
    expect(mentionKindOf(t)).toBe('node')
    expect(parseMentions(t)).toEqual([{ kind: 'node', id: 'node_a1', label: '小猫钓鱼' }])
  })

  /**
   * 显示名里的 `[` `]` `(` `)` 会把存储形态**切断** —— 正则在那些字符上收尾，
   * 于是芯片会在下一次渲染时变回一串纯文本（看着像「引用自己没了」）。
   */
  it('★ 显示名里带括号也不会把存储形态切断', () => {
    const t = mentionToken('model', 'Agnes 2.5 Pro', 'Agnes (2.5) [Pro]')
    expect(mentionKindOf(t)).toBe('model')
    expect(parseMentions(t)[0]?.id).toBe('Agnes 2.5 Pro')
  })

  it('★ 一句话里多个引用：按出现顺序给，重复的只报一次', () => {
    const a = mentionToken('node', 'n1', '甲')
    const b = mentionToken('model', 'GPT-6 Astra', 'GPT-6 Astra')
    const refs = parseMentions(`${a} 参考 ${b}，还是 ${a}`)
    expect(refs.map((m) => `${m.kind}:${m.id}`)).toEqual(['node:n1', 'model:GPT-6 Astra'])
  })

  it('★ 发给模型的正文里不留存储形态（括号串读起来像噪音）', () => {
    expect(stripMentionMarkup('把 @[小猫钓鱼](node:node_a1) 改成夜景')).toBe(
      '把 @小猫钓鱼 改成夜景',
    )
  })

  it('普通文本（含一个单独的 @）原样处理，不误判成引用', () => {
    expect(parseMentions('@你一下 你好')).toEqual([])
    expect(stripMentionMarkup('@你一下 你好')).toBe('@你一下 你好')
  })
})
