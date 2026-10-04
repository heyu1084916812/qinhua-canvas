import { describe, expect, it } from 'vitest'
import {
  normalizeDetectorBox,
  parseDetectorResponse,
  pickPrimaryFace,
  type FaceBox,
} from './faceDetect'

/**
 * 人脸框的形状与换算（本机检测那条路）。
 *
 * 这一层的取舍与「问模型」那条路**同一套**：拿不准就不裁。
 * 检测器给的像素框只要有一点离谱（超出画面、小到没有意义），一律判 null ——
 * 裁错位置比不裁更糟，用户会看到一张「改到背景上」的图却以为是自己点错了。
 */

describe('normalizeDetectorBox', () => {
  it('★ 像素框 → 归一化框（相对图片尺寸）', () => {
    expect(normalizeDetectorBox({ x: 100, y: 50, width: 200, height: 100 }, 1000, 500)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    })
  })

  it('★ 可信度一起带回来（上层据此判断要不要采信）', () => {
    expect(normalizeDetectorBox({ x: 0, y: 0, width: 100, height: 100, score: 0.9 }, 400, 400)).toEqual({
      x: 0,
      y: 0,
      w: 0.25,
      h: 0.25,
      score: 0.9,
    })
  })

  it('★★ 超出画面 → 夹回画面内（而不是原样返回一个越界的框）', () => {
    const box = normalizeDetectorBox({ x: 950, y: 0, width: 200, height: 100 }, 1000, 500)
    expect(box).not.toBeNull()
    expect(box!.x + box!.w).toBeLessThanOrEqual(1.0001)
  })

  it('★★ 小到没有意义 → null（不裁比裁错好）', () => {
    expect(normalizeDetectorBox({ x: 10, y: 10, width: 4, height: 4 }, 1000, 1000)).toBeNull()
  })

  it('★ 尺寸为 0 也不炸（除零守卫）', () => {
    expect(normalizeDetectorBox({ x: 0, y: 0, width: 10, height: 10 }, 0, 0)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    })
  })
})

describe('parseDetectorResponse', () => {
  it('★ 正常回包：id + faces', () => {
    expect(
      parseDetectorResponse({ id: 3, faces: [{ x: 1, y: 2, width: 3, height: 4, score: 0.5 }] }),
    ).toEqual({ id: 3, faces: [{ x: 1, y: 2, width: 3, height: 4, score: 0.5 }] })
  })

  it('★ 认不出脸：faces 是空数组（≠ 回包坏掉）', () => {
    expect(parseDetectorResponse({ id: 1, faces: [] })).toEqual({ id: 1, faces: [] })
  })

  it('★ worker 报错：error 带回来', () => {
    expect(parseDetectorResponse({ id: 2, error: '模型缺失' })).toEqual({
      id: 2,
      error: '模型缺失',
      faces: [],
    })
  })

  it('★★ 形状不认识一律 null：id 不是整数 / faces 不是数组 / 数字不是数 / score 不对', () => {
    expect(parseDetectorResponse(null)).toBeNull()
    expect(parseDetectorResponse('nope')).toBeNull()
    expect(parseDetectorResponse({ id: 1.5, faces: [] })).toBeNull()
    expect(parseDetectorResponse({ id: 1, faces: 'x' })).toBeNull()
    expect(parseDetectorResponse({ id: 1, faces: [{ x: 0, y: 0, width: NaN, height: 1 }] })).toBeNull()
    expect(parseDetectorResponse({ id: 1, faces: [{ x: 0, y: 0, width: 1, height: 1, score: 'hi' }] })).toBeNull()
    expect(parseDetectorResponse({ id: 1, error: 5 })).toBeNull()
  })
})

describe('pickPrimaryFace', () => {
  it('★★ 多张脸取**面积最大**的那张（一键跑，没有让人挑的那一步）', () => {
    const small: FaceBox = { x: 0, y: 0, w: 0.1, h: 0.1 }
    const big: FaceBox = { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }
    expect(pickPrimaryFace([small, big])).toBe(big)
    expect(pickPrimaryFace([big, small])).toBe(big)
  })

  it('★ 没有候选 → null', () => {
    expect(pickPrimaryFace([])).toBeNull()
  })
})
