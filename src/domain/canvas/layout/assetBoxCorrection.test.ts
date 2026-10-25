import { describe, expect, it } from 'vitest'
import { assetBoxCorrection } from './assetBoxCorrection'
import { NODE_MINIMUMS } from './constants'

/**
 * 媒体元数据到手后"框要不要纠正"（对账 #266 / #276 / #288）。
 *
 * 三版演进（每一版都是被用户实测顶回来的，不要把它读成"反复改主意"）：
 *  · v1 拿**记着的 naturalSize** 比例比 ⇒ 漏掉"记录对、框错"；
 *  · v2 改成拿**框的比例**比，但只纠"机器形状"的框（怕碰用户手拉的框）⇒ 仍漏一档；
 *  · v3（本版）**一律纠正**：因为 §6.16 的 `resizeLockOf` 已经保证"有内容的图片 / 视频节点
 *    只能等比缩放"，错误比例的框**不可能来自用户**，所以纠正没有对手。
 *
 * 用户的原话点得最准：「长图漏白是在画布节点内部漏白，灯箱是正常展示整张图」
 * —— 灯箱按真实比例，节点就该一样。
 */
const DEFAULT_BOX = NODE_MINIMUMS.generation

describe('assetBoxCorrection', () => {
  it('★★ 尺寸未知 + 还是默认框 ⇒ 记下真实像素并换成原比例（16:9 → 341×192）', () => {
    const fix = assetBoxCorrection({ ...DEFAULT_BOX }, { width: 1920, height: 1080 })
    expect(fix?.naturalSize).toEqual({ width: 1920, height: 1080 })
    expect(fix?.size).toEqual({ w: 341, h: 192 })
    // 比例真的对上了（这是"没有上下空隙"的充要条件）
    expect(fix!.size!.w / fix!.size!.h).toBeCloseTo(1920 / 1080, 2)
  })

  it('★ 竖图同样纠正（9:16 → 240×427），不是只会处理宽图', () => {
    const fix = assetBoxCorrection({ ...DEFAULT_BOX }, { width: 1080, height: 1920 })
    expect(fix?.size).toEqual({ w: 240, h: 427 })
  })

  it('★★ 用户实测那张长图（944×1665）：框 260×470 ⇒ 纠正成 240×423', () => {
    /**
     * 这组数字来自**复现**（scripts 里的探针，2026-10-06）：同一个图片下
     * 框 240×460 会被纠正（白边 0.6px），框 260×470 在 v2 里**不被纠正**（白边 6.5px/条）。
     * 用户画布上那个节点就是后者 —— 这条测试等于把那次复现钉下来。
     */
    const fix = assetBoxCorrection({ w: 260, h: 470 }, { width: 944, height: 1665 })
    expect(fix?.size).toEqual({ w: 240, h: 423 })
    expect(fix!.size!.w / fix!.size!.h).toBeCloseTo(944 / 1665, 3)
  })

  it('★★ 比例已经对了就什么都不做（返回 null）——别制造无意义的撤销步', () => {
    expect(assetBoxCorrection({ w: 341, h: 192 }, { width: 1920, height: 1080 })).toBeNull()
  })

  it('★ 比例差得极小时也不动（0.5% 折合一两个像素，肉眼看不见）', () => {
    expect(assetBoxCorrection({ w: 240, h: 427 }, { width: 944, height: 1665 })).toBeNull()
  })

  it('★ 图文不一致（框被改成方框 / 任意形状）⇒ 以真实素材为准', () => {
    const fix = assetBoxCorrection({ w: 500, h: 300 }, { width: 1920, height: 1080 })
    expect(fix?.naturalSize).toEqual({ width: 1920, height: 1080 })
    expect(fix?.size).toEqual({ w: 341, h: 192 })
  })

  it('元数据不可用（0 / 缺失）⇒ 不猜，返回 null', () => {
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, { width: 0, height: 1080 })).toBeNull()
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, { width: 1920, height: 0 })).toBeNull()
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, null)).toBeNull()
    expect(assetBoxCorrection({ ...DEFAULT_BOX }, undefined)).toBeNull()
  })
})
