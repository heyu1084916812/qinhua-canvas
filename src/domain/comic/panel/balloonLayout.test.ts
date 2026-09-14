import { describe, it, expect } from 'vitest'
import type { BalloonType, ComicBalloon } from '../model/comicProject'
import {
  BALLOON_DEFAULT_H,
  BALLOON_DEFAULT_W,
  BALLOON_MIN_H,
  BALLOON_MIN_W,
  clamp01,
  clampBalloonRect,
  defaultBalloonRect,
  hasTail,
  movedBalloonRect,
  movedTail,
  resizedBalloonRect,
  sameTail,
  withBalloonType,
} from './balloonLayout'

/** 造一个贴纸（`exactOptionalPropertyTypes` 下不用 spread 塞可选字段） */
function mk(type: BalloonType = 'speech', tail?: { x: number; y: number }): ComicBalloon {
  const b: ComicBalloon = { id: 'b1', type, text: '', x: 0.2, y: 0.06, w: 0.6, h: 0.16 }
  if (tail) b.tail = tail
  return b
}

describe('balloonLayout / hasTail', () => {
  it('只有对白与心理有尾巴', () => {
    expect(hasTail('speech')).toBe(true)
    expect(hasTail('thought')).toBe(true)
    expect(hasTail('narration')).toBe(false)
    expect(hasTail('sfx')).toBe(false)
  })
})

describe('balloonLayout / defaultBalloonRect', () => {
  it('对话气泡默认带尾巴（下缘中点）', () => {
    const r = defaultBalloonRect('speech', 0)
    expect(r.w).toBe(BALLOON_DEFAULT_W)
    expect(r.h).toBe(BALLOON_DEFAULT_H)
    expect(r.tail).toEqual({ x: r.x + r.w / 2, y: r.y + r.h })
  })

  it('旁白 / 拟声无尾巴', () => {
    expect(defaultBalloonRect('narration', 0).tail).toBeUndefined()
    expect(defaultBalloonRect('sfx', 0).tail).toBeUndefined()
  })

  it('纵向叠放：序号越大越靠下，且不出格', () => {
    const a = defaultBalloonRect('speech', 0)
    const b = defaultBalloonRect('speech', 1)
    const c = defaultBalloonRect('speech', 2)
    expect(a.y).toBeLessThan(b.y)
    expect(b.y).toBeLessThan(c.y)
    // 极端序号也夹在格内
    expect(defaultBalloonRect('speech', 99).y).toBeLessThanOrEqual(1 - BALLOON_DEFAULT_H)
    expect(defaultBalloonRect('speech', -3).y).toBeGreaterThanOrEqual(0)
  })
})

describe('balloonLayout / clamp01 与 clampBalloonRect', () => {
  it('clamp01 夹进 [0,1]，非有限值归 0', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(0.3)).toBe(0.3)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('位置夹回格内（按尺寸留边，保证整个矩形不出格）', () => {
    const r = clampBalloonRect({ x: -0.5, y: 2, w: 0.6, h: 0.2 })
    expect(r.x).toBe(0)
    expect(r.y).toBeCloseTo(1 - 0.2, 6)
  })

  it('尺寸小于下限时抬到下限', () => {
    const r = clampBalloonRect({ x: 0, y: 0, w: 0, h: 0 })
    expect(r.w).toBe(BALLOON_MIN_W)
    expect(r.h).toBe(BALLOON_MIN_H)
  })

  it('尾巴锚点夹进 [0,1]', () => {
    const r = clampBalloonRect({ x: 0.1, y: 0.1, w: 0.5, h: 0.2, tail: { x: -1, y: 9 } })
    expect(r.tail).toEqual({ x: 0, y: 1 })
  })
})

describe('balloonLayout / sameTail', () => {
  it('都为 undefined 视为等价', () => {
    expect(sameTail(undefined, undefined)).toBe(true)
  })
  it('一有一无不等价', () => {
    expect(sameTail({ x: 0, y: 0 }, undefined)).toBe(false)
  })
  it('坐标相同等价，不同不等价', () => {
    expect(sameTail({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.2 })).toBe(true)
    expect(sameTail({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.3 })).toBe(false)
  })
})

