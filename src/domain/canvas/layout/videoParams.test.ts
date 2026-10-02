import { describe, expect, it } from 'vitest'
import { VIDEO_PARAM_SPECS, videoParamsFor } from './videoParams'

/**
 * 视频参数的**值域来自 Agnes 官方文档**（2026-10-03 实读）。
 *
 * 为什么值得单测钉住：面板上多给一档（比如比例给 3:2）不是「多一个选项」，
 * 而是**发出去就 400** —— 用户看到的是「选了就报错」。文档明确写了
 * 「`auto` 或列表外的值会报错」「`WIDTHxHEIGHT` 不支持」。
 */
describe('videoParamsFor · 视频模型各自的参数能力', () => {
  it('★★ Agnes 视频只有 6 档比例（auto / 像素写法 / 3:2 这类都不认）', () => {
    const spec = videoParamsFor('Agnes Video 2.5')
    expect(spec?.ratios).toEqual(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
    expect(spec?.ratios).not.toContain('auto')
    expect(spec?.ratios).not.toContain('3:2')
  })

  it('★★ 时长范围 4–12 秒、默认 5（我们面板原来给的是 3–15）', () => {
    expect(videoParamsFor('agnes-video-2.5')?.seconds).toEqual({ min: 4, max: 12, default: 5 })
  })

  it('★ 2.5 支持 720P/1080P/1K/2K；2.5 Flash 只支持 720P', () => {
    expect(videoParamsFor('agnes-video-2.5')?.sizes).toEqual(['720P', '1080P', '1K', '2K'])
    expect(videoParamsFor('Agnes Video 2.5 Flash')?.sizes).toEqual(['720P'])
  })

  it('★ 张数只支持 1；mode 三档都在', () => {
    expect(VIDEO_PARAM_SPECS['agnes-video-2.5']?.count).toBe(1)
    expect(videoParamsFor('agnes-video-2.5')?.modes).toEqual(['text', 'keyframe', 'reference'])
  })

  it('认不出来的模型返回 undefined（不套用别人的档位）', () => {
    expect(videoParamsFor('Agnes Video 2.0')).toBeUndefined()
    expect(videoParamsFor('')).toBeUndefined()
  })
})
