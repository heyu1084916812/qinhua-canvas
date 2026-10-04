import { describe, expect, it } from 'vitest'
import { FUSION_MIN_EDGE } from '../fusion/fusionPlan'
import { faceBoxToRect, parseFaceBox } from './faceBox'

/**
 * 人脸框解析与换算（用户 2026-10-05 第五批第 1 条）。
 *
 * 这一层的取舍是「**拿不准就不裁**」：模型的话千奇百怪（夹解释、给百分数、
 * 没有脸时硬编一个框），解析器必须把不可信的答案判成 null，
 * 由上层如实告诉用户「没识别到，请手动框选」——裁错位置比不裁更糟。
 */

describe('parseFaceBox', () => {
  it('★ 标准 JSON → 归一化框', () => {
    expect(parseFaceBox('{"x":0.1,"y":0.2,"w":0.3,"h":0.4}')).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    })
  })

  it('★ 夹着解释也能抠出来（模型偶尔还是会啰嗦一句）', () => {
    expect(parseFaceBox('好的，人脸在左上：{"x":0,"y":0,"w":0.5,"h":0.5} 就是这样')).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
    })
  })

  it('★★ 给百分数（0–100）也要认：任何一项 > 1 就按 100 归一', () => {
    const box = parseFaceBox('{"x":10,"y":20,"w":30,"h":40}')
    expect(box).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
  })

  it('★ 宽高的别名 width / height 也认', () => {
    expect(parseFaceBox('{"x":0.2,"y":0.2,"width":0.2,"height":0.2}')).toMatchObject({ w: 0.2, h: 0.2 })
  })

  it('★★ 没有脸 → 明确返回 null（不许硬编一个框）', () => {
    expect(parseFaceBox('{"none":true}')).toBeNull()
    expect(parseFaceBox('图里没有人脸')).toBeNull()
  })

  it('★★ 不可信的答案一律 null：缺字段 / 不是 JSON / 太小 / 离谱', () => {
    expect(parseFaceBox('')).toBeNull()
    expect(parseFaceBox('{"x":0.1,"y":0.2}')).toBeNull()
    expect(parseFaceBox('not json at all')).toBeNull()
    /** 小到没有意义（0.5% 宽） */
    expect(parseFaceBox('{"x":0.1,"y":0.1,"w":0.005,"h":0.4}')).toBeNull()
    /** 数值离谱（超过 100 的百分数） */
    expect(parseFaceBox('{"x":200,"y":200,"w":300,"h":300}')).toBeNull()
    /** 中心跑到画面外 */
    expect(parseFaceBox('{"x":3,"y":3,"w":0.2,"h":0.2}')).toBeNull()
  })
})

describe('faceBoxToRect', () => {
  it('★ 归一化框 → 像素矩形，并向外扩一圈（给模型留上下文）', () => {
    const r = faceBoxToRect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1000, 800, 0.35)
    /** 中心 (500,400)；0.2×1000×(1+0.7)=340 宽、0.2×800×1.7=272 高 */
    expect(r.w).toBe(340)
    expect(r.h).toBe(272)
    expect(r.x).toBe(Math.round(500 - 170))
    expect(r.y).toBe(Math.round(400 - 136))
  })

  it('★★ 贴边时**整框挪进画面**（不是裁小）：靠左的脸也拿到完整一块', () => {
    const r = faceBoxToRect({ x: 0, y: 0, w: 0.2, h: 0.2 }, 1000, 800, 0.35)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.w).toBe(340)
    expect(r.h).toBe(272)
  })

  it('★ 极小的框也要够短边下限（否则局部图连模型都喂不进去）', () => {
    const r = faceBoxToRect({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, 200, 200, 0.35)
    expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(FUSION_MIN_EDGE)
  })

  it('★ 矩形永远落在画面内', () => {
    const r = faceBoxToRect({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, 500, 400, 0.35)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w).toBeLessThanOrEqual(500)
    expect(r.y + r.h).toBeLessThanOrEqual(400)
  })
})