describe('balloonLayout / movedBalloonRect', () => {
  it('平移贴纸时尾巴保持相对偏移一起走', () => {
    const b = mk('speech', { x: 0.5, y: 0.22 })
    const r = movedBalloonRect(b, 0.3, 0.16)
    expect(r.x).toBeCloseTo(0.3, 6)
    expect(r.y).toBeCloseTo(0.16, 6)
    // 尾巴位移与贴纸位移一致（dx=0.1, dy=0.1）
    expect(r.tail!.x).toBeCloseTo(0.6, 6)
    expect(r.tail!.y).toBeCloseTo(0.32, 6)
  })

  it('拖出格时夹回（位置与尾巴都被夹）', () => {
    const b = mk('speech', { x: 0.5, y: 0.22 })
    const r = movedBalloonRect(b, 5, 5)
    expect(r.x).toBeCloseTo(1 - b.w, 6)
    expect(r.y).toBeCloseTo(1 - b.h, 6)
    expect(r.tail!.x).toBeLessThanOrEqual(1)
    expect(r.tail!.y).toBeLessThanOrEqual(1)
  })

  it('无尾巴的贴纸平移后仍无尾巴', () => {
    const r = movedBalloonRect(mk('sfx'), 0.3, 0.3)
    expect(r.tail).toBeUndefined()
  })
})

describe('balloonLayout / resizedBalloonRect', () => {
  /** 默认尾巴（下缘中点）：x=0.2+0.3, y=0.06+0.16 */
  const DEFAULT_TAIL = { x: 0.5, y: 0.22 }

  it('左上角固定，只改尺寸', () => {
    const b = mk('speech', DEFAULT_TAIL)
    const r = resizedBalloonRect(b, 0.8, 0.3)
    expect(r.x).toBeCloseTo(b.x, 6)
    expect(r.y).toBeCloseTo(b.y, 6)
    expect(r.w).toBeCloseTo(0.8, 6)
    expect(r.h).toBeCloseTo(0.3, 6)
  })

  it('默认尾巴（下缘中点）放大后仍是新的下缘中点', () => {
    const r = resizedBalloonRect(mk('speech', DEFAULT_TAIL), 0.8, 0.32)
    expect(r.tail!.x).toBeCloseTo(r.x + r.w / 2, 6)
    expect(r.tail!.y).toBeCloseTo(r.y + r.h, 6)
  })

  it('拖过的尾巴（气泡正中）按比例跟随到新气泡正中', () => {
    const r = resizedBalloonRect(mk('speech', { x: 0.5, y: 0.14 }), 0.8, 0.32)
    expect(r.tail!.x).toBeCloseTo(r.x + r.w / 2, 6)
    expect(r.tail!.y).toBeCloseTo(r.y + r.h / 2, 6)
  })

  it('尺寸低于下限时抬到下限', () => {
    const r = resizedBalloonRect(mk('speech', DEFAULT_TAIL), 0.01, 0.001)
    expect(r.w).toBe(BALLOON_MIN_W)
    expect(r.h).toBe(BALLOON_MIN_H)
  })

  it('放大到出格时尺寸封顶 1、位置夹回格内、尾巴仍在格内', () => {
    const r = resizedBalloonRect(mk('speech', DEFAULT_TAIL), 5, 5)
    expect(r.w).toBe(1)
    expect(r.h).toBe(1)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.tail!.x).toBeLessThanOrEqual(1)
    expect(r.tail!.y).toBeLessThanOrEqual(1)
  })

  it('无尾巴的贴纸缩放后仍无尾巴', () => {
    expect(resizedBalloonRect(mk('sfx'), 0.5, 0.2).tail).toBeUndefined()
  })
})

describe('balloonLayout / movedTail', () => {
  it('把尾巴锚点设到新位置（改指向）', () => {
    expect(movedTail(mk('speech', { x: 0.5, y: 0.22 }), 0.3, 0.7)).toEqual({ x: 0.3, y: 0.7 })
  })

  it('拖出格时夹回 [0,1]', () => {
    expect(movedTail(mk('speech', { x: 0.5, y: 0.22 }), -2, 9)).toEqual({ x: 0, y: 1 })
  })

  it('无尾巴的贴纸返回 null（不可拖出尾巴）', () => {
    expect(movedTail(mk('sfx'), 0.3, 0.3)).toBeNull()
  })
})

describe('balloonLayout / withBalloonType', () => {
  it('类型未变返回原引用（供 reducer 判无变化）', () => {
    const b = mk('speech', { x: 0.5, y: 0.22 })
    expect(withBalloonType(b, 'speech')).toBe(b)
  })

  it('对白 → 心理：保留原尾巴', () => {
    const b = mk('speech', { x: 0.5, y: 0.22 })
    const next = withBalloonType(b, 'thought')
    expect(next.type).toBe('thought')
    expect(next.tail).toEqual({ x: 0.5, y: 0.22 })
  })

  it('对白 → 旁白：去掉尾巴', () => {
    const next = withBalloonType(mk('speech', { x: 0.5, y: 0.22 }), 'narration')
    expect(next.type).toBe('narration')
    expect(next.tail).toBeUndefined()
  })

  it('旁白 → 对白：补默认尾巴（下缘中点）', () => {
    const b = mk('narration')
    const next = withBalloonType(b, 'speech')
    expect(next.tail).toEqual({ x: b.x + b.w / 2, y: b.y + b.h })
  })
})
