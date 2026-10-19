import { describe, it, expect } from 'vitest'
import type { NodeInput } from './types'
import {
  audioInputsOf,
  flattenInputs,
  imageInputsOf,
  MAX_IMAGE_INPUTS,
  videoInputsOf,
} from './inputs'

const text = (id: string): NodeInput => ({ kind: 'text', nodeId: id, text: `t:${id}` })
const asset = (id: string, mime = 'image/png'): NodeInput => ({
  kind: 'asset',
  nodeId: id,
  assetHash: `h:${id}`,
  mime,
})

describe('flattenInputs / 摊平集合', () => {
  it('无集合时原样返回（新数组，不改原引用）', () => {
    const inputs = [text('a'), asset('b')]
    expect(flattenInputs(inputs)).toEqual(inputs)
    expect(flattenInputs(inputs)).not.toBe(inputs)
  })

  it('集合被替换成其 items，顺序保持', () => {
    const inputs: NodeInput[] = [
      text('a'),
      { kind: 'collection', nodeId: 'c1', items: [asset('i1'), asset('i2')] },
      text('z'),
    ]
    expect(flattenInputs(inputs).map((i) => i.nodeId)).toEqual(['a', 'i1', 'i2', 'z'])
  })

  it('嵌套集合递归摊平（批量接批量）', () => {
    const inputs: NodeInput[] = [
      {
        kind: 'collection',
        nodeId: 'outer',
        items: [{ kind: 'collection', nodeId: 'inner', items: [asset('deep')] }, asset('flat')],
      },
    ]
    expect(flattenInputs(inputs).map((i) => i.nodeId)).toEqual(['deep', 'flat'])
  })

  it('空集合不产生任何项', () => {
    expect(flattenInputs([{ kind: 'collection', nodeId: 'c', items: [] }])).toEqual([])
  })
})

describe('imageInputsOf / 图像输入提取', () => {
  it('只留 asset，文本被剔除', () => {
    expect(imageInputsOf([text('a'), asset('b')])).toEqual([
      { assetHash: 'h:b', mime: 'image/png' },
    ])
  })

  it('非图像 mime 被剔除（视频素材不能当参考图上传）', () => {
    expect(imageInputsOf([asset('v', 'video/mp4')])).toEqual([])
  })

  it('同 hash 只保留一次（两条连线引到同一张图）', () => {
    const dup: NodeInput[] = [
      { kind: 'asset', nodeId: 'x', assetHash: 'same', mime: 'image/png' },
      { kind: 'asset', nodeId: 'y', assetHash: 'same', mime: 'image/png' },
    ]
    expect(imageInputsOf(dup)).toEqual([{ assetHash: 'same', mime: 'image/png' }])
  })

  it('先摊平集合再挑图', () => {
    const inputs: NodeInput[] = [
      { kind: 'collection', nodeId: 'c', items: [asset('i1'), text('t')] },
      asset('out'),
    ]
    expect(imageInputsOf(inputs).map((i) => i.assetHash)).toEqual(['h:i1', 'h:out'])
  })

  it(`超过 ${MAX_IMAGE_INPUTS} 张时截断，保前面的`, () => {
    const many = Array.from({ length: MAX_IMAGE_INPUTS + 3 }, (_, i) => asset(`n${i}`))
    const got = imageInputsOf(many)
    expect(got).toHaveLength(MAX_IMAGE_INPUTS)
    expect(got[0]!.assetHash).toBe('h:n0')
  })

  it('max 可显式下调', () => {
    expect(imageInputsOf([asset('a'), asset('b'), asset('c')], 2)).toHaveLength(2)
  })

  it('空输入 → 空数组', () => {
    expect(imageInputsOf([])).toEqual([])
  })
})

describe('audioInputsOf / 音频输入提取', () => {
  it('只收 audio/*，图片与视频都不混入数字人口播音轨', () => {
    expect(
      audioInputsOf([
        asset('i', 'image/png'),
        asset('v', 'video/mp4'),
        asset('a', 'audio/wav'),
      ]),
    ).toEqual([{ assetHash: 'h:a', mime: 'audio/wav' }])
  })

  it('同一段音频多次连线只上传一次', () => {
    const inputs: NodeInput[] = [
      { kind: 'asset', nodeId: 'x', assetHash: 'same', mime: 'audio/mpeg' },
      { kind: 'asset', nodeId: 'y', assetHash: 'same', mime: 'audio/mpeg' },
    ]
    expect(audioInputsOf(inputs)).toEqual([{ assetHash: 'same', mime: 'audio/mpeg' }])
  })
})

describe('videoInputsOf / 视频输入提取', () => {
  it('只收 video/*，图片与音频都不混入视频超清输入', () => {
    expect(
      videoInputsOf([
        asset('i', 'image/png'),
        asset('v', 'video/mp4'),
        asset('a', 'audio/wav'),
      ]),
    ).toEqual([{ assetHash: 'h:v', mime: 'video/mp4' }])
  })

  it('同一条视频多次连线只上传一次', () => {
    const inputs: NodeInput[] = [
      { kind: 'asset', nodeId: 'x', assetHash: 'same', mime: 'video/mp4' },
      { kind: 'asset', nodeId: 'y', assetHash: 'same', mime: 'video/webm' },
    ]
    expect(videoInputsOf(inputs)).toEqual([{ assetHash: 'same', mime: 'video/mp4' }])
  })
})
