import { describe, expect, it } from 'vitest'
import { faceBoxFailureReason, parseFaceBox } from './faceBox'

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

  /**
   * ★★ **像素坐标**是最常见的回法（模型按原图给框）。真机上「识别人脸失败」有一次
   * 就是这里判了 null —— 所以知道图片尺寸时，只要四个数都落在图内，就按像素换算。
   */
  it('★★ 知道图片尺寸时，像素坐标也能认（真机失败过一次的形态）', () => {
    const box = parseFaceBox('{"x":300,"y":160,"w":200,"h":240}', {
      width: 1000,
      height: 800,
    })
    expect(box).toEqual({ x: 0.3, y: 0.2, w: 0.2, h: 0.3 })
  })

  it('★★ 像素数超出图片范围 → 仍然判 null（不许把离谱值当坐标用）', () => {
    expect(
      parseFaceBox('{"x":3000,"y":160,"w":200,"h":240}', { width: 1000, height: 800 }),
    ).toBeNull()
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

/**
 * 失败说明（用户 2026-10-05：「情绪说识别人脸失败，查一下」）。
 *
 * 只写一句「识别人脸失败」等于没说：用户不知道是模型看不了图、渠道不通，还是格式不认。
 * 这条钉住「三样证据 + 一条出路」都在。
 */
describe('faceBoxFailureReason', () => {
  it('★★ 带上试过的模型、报错、模型原话与替代做法', () => {
    const text = faceBoxFailureReason({
      tried: ['GPT-6 Astra', 'mock-chat-1'],
      lastError: '服务端返回错误（HTTP 400）：image_url is not supported',
      lastAnswer: '我无法查看图片',
    })
    expect(text).toContain('试过 GPT-6 Astra / mock-chat-1')
    expect(text).toContain('HTTP 400')
    expect(text).toContain('我无法查看图片')
    expect(text).toContain('换一个能看图的对话模型')
    expect(text).toContain('提取选区')
  })

  it('★ 一个模型都没试时也说得清', () => {
    expect(faceBoxFailureReason({ tried: [] })).toContain('没有可用的对话模型')
  })

  it('★★ 本机识别跑过却没认到，话里要说得出来（否则用户以为没试过本机）', () => {
    expect(faceBoxFailureReason({ tried: ['mock-chat-1'], localRan: true })).toContain(
      '本机与 mock-chat-1 都没认到人脸',
    )
    expect(faceBoxFailureReason({ tried: [], localRan: true })).toContain('本机没认到人脸')
  })
})
