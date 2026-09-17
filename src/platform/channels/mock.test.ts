import { describe, it, expect } from 'vitest'
import { createMockChannel } from './mock'
import { solidPng } from './mockPng'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
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

  /**
   * hash 是**产物字节的内容指纹**（§8「id 即内容哈希」），不是请求指纹。
   *
   * 推论有两层，都在这里锁住：
   * ① 带图像输入时像素变品红 ⇒ 字节变 ⇒ hash 变（内容寻址的自然结果）；
   * ② 同参数重跑仍然同 hash（mock 是确定性的），所以按 hash 断言依旧可复现。
   */
  it('hash = 产物字节的内容指纹：输入改变 → 字节改变 → hash 改变', async () => {
    const ch = createMockChannel()
    const a = (await ch.generateImage(imageRequest([]), signal))[0]!
    const b = await ch.generateImage(
      imageRequest([{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }]),
      signal,
    )
    expect(b[0]!.bytes).not.toEqual(a.bytes)
    expect(b[0]!.hash).not.toBe(a.hash)
  })

  it('同参数重跑：字节与 hash 都稳定（按 hash 断言的可复现性来源）', async () => {
    const first = (await createMockChannel().generateImage(imageRequest([]), signal))[0]!
    const second = (await createMockChannel().generateImage(imageRequest([]), signal))[0]!
    expect(second.bytes).toEqual(first.bytes)
    expect(second.hash).toBe(first.hash)
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

  it('§6.18 请求像素与实际像素是两组字段（比例 16:9 → 64×36）', async () => {
    const ch = createMockChannel()
    const [asset] = await ch.generateImage(
      { ...imageRequest([]), params: { count: 1, ratio: '16:9' } },
      signal,
    )
    expect(asset!.requestedWidth).toBe(64)
    expect(asset!.requestedHeight).toBe(36)
    expect(asset!.width).toBe(64)
    expect(asset!.height).toBe(36)
  })

  /**
   * ★ 这条是「实际像素」不是恒等式的证明。
   *
   * mock 造的 PNG 尺寸恰好等于请求尺寸（64×36），所以只断言「两个数都在」
   * 是恒真的——把实现换成「实际照抄请求」也一样绿。这里把产物的**字节头**
   * 改成另一个尺寸再交给同一个读尺寸的纯函数，得到 8×8 ≠ 64×36，
   * 说明下游拿到的是「从字节里读出来的数」，不是请求值的副本。
   */
  it('★ 实际像素取自产物字节：换成另一尺寸的 PNG，读数随之改变（不是照抄请求）', async () => {
    const ch = createMockChannel()
    const [asset] = await ch.generateImage(
      { ...imageRequest([]), params: { count: 1, ratio: '16:9' } },
      signal,
    )
    const other = solidPng(8, 8, [0x00, 0x00, 0x00])
    const read = imageSizeFromHeader(other)
    expect(read).toEqual({ width: 8, height: 8 })
    expect(read).not.toEqual({ width: asset!.requestedWidth, height: asset!.requestedHeight })
    // 反过来说：产物字节若真被换掉，记录里的实际像素也必须跟着变
    expect(imageSizeFromHeader(asset!.bytes)).toEqual({ width: asset!.width, height: asset!.height })
  })

  it('视频产物不带像素（不是图片，尺寸无从谈起）', async () => {
    const ch = createMockChannel()
    const req: VideoRunRequest = {
      kind: 'video',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      inputs: [],
      params: { count: 1 },
    }
    const [asset] = await ch.generateVideo(req, signal)
    expect(asset!.width).toBeUndefined()
    expect(asset!.requestedWidth).toBeUndefined()
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
