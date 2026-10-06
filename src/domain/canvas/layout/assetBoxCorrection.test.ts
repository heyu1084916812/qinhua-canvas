import { describe, expect, it } from 'vitest'
import { assetBoxCorrection } from './assetBoxCorrection'
import { NODE_MINIMUMS } from './constants'

/**
 * 媒体元数据到手后的"框要不要纠正"（对账 #266）。
 *
 * 用户的症状是「导入的图片上下会有空隙」「视频不按原视频比例」——
 * 根因是**尺寸未知时退化成 240×240 方框**，宽图（16:9）落在方框里就上下留白边。
 */
const DEFAULT_BOX = NODE_MINIMUMS.generation

describe('assetBoxCorrection', () => {
  it('★★ 尺寸未知 + 还是默认方框 ⇒ 记下真实像素并换成原比例（16:9 → 427×240）', () => {
    const fix = assetBoxCorrection({ ...DEFAULT_BOX }, { assetHash: 'h' } as never, {
      width: 1920,
      height: 1080,
    })
    expect(fix?.naturalSize).toEqual({ width: 1920, height: 1080 })
    expect(fix?.size).toEqual({ w: 427, h: 240 })
    // 比例真的对上了（这是"没有上下空隙"的充要条件）
    expect(fix!.size!.w / fix!.size!.h).toBeCloseTo(1920 / 1080, 2)
  })

  it('★ 竖图同样纠正（9:16 → 240×427），不是只会处理宽图', () => {
    const fix = assetBoxCorrection({ ...DEFAULT_BOX }, null, { width: 1080, height: 1920 })
    expect(fix?.size).toEqual({ w: 240, h: 427 })
  })

  it('★ 框被手动调过（≠ 默认框）⇒ 只记像素，绝不改用户的框', () => {
    const fix = assetBoxCorrection({ w: 500, h: 300 }, null, { width: 1920, height: 1080 })
    expect(fix).toEqual({ naturalSize: { width: 1920, height: 1080 } })
    expect(fix?.size).toBeUndefined()
  })

  it('★★ 比例已经对了就什么都不做（返回 null）——别制造无意义的撤销步', () => {
    const same = assetBoxCorrection({ w: 427, h: 240 }, { naturalSize: { width: 3840, height: 2160 } }, {
      width: 1920,
      height: 1080,
    })
    expect(same).toBeNull()
  })

  it('★ 图文不一致（记着的比例跟真实素材对不上）⇒ 以真实素材为准', () => {
    const fix = assetBoxCorrection(
      { ...DEFAULT_BOX },
      { naturalSize: { width: 1024, height: 1024 } },
      { width: 1920, height: 1080 },
    )
    expect(fix?.naturalSize).toEqual({ width: 1920, height: 1080 })
    expect(fix?.size).toEqual({ w: 427, h: 240 })
  })

  /**
   * 下面两条是**第二版补上的真空档**（用户 2026-10-06 那张"上下有空隙"的截图逼出来的）：
   * 第一版只看"记着的 naturalSize 跟真实比例如不一致"，于是**记录正确、框却错**的情况
   * 一条都不纠 —— 而画布上留不留白边只取决于**框的比例**，跟记录写没写对无关。
   */
  it('★★ 框按**请求比例**给的（9:16 → 240×427），真实产物是 16:9 ⇒ 照样纠正', () => {
    const fix = assetBoxCorrection(
      { w: 240, h: 427 },
      { ratio: '9:16' },
      { width: 1920, height: 1080 },
    )
    expect(fix?.size).toEqual({ w: 427, h: 240 })
  })

  it('★★ 记录是对的、框是错的（240×460）⇒ 也要纠正成产物比例', () => {
    const fix = assetBoxCorrection(
      { w: 240, h: 460 },
      { naturalSize: { width: 944, height: 1664 } },
      { width: 944, height: 1664 },
    )
    expect(fix?.size).toEqual({ w: 240, h: 423 })
    expect(fix!.size!.w / fix!.size!.h).toBeCloseTo(944 / 1664, 3)
  })

  it('★ 宽度被拉过（≠ 默认宽度）就是用户的框：只记像素，绝不改', () => {
    const fix = assetBoxCorrection({ w: 620, h: 400 }, null, { width: 1920, height: 1080 })
    expect(fix).toEqual({ naturalSize: { width: 1920, height: 1080 } })
    expect(fix?.size).toBeUndefined()
  })

  it('元数据不可用（0 / 缺失）⇒ 不猜，返回 null', () => {
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, null, { width: 0, height: 1080 })).toBeNull()
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, null, { width: 1920, height: 0 })).toBeNull()
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, null, null)).toBeNull()
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, null, undefined)).toBeNull()
  })
})
