import { describe, expect, it } from 'vitest'
import {
  diffDomSnapshots,
  evaluateGate,
  evaluateImageDiff,
  evaluateRuntimeEvents,
  hashSnapshot,
  stableJson,
} from './check-tauri-ui-freeze.mjs'

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

function auxiliaryGeometry(width, height, overrides = {}) {
  return geometry({
    viewport: { width, height, dpr: 1 },
    projectTree: {
      top: 360,
      bottom: 620,
      contentFullyAccessible: true,
      projectRows: 8,
    },
    settings: { top: 626, bottom: 690 },
    ...overrides,
  })
}

describe('evaluateGate', () => {
  it('passes all three required viewports', () => {
    const result = evaluateGate(geometry(), [
      auxiliaryGeometry(1024, 700),
      auxiliaryGeometry(1178, 762),
    ])
    expect(result.ok).toBe(true)
    expect(result.auxiliaryProblems).toHaveLength(2)
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
      [auxiliaryGeometry(1024, 700), auxiliaryGeometry(1178, 762)],
    )
    expect(result.ok).toBe(false)
    expect(result.realProblems.join('\n')).toContain('is not above settings')
  })

  it('requires every auxiliary viewport to pass', () => {
    const failing = auxiliaryGeometry(1178, 762, {
      settings: { top: 600, bottom: 700 },
    })
    const result = evaluateGate(geometry(), [
      auxiliaryGeometry(1024, 700),
      failing,
    ])
    expect(result.ok).toBe(false)
    expect(result.auxiliaryProblems[1].problems.join('\n')).toContain(
      'is not above settings',
    )
  })

  it('fails when an emulated viewport did not actually resize', () => {
    const result = evaluateGate(geometry(), [
      auxiliaryGeometry(1440, 900),
      auxiliaryGeometry(1178, 762),
    ])
    expect(result.ok).toBe(false)
    expect(result.auxiliaryProblems[0].problems.join('\n')).toContain(
      'expected 1024',
    )
  })

  it('requires exactly two auxiliary viewport results', () => {
    const result = evaluateGate(geometry(), [])
    expect(result.ok).toBe(false)
    expect(result.auxiliaryProblems).toHaveLength(3)
  })
})

describe('DOM snapshot comparison', () => {
  it('hashes objects independently of key insertion order', () => {
    const left = { z: 1, nested: { b: 2, a: 1 } }
    const right = { nested: { a: 1, b: 2 }, z: 1 }
    expect(stableJson(left)).toBe(stableJson(right))
    expect(hashSnapshot(left)).toBe(hashSnapshot(right))
  })

  it('reports nested snapshot differences with a stable pointer', () => {
    const differences = diffDomSnapshots(
      {
        regions: [{ anchor: [['data-app-sidebar', '']], rect: { width: 240 } }],
        visibleText: 'before',
      },
      {
        regions: [{ anchor: [['data-app-sidebar', '']], rect: { width: 260 } }],
        visibleText: 'before',
      },
    )
    expect(differences).toContain('$.regions[0].rect.width: baseline=240 current=260')
  })

  it('returns no differences for equal snapshots', () => {
    expect(diffDomSnapshots({ a: [1, 2] }, { a: [1, 2] })).toEqual([])
  })
})

describe('runtime event gate', () => {
  it('fails page errors and failed resources', () => {
    const result = evaluateRuntimeEvents({
      consoleErrors: [],
      pageErrors: [{ message: 'uncaught boom' }],
      logErrors: [],
      resourceFailures: [{ message: 'net::ERR_FAILED' }],
      httpErrors: [],
    })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('uncaught boom')
    expect(result.problems.join('\n')).toContain('net::ERR_FAILED')
  })

  it('does not fail warnings alone', () => {
    const result = evaluateRuntimeEvents({
      consoleErrors: [],
      consoleWarnings: [{ message: 'deprecated' }],
      pageErrors: [],
      logErrors: [],
      resourceFailures: [],
      httpErrors: [],
    })
    expect(result.ok).toBe(true)
  })
})

describe('image diff gate', () => {
  it('allows differences inside the calibrated threshold', () => {
    expect(
      evaluateImageDiff({
        ratio: 0.00001,
        maxChannelDelta: 20,
        differencePixels: 10,
      }).ok,
    ).toBe(true)
  })

  it('fails a broad changed area', () => {
    expect(
      evaluateImageDiff({
        ratio: 0.001,
        maxChannelDelta: 30,
        differencePixels: 500,
      }).ok,
    ).toBe(false)
  })

  it('fails a strong local change', () => {
    expect(
      evaluateImageDiff({
        ratio: 0.00001,
        maxChannelDelta: 180,
        differencePixels: 240,
      }).ok,
    ).toBe(false)
  })
})
