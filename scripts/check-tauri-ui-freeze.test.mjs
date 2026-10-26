import { describe, expect, it } from 'vitest'
import { evaluateGate } from './check-tauri-ui-freeze.mjs'

function geometry(overrides = {}) {
  return {
    isTauri: true,
    viewport: { width: 1440, height: 900, dpr: 1 },
    sidebar: { top: 33, bottom: 900 },
    projectTree: {
      top: 455,
      bottom: 776,
      contentFullyAccessible: true,
      projectRows: 12,
    },
    settings: { top: 782, bottom: 882 },
    horizontalOverflow: 0,
    ...overrides,
  }
}

describe('evaluateGate', () => {
  it('passes the real 1440x900 / DPR1 geometry', () => {
    expect(evaluateGate(geometry()).ok).toBe(true)
  })

  it('fails when project tree overlaps settings', () => {
    const result = evaluateGate(
      geometry({
        projectTree: {
          top: 455,
          bottom: 784,
          contentFullyAccessible: true,
          projectRows: 12,
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.realProblems.join('\n')).toContain('未小于设置区')
  })

  it('keeps emulated viewports advisory while real geometry remains the gate', () => {
    const simulated = geometry({
      viewport: { width: 1024, height: 700, dpr: 1 },
      projectTree: {
        top: 360,
        bottom: 620,
        contentFullyAccessible: true,
        projectRows: 8,
      },
      settings: { top: 626, bottom: 690 },
    })
    const result = evaluateGate(geometry(), [simulated])
    expect(result.ok).toBe(true)
    expect(result.auxiliaryProblems[0].problems).toEqual([])
  })
})
