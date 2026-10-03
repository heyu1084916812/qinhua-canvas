import { describe, expect, it } from 'vitest'
import { MJ_PERSONALIZE_MAX, MJ_SLIDERS, mjFlags, mjSettingsOf, mjSliderValue } from './mjParams'

/**
 * **Midjourney 独有的风格参数**（用户 2026-10-03 图二那份「高级设置」）。
 *
 * ⚠️ 值域出处要如实看：`docs.midjourney.com` / `help.midjourney.com` / `www.midjourney.com`
 * 三个域名对 Node 直连与无痕系统 Chrome 都回 **403（Cloudflare 安全验证）**，
 * 本机也拿不到浏览器控制通道 —— 所以这里是**公开的官方参数表**（见 `mjParams.ts` 的注记），
 * 不是这一次从官网上读下来的。单测钉的是「我们实现的值域与注释一致」，不是「官方就是如此」。
 */
describe('Midjourney 风格参数 · 值域 / 默认值 / 提示词后缀', () => {
  it('★★ 三根滑杆的取值范围与默认值', () => {
    const byKey = Object.fromEntries(MJ_SLIDERS.map((s) => [s.key, s]))
    expect(byKey.stylize).toMatchObject({ min: 0, max: 1000, default: 100 })
    expect(byKey.weird).toMatchObject({ min: 0, max: 3000, default: 0 })
    expect(byKey.chaos).toMatchObject({ min: 0, max: 100, default: 0 })
  })

  it('★ 越界值夹回区间；没设过 / 非法值给官方默认值', () => {
    const stylize = MJ_SLIDERS[0]!
    expect(mjSliderValue(5000, stylize)).toBe(1000)
    expect(mjSliderValue(-3, stylize)).toBe(0)
    expect(mjSliderValue(undefined, stylize)).toBe(100)
    expect(mjSliderValue('abc', stylize)).toBe(100)
    /** 小数取整（MJ 只认整数） */
    expect(mjSliderValue(12.7, stylize)).toBe(13)
  })

  it('★★ 只把**与默认值不同**的那几项拼成后缀（默认值写进提示词只是噪音）', () => {
    /** 全是默认值 → 一个后缀都不加 */
    expect(mjFlags({ stylize: 100, weird: 0, chaos: 0, personalize: '' })).toBe('')
    /** 改过的才拼；顺序固定 stylize → weird → chaos → --p */
    expect(mjFlags({ stylize: 500, weird: 50, chaos: 5 })).toBe('--stylize 500 --weird 50 --chaos 5')
    expect(mjFlags({ stylize: 100, weird: 50 })).toBe('--weird 50')
  })

  it('★ 个性化代码填了就带 `--p`，去空白并截断', () => {
    expect(mjFlags({ personalize: '  abc123  ' })).toBe('--p abc123')
    const long = 'x'.repeat(MJ_PERSONALIZE_MAX + 20)
    expect(mjSettingsOf({ personalize: long }).personalize).toHaveLength(MJ_PERSONALIZE_MAX)
  })

  it('★ 未知 / 空输入不炸（agent 建的节点、老数据都会走到这里）', () => {
    expect(mjFlags(undefined)).toBe('')
    expect(mjFlags(null)).toBe('')
    expect(mjSettingsOf({}), '空对象 → 全部默认').toEqual({
      stylize: 100,
      weird: 0,
      chaos: 0,
      personalize: '',
    })
  })
})
