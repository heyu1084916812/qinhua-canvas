import { describe, expect, it } from 'vitest'
import { workbenchBlankDragIntent } from './workbenchGesture'

const gesture = (over: Partial<Parameters<typeof workbenchBlankDragIntent>[0]> = {}) =>
  workbenchBlankDragIntent({
    button: 0,
    tool: 'select',
    spaceHeld: false,
    ctrlKey: false,
    metaKey: false,
    ...over,
  })

describe('电商工作台空白手势', () => {
  it('左键拖动平移，Ctrl / Cmd + 左键拖动框选', () => {
    expect(gesture()).toBe('pan')
    expect(gesture({ ctrlKey: true })).toBe('marquee')
    expect(gesture({ metaKey: true })).toBe('marquee')
  })

  it('中键、手型工具和空格拖动都平移', () => {
    expect(gesture({ button: 1 })).toBe('pan')
    expect(gesture({ tool: 'hand' })).toBe('pan')
    expect(gesture({ spaceHeld: true })).toBe('pan')
  })

  it('不支持的鼠标键不启动画布手势', () => {
    expect(gesture({ button: 2 })).toBe('none')
  })
})
