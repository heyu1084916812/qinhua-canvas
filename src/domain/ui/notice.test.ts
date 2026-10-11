import { describe, expect, it } from 'vitest'
import { noticeA11y, type NoticeTone } from './notice'

describe('提示语气 → 无障碍属性（产品文档 §4.5）', () => {
  it('error 走 role=alert + aria-live=assertive（打断朗读）', () => {
    expect(noticeA11y('error')).toEqual({ role: 'alert', 'aria-live': 'assertive' })
  })

  it('info 走 role=status + aria-live=polite（等朗读完）', () => {
    expect(noticeA11y('info')).toEqual({ role: 'status', 'aria-live': 'polite' })
  })

  it('两档的 role 与 aria-live 必须成对（不许出现 alert+polite 这种混搭）', () => {
    const pairs: ReadonlyArray<readonly [NoticeTone, string, string]> = [
      ['error', 'alert', 'assertive'],
      ['info', 'status', 'polite'],
    ]
    for (const [tone, role, live] of pairs) {
      const attrs = noticeA11y(tone)
      expect([attrs.role, attrs['aria-live']]).toEqual([role, live])
    }
  })
})
