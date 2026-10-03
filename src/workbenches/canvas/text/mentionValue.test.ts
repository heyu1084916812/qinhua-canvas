import { describe, expect, it } from 'vitest'
import { mentionToken, parseMentions } from './MentionEditor'
import { collapseMentions, expandMentions, type MentionCandidate } from './mentionValue'

const 图一: MentionCandidate = { id: 'node_a', label: '图一' }
const 图十二: MentionCandidate = { id: 'node_b', label: '图十二' }

describe('创作面板的 @ 引用：存储形态 ↔ 纯文本', () => {
  it('把 `@名字` 展开成引用形态（编辑器据此画 chip）', () => {
    expect(expandMentions('把 @图一 调亮', [图一])).toBe(
      `把 ${mentionToken('node', 'node_a', '图一')} 调亮`,
    )
  })

  it('长名字优先：`@图十二` 不会被 `@图一` 抢走', () => {
    const out = expandMentions('@图十二 和 @图一', [图一, 图十二])
    expect(parseMentions(out).map((m) => m.id)).toEqual(['node_b', 'node_a'])
  })

  it('往返一次回到原文（这是「存储里只有纯文本」那条口径的证明）', () => {
    const plain = '参考 @图一 的光线，把 @图十二 换成夜景'
    expect(collapseMentions(expandMentions(plain, [图一, 图十二]))).toBe(plain)
  })

  it('没有候选 / 名字对不上：原样返回，不凭空造引用', () => {
    expect(expandMentions('@图一 调亮', [])).toBe('@图一 调亮')
    expect(expandMentions('@别的 调亮', [图一])).toBe('@别的 调亮')
    expect(expandMentions('@ 空名字', [{ id: 'n', label: '   ' }])).toBe('@ 空名字')
  })

  it('标题里带正则元字符也照样能引用（不拼正则的理由）', () => {
    const weird: MentionCandidate = { id: 'node_c', label: '图(1).*版' }
    const out = expandMentions('用 @图(1).*版 打底', [weird])
    /** `mentionToken` 会把 `(` `)` 换成空格（不然引用形态会被正则切断），名字里的点号原样保留 */
    expect(parseMentions(out)).toEqual([{ kind: 'node', id: 'node_c', label: '图 1 .*版' }])
  })

  it('同一个名字出现两次，两处都是引用（不做「只认第一个」）', () => {
    const out = expandMentions('@图一 加亮，@图一 保留', [图一])
    expect(out.match(/@\[/g)).toHaveLength(2)
  })
})
