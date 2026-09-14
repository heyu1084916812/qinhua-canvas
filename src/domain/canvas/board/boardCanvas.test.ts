import { describe, it, expect } from 'vitest'
import { clientToLogical, strokePath, makeStroke, makeText } from './boardCanvas'

describe('boardCanvas', () => {
  describe('clientToLogical', () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 }

    it('画板逻辑尺寸 400×300 且屏幕等尺寸时 1:1 映射', () => {
      const p = clientToLogical(rect, 200, 125, 400, 300)
      expect(p).toEqual({ x: 100, y: 75 })
    })

    it('屏幕被世界缩放放大 2x 时仍能折算回逻辑坐标', () => {
      // 屏幕宽 800（逻辑 400 × 2），点击屏幕 500 → 逻辑 (500-100)/2 = 200
      const scaled = { ...rect, width: 800, height: 600 }
      const p = clientToLogical(scaled, 500, 350, 400, 300)
      expect(p).toEqual({ x: 200, y: 150 })
    })

    it('节点缩放：屏幕宽 200（逻辑 400 × 0.5）折算正确', () => {
      const scaled = { ...rect, width: 200, height: 150 }
      const p = clientToLogical(scaled, 150, 125, 400, 300)
      expect(p).toEqual({ x: 100, y: 150 })
    })
  })

  describe('strokePath', () => {
    it('空点集返回空串', () => {
      expect(strokePath([])).toBe('')
    })
    it('单点画成圆点', () => {
      expect(strokePath([{ x: 10, y: 20 }])).toBe('M 10 20 l 0.01 0')
    })
    it('多点折线连接', () => {
      const d = strokePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 0 },
      ])
      expect(d).toBe('M 0 0 L 10 5 L 20 0')
    })
  })

  describe('factories', () => {
    it('makeStroke 透传可调参数', () => {
      const s = makeStroke({ id: 's1', color: '#000', width: 4, feather: 2, points: [{ x: 1, y: 2 }] })
      expect(s).toEqual({ id: 's1', color: '#000', width: 4, feather: 2, points: [{ x: 1, y: 2 }] })
    })
    it('makeText 透传可调参数', () => {
      const t = makeText({ id: 't1', x: 5, y: 6, text: 'hi', size: 24, color: '#f00', weight: 700 })
      expect(t).toEqual({ id: 't1', x: 5, y: 6, text: 'hi', size: 24, color: '#f00', weight: 700 })
    })
  })
})
