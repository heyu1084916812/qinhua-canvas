import { describe, it, expect } from 'vitest'
import { createMockChannel } from './mock'
import type { ImageRunRequest, TextRunRequest, VideoRunRequest } from './types'

const signal = new AbortController().signal

const imageRequest = (inputs: ImageRunRequest['inputs']): ImageRunRequest => ({
  kind: 'image',
  channelId: 'c',
  model: 'mock-image-1',
  prompt: 'p',
  inputs,
  params: { count: 1 },
})

/** PNG 的 IHDR 之后的第一个字节组无法直读，这里用「字节是否相同」判断产物是否同源 */
async function runAndGetBytes(inputs: ImageRunRequest['inputs']): Promise<Uint8Array> {
  const ch = createMockChannel()
  const [asset] = await ch.generateImage(imageRequest(inputs), signal)
  return asset!.bytes
}

describe('mock 渠道 / 图像输入可观测（M6-12）', () => {
  it('无图像输入 → 灰度图', async () => {
    const plain = await runAndGetBytes([])
    const withText = await runAndGetBytes([{ kind: 'text', nodeId: 't', text: 'x' }])
    expect(plain).toEqual(withText)
  })

  it('带图像输入 → 产物字节与无输入时不同（inputs 真被消费）', async () => {
    const plain = await runAndGetBytes([])
    const withImage = await runAndGetBytes([
      { kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' },
    ])
    expect(withImage).not.toEqual(plain)
    // 两种产物都是真实 PNG（魔数一致），差别只在像素——这才让「断言颜色」有意义
    expect(Array.from(withImage.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('视频素材输入不改变出图（只有图像才算参考图）', async () => {
    const plain = await runAndGetBytes([])
    const withVideo = await runAndGetBytes([
      { kind: 'asset', nodeId: 'v', assetHash: 'hv', mime: 'video/mp4' },
    ])
    expect(withVideo).toEqual(plain)
  })

  it('hash 规则不随输入变化（既有按 hash 断言的测试不受影响）', async () => {
    const ch = createMockChannel()
    const a = (await ch.generateImage(imageRequest([]), signal))[0]!
    const b = await ch.generateImage(
      imageRequest([{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }]),
      signal,
    )
    expect(b[0]!.hash).toBe(a.hash)
  })

  it('视频请求仍走假字节分支，不因 inputs 变成 PNG', async () => {
    const ch = createMockChannel()
    const req: VideoRunRequest = {
      kind: 'video',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      inputs: [{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }],
      params: { count: 1 },
    }
    const [asset] = await ch.generateVideo(req, signal)
    expect(asset!.mime).toBe('video/mp4')
  })
})

/**
 * 文本侧同样要有「素材到底送没送到」的可观测证据。
 *
 * 若 mock 无视 `inputs` 一律回 `mock:<prompt>`，那么「上游图片送进 LLM」这条链路
 * 在离线环境里**永远证明不了**——只能等接了真实渠道才发现没生效。
 * 与出图侧的「品红图 vs 灰度图」是同一个道理。
 */
describe('mock 渠道 / 文本调用带上素材（§6.7 反推）', () => {
  const textRequest = (inputs: TextRunRequest['inputs']): TextRunRequest => ({
    kind: 'text',
    channelId: 'c',
    model: 'm',
    prompt: '描述这张图',
    inputs,
    params: {},
  })

  it('带素材 → 输出里带素材 hash 前缀（可断言图真的到了渠道层）', async () => {
    const ch = createMockChannel()
    const r = await ch.completeText(
      textRequest([{ kind: 'asset', nodeId: 'up', assetHash: 'abcdef1234567890', mime: 'image/png' }]),
      signal,
    )
    expect(r.text).toBe('mock:img:abcdef12|描述这张图')
  })

  it('不带素材 → 不带前缀，输出规则与改动前一致', async () => {
    const ch = createMockChannel()
    const r = await ch.completeText(textRequest([]), signal)
    expect(r.text).toBe('mock:描述这张图')
  })
})
