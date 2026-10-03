import { describe, expect, it } from 'vitest'
import { isAutoRatio, VIDEO_PARAM_SPECS, videoParamsFor } from './videoParams'

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
    expect(VIDEO_PARAM_SPECS['agnes-video-2.5']?.counts).toEqual([1])
    expect(videoParamsFor('agnes-video-2.5')?.modes).toEqual([
      'text',
      'all-purpose',
      'first-last-frame',
    ])
  })

  it('认不出来的模型返回 undefined（不套用别人的档位）', () => {
    expect(videoParamsFor('某站的私有视频模型')).toBeUndefined()
    expect(videoParamsFor('')).toBeUndefined()
  })

  /**
   * ★★ 用户手上的就是 **Agnes Video 2.0**（不是 Flash）。它跟 2.5 不是同一套形态：
   * 只认「像素 + 帧数」，官方那套 `mode` 会被 400 拒 —— 所以它的参数能力单独一条，
   * 三档 mode 都在（2026-10-03 实测：2.0 的参考素材走 `image` 数组且吃 Data URI）。
   */
  it('★★ Agnes Video 2.0 单独一条：6 档比例 / 720p·1080p / 4–12 秒 / 三档 mode', () => {
    const spec = videoParamsFor('Agnes Video 2.0')
    expect(spec?.ratios).toEqual(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
    expect(spec?.sizes).toEqual(['720p', '1080p'])
    expect(spec?.seconds).toEqual({ min: 4, max: 12, default: 5 })
    expect(spec?.modes).toEqual(['text', 'all-purpose', 'first-last-frame'])
    expect(spec?.counts).toEqual([1])
  })

  /**
   * **参数方言**（2026-10-03 真令牌实测，对账清单 #112）：
   *
   * 同一个 host 上，2.0 收下 `size:"720P" + aspect_ratio` 却不生效（回填默认 1088×832），
   * 只有像素形态（`width/height/num_frames`）才按我们给的来 ⇒ 2.0 = `pixel`，
   * 2.5 / Flash = 官方文档那套档位 = `tier`。
   */
  it('★★ 参数方言按模型分家：2.0 走像素、2.5/Flash 走官方档位', () => {
    expect(videoParamsFor('agnes-video-v2.0')?.dialect).toBe('agnes-pixel')
    expect(videoParamsFor('Agnes Video 2.0')?.dialect).toBe('agnes-pixel')
    expect(videoParamsFor('agnes-video-2.5')?.dialect).toBe('agnes-tier')
    expect(videoParamsFor('agnes-video-2.5-flash')?.dialect).toBe('agnes-tier')
  })

  /**
   * 用户 2026-10-03 那 11 张截图里的四家（图三～图十一）。
   *
   * 这些档位不是我们推断的：它们就是该站点创作面板上**真实可选**的档位，
   * 所以「面板多摆一格 / 少摆一格」都是可测的事实。
   */
  it('★★ 即梦 2.5（Seedance 2.5）：8 个模式 / 4–30 秒 / 三个清晰度 / 有音频与数量', () => {
    const spec = videoParamsFor('即梦 2.5')
    expect(spec?.modes).toHaveLength(8)
    expect(spec?.disabledModes).toEqual(['video-edit'])
    expect(spec?.seconds).toEqual({ min: 4, max: 30, default: 5 })
    expect(spec?.sizes).toEqual(['480P', '720P', '1080P'])
    expect(spec?.supportsAudio).toBe(true)
    expect(spec?.counts).toEqual([1, 2, 4])
    /** 上游 ID 也要命中同一份规格，否则面板与适配器会各发一套 */
    expect(videoParamsFor('doubao-seedance-2.5')?.modes).toHaveLength(8)
  })

  it('★ Seedance 2.0：五个模式 / 4–15 秒 / 含 4K', () => {
    const spec = videoParamsFor('doubao-seedance-2.0')
    expect(spec?.modes).toEqual([
      'text',
      'all-purpose',
      'image-to-video',
      'first-last-frame',
      'image-reference',
    ])
    expect(spec?.seconds).toEqual({ min: 4, max: 15, default: 5 })
    expect(spec?.sizes).toEqual(['480P', '720P', '1080P', '4K'])
  })

  it('★★ MiniMax H3 / H3 Max：模式 4 / 3 档，时长都是 5–15，都没有音频开关', () => {
    const h3 = videoParamsFor('MiniMax H3')
    expect(h3?.modes).toEqual(['text', 'all-purpose', 'image-to-video', 'first-last-frame'])
    expect(h3?.sizes).toEqual(['768P', '2K'])
    expect(h3?.seconds).toEqual({ min: 5, max: 15, default: 5 })
    expect(h3?.supportsAudio).toBe(false)

    const max = videoParamsFor('Minimax H3 Max')
    expect(max?.modes).toEqual(['text', 'image-to-video', 'first-last-frame'])
    expect(max?.sizes).toEqual(['480P', '768P'])
    expect(max?.seconds).toEqual({ min: 5, max: 15, default: 5 })
    expect(max?.supportsAudio).toBe(false)
    /** H3 Max 的画幅**只有「自适应」**（图九那排就一格），不能套 H3 的 7 档 */
    expect(max?.ratios).toEqual(['auto'])
  })

  it('★★ 「自适应」不是宽高比：`auto` 与中文写法都认得出来', () => {
    expect(isAutoRatio('auto')).toBe(true)
    expect(isAutoRatio('自适应')).toBe(true)
    expect(isAutoRatio('16:9')).toBe(false)
    expect(isAutoRatio(undefined)).toBe(false)
    /** Agnes 2.5 那份**故意不含 auto**（官方文档：传 auto 会 400） */
    expect(videoParamsFor('Agnes Video 2.5')?.ratios).not.toContain('auto')
    /** 即梦 / MiniMax 那份**必须有 auto**（参考实现的第一格就是自适应） */
    expect(videoParamsFor('即梦 2.5')?.ratios).toContain('auto')
    expect(videoParamsFor('MiniMax H3')?.ratios).toContain('auto')
  })
})
