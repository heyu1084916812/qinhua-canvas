import { describe, it, expect } from 'vitest'
import { isTextEntryElement, isActivationTarget } from './textTarget'

describe('激活类控件判定', () => {
  it('按钮 / 链接 / 下拉判定为激活类控件', () => {
    expect(isActivationTarget({ tagName: 'button' })).toBe(true)
    expect(isActivationTarget({ tagName: 'A' })).toBe(true)
    expect(isActivationTarget({ tagName: 'select' })).toBe(true)
    expect(isActivationTarget({ tagName: 'summary' })).toBe(true)
  })

  it('普通容器与文本框不判定为激活类控件', () => {
    expect(isActivationTarget({ tagName: 'div' })).toBe(false)
    expect(isActivationTarget({ tagName: 'textarea' })).toBe(false)
    expect(isActivationTarget(null)).toBe(false)
  })
})

describe('文本输入元素判定', () => {
  it('textarea / input 判定为文本元素', () => {
    expect(isTextEntryElement({ tagName: 'textarea' })).toBe(true)
    expect(isTextEntryElement({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntryElement({ tagName: 'INPUT' })).toBe(true)
  })

  it('普通元素不判定为文本元素', () => {
    expect(isTextEntryElement({ tagName: 'div' })).toBe(false)
    expect(isTextEntryElement({ tagName: 'span' })).toBe(false)
    expect(isTextEntryElement({})).toBe(false)
    expect(isTextEntryElement(null)).toBe(false)
    expect(isTextEntryElement(undefined)).toBe(false)
  })

  it('contenteditable 元素判定为文本元素', () => {
    expect(isTextEntryElement({ tagName: 'div', isContentEditable: true })).toBe(true)
    expect(isTextEntryElement({ tagName: 'div', isContentEditable: false })).toBe(false)
  })

  it('仅可键入文字的输入框豁免画布快捷键，color/range/number 不豁免', () => {
    // 无 type 的 input 视为 text（向后兼容）
    expect(isTextEntryElement({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntryElement({ tagName: 'input', type: 'text' })).toBe(true)
    expect(isTextEntryElement({ tagName: 'input', type: 'search' })).toBe(true)
    expect(isTextEntryElement({ tagName: 'input', type: 'email' })).toBe(true)
    // 这些非文字输入不应吞掉 Ctrl+Z 等画布快捷键
    expect(isTextEntryElement({ tagName: 'input', type: 'color' })).toBe(false)
    expect(isTextEntryElement({ tagName: 'input', type: 'range' })).toBe(false)
    expect(isTextEntryElement({ tagName: 'input', type: 'number' })).toBe(false)
    expect(isTextEntryElement({ tagName: 'input', type: 'checkbox' })).toBe(false)
  })
})
