import { describe, expect, it } from 'vitest'
import { projectMenuPosition } from './projectMenuPosition'

const viewport = { width: 1200, height: 800 }

describe('projectMenuPosition', () => {
  it('内容高度不大时优先向下，不再因为固定 500px 估算而上翻', () => {
    const frame = projectMenuPosition(
      { left: 100, right: 300, top: 600, bottom: 630 },
      180,
      viewport,
    )
    expect(frame.top).toBe(634)
    expect(frame.maxHeight).toBe(158)
  })

  it('下方不够但上方够时翻到上方，并贴住可用边界', () => {
    const frame = projectMenuPosition(
      { left: 100, right: 300, top: 700, bottom: 730 },
      360,
      viewport,
    )
    expect(frame.top).toBe(336)
    expect(frame.maxHeight).toBe(360)
  })

  it('下方仍能显示可用菜单时继续向下，只在菜单内部滚动', () => {
    const frame = projectMenuPosition(
      { left: 100, right: 300, top: 560, bottom: 600 },
      900,
      viewport,
    )
    expect(frame.top).toBe(604)
    expect(frame.maxHeight).toBe(188)
  })
})
