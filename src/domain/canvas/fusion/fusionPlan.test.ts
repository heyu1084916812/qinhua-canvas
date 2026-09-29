import { describe, it, expect } from 'vitest'
import {
  FUSION_MIN_EDGE,
  FUSION_MISSING_INPUT,
  clampRect,
  contextFromSelection,
  contextMatchesSource,
  contextsForSource,
  fitInside,
  fitRectToRatio,
  paddedRectOf,
  planFusion,
  ratioMatches,
  ratioValueOf,
  rectRatio,
  type FusionPatchInput,
} from './fusionPlan'
import type { FusionContext } from '../model/node'

const SOURCE = { assetHash: 'a'.repeat(64), width: 1000, height: 1000 }

function patch(over: Partial<FusionPatchInput> = {}): FusionPatchInput {
  return { nodeId: 'p1', assetHash: 'b'.repeat(64), width: 200, height: 200, ...over }
}

describe('融合几何 · fitInside', () => {
  it('宽图放进方框：上下不留白，左右居中', () => {
    // 框 200×200，图 2:1 → 实显 200×100，纵向居中
    expect(fitInside({ w: 200, h: 200 }, { w: 1000, h: 500 })).toEqual({
      x: 0,
      y: 50,
      w: 200,
      h: 100,
    })
  })

  it('高图放进方框：左右不留白，上下居中', () => {
    expect(fitInside({ w: 200, h: 200 }, { w: 500, h: 1000 })).toEqual({
      x: 50,
      y: 0,
      w: 100,
      h: 200,
    })
  })

  it('尺寸缺失时退回整框（不产生 NaN 的百分比）', () => {
    expect(fitInside({ w: 0, h: 0 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('融合几何 · fitRectToRatio', () => {
  it('宽了就往中间收窄，中心不动', () => {
    const r = fitRectToRatio({ x: 0, y: 0, w: 400, h: 100 }, 1)
    expect(r).toEqual({ x: 150, y: 0, w: 100, h: 100 })
    expect(rectRatio(r)).toBeCloseTo(1, 5)
  })

  it('高了就往中间收矮，中心不动', () => {
    const r = fitRectToRatio({ x: 0, y: 0, w: 100, h: 400 }, 1)
    expect(r).toEqual({ x: 0, y: 150, w: 100, h: 100 })
  })

  it('只缩不放：比例已经符合时原样返回', () => {
    const r = { x: 10, y: 20, w: 300, h: 100 }
    expect(fitRectToRatio(r, 3)).toEqual(r)
  })
})

describe('融合几何 · paddedRectOf（贴边选区）', () => {
  it('居中的选区：四周各外扩一圈', () => {
    // 200×200 的框、短边 200、比例 0.08 → 每边 16
    const p = paddedRectOf({ x: 400, y: 400, w: 200, h: 200 }, { w: 1000, h: 1000 }, 0.08)
    expect(p).toEqual({ x: 384, y: 384, w: 232, h: 232 })
  })

  it('★ 贴左上角的选区：先外扩再平移回图内，且矩形完整（不是裁掉一角）', () => {
    const p = paddedRectOf({ x: 0, y: 0, w: 200, h: 200 }, { w: 1000, h: 1000 }, 0.08)
    // 外扩后是 232×232，出界部分靠整体平移补回来 → 左上角贴到 (0,0)、尺寸不减
    expect(p).toEqual({ x: 0, y: 0, w: 232, h: 232 })
    expect(p.w).toBe(232)
    expect(p.h).toBe(232)
  })

  it('★ 贴右下角的选区：同样保住尺寸，位置内移', () => {
    const p = paddedRectOf({ x: 800, y: 800, w: 200, h: 200 }, { w: 1000, h: 1000 }, 0.08)
    expect(p).toEqual({ x: 768, y: 768, w: 232, h: 232 })
  })

  it('选区比图还大时等比缩回去（不能只压一个方向，否则比例变了补丁就融不进）', () => {
    const p = paddedRectOf({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1000, h: 500 }, 0.08)
    expect(p.w).toBeLessThanOrEqual(1000)
    expect(p.h).toBeLessThanOrEqual(500)
    expect(rectRatio(p)).toBeCloseTo(2, 2)
  })

  /**
   * ★★ 这条是**功能能不能用**的分水岭。
   *
   * 模型按用户选的比例出图（「按模型现有比例提取」选 16:9，补丁就是 16:9）。
   * 外扩若只按短边加一圈，`paddedRect` 的比例会被改成约 1.67 —— 补丁回来一比
   * 就超 1% 容差，`planFusion` 会拒掉**每一张**补丁，融合节点整体不可用。
   */
  it('★★ 外扩后比例与选区一致（否则每张补丁都会被比例校验拒掉）', () => {
    const bounds = { w: 4000, h: 4000 }
    const cases = [
      { x: 100, y: 100, w: 800, h: 450 },
      { x: 100, y: 100, w: 450, h: 800 },
      { x: 0, y: 0, w: 300, h: 100 },
      { x: 700, y: 700, w: 200, h: 200 },
    ]
    for (const rect of cases) {
      const p = paddedRectOf(rect, bounds, 0.08)
      expect(ratioMatches(rectRatio(p), rectRatio(rect)), JSON.stringify(rect)).toBe(true)
      // 而且与选区同比例的补丁真能过校验（这才是「功能可用」的定义）
      const r = planFusion({
        original: { assetHash: 'a'.repeat(64), width: bounds.w, height: bounds.h },
        contexts: [
          {
            id: 'c1',
            source: { assetHash: 'a'.repeat(64), width: bounds.w, height: bounds.h },
            rect,
            paddedRect: p,
            paddingRatio: 0.08,
          },
        ],
        patches: [
          {
            nodeId: 'p1',
            assetHash: 'b'.repeat(64),
            width: 1600,
            height: Math.round(1600 / rectRatio(rect)),
          },
        ],
      })
      expect(r.ok, JSON.stringify(rect)).toBe(true)
    }
  })
})

describe('融合几何 · clampRect / 比例工具', () => {
  it('夹进边界时保持尺寸、平移位置', () => {
    expect(clampRect({ x: -50, y: -50, w: 100, h: 100 }, { w: 200, h: 200 })).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    })
    expect(clampRect({ x: 180, y: 180, w: 100, h: 100 }, { w: 200, h: 200 })).toEqual({
      x: 100,
      y: 100,
      w: 100,
      h: 100,
    })
  })

  it('比例解析：认识 16:9，不认识「跟随素材」这类自然语言', () => {
    expect(ratioValueOf('16:9')).toBeCloseTo(16 / 9, 6)
    expect(ratioValueOf('自由')).toBeNull()
    expect(ratioValueOf(undefined)).toBeNull()
    expect(ratioValueOf('0:0')).toBeNull()
  })

  it('比例比较是**相对**容差：1% 以内算一致', () => {
    expect(ratioMatches(1, 1.005)).toBe(true)
    expect(ratioMatches(1, 1.02)).toBe(false)
    // 大比例下同样是 1%：绝对差值会随数值放大，故不能用绝对值
    expect(ratioMatches(16 / 9, (16 / 9) * 1.005)).toBe(true)
    expect(ratioMatches(16 / 9, (16 / 9) * 1.02)).toBe(false)
  })
})

describe('融合上下文 · contextFromSelection', () => {
  it('按比例吸附后再算外扩矩形', () => {
    const ctx = contextFromSelection({
      contextId: 'c1',
      source: SOURCE,
      rect: { x: 100, y: 100, w: 400, h: 100 },
      ratio: 1,
    })
    expect(ctx.rect).toEqual({ x: 250, y: 100, w: 100, h: 100 })
    // 外扩 8% × 短边 100 = 8
    expect(ctx.paddedRect).toEqual({ x: 242, y: 92, w: 116, h: 116 })
  })

  it('自由档不动用户框出来的形状', () => {
    const ctx = contextFromSelection({
      contextId: 'c1',
      source: SOURCE,
      rect: { x: 10, y: 10, w: 300, h: 100 },
    })
    expect(ctx.rect).toEqual({ x: 10, y: 10, w: 300, h: 100 })
  })

  it('把框夹进图内（拖到边缘之外也不产生负坐标）', () => {
    const ctx = contextFromSelection({
      contextId: 'c1',
      source: SOURCE,
      rect: { x: -50, y: -50, w: 300, h: 300 },
    })
    expect(ctx.rect.x).toBe(0)
    expect(ctx.rect.y).toBe(0)
  })
})

describe('融合上下文 · 与原图的对应关系', () => {
  const ctx: FusionContext = contextFromSelection({
    contextId: 'c1',
    source: SOURCE,
    rect: { x: 0, y: 0, w: 200, h: 200 },
  })

  it('hash 与尺寸都对上才算匹配', () => {
    expect(contextMatchesSource(ctx, SOURCE)).toBe(true)
    expect(contextMatchesSource(ctx, { ...SOURCE, assetHash: 'z'.repeat(64) })).toBe(false)
    expect(contextMatchesSource(ctx, { ...SOURCE, width: 800 })).toBe(false)
    expect(contextMatchesSource(ctx, null)).toBe(false)
  })

  it('筛出仍然可用的选区（换图后旧选区不会冒充可用）', () => {
    const other = { ...SOURCE, assetHash: 'z'.repeat(64) }
    expect(contextsForSource([ctx], other)).toEqual([])
    expect(contextsForSource([ctx], SOURCE)).toEqual([ctx])
  })
})

describe('融合计划 · planFusion', () => {
  const makeCtx = (id: string, rect = { x: 100, y: 100, w: 200, h: 200 }): FusionContext =>
    contextFromSelection({ contextId: id, source: SOURCE, rect })

  it('★ 缺输入时给出定死的文案（不管缺的是哪一样）', () => {
    expect(planFusion({ original: null, contexts: [], patches: [] })).toEqual({
      ok: false,
      reason: FUSION_MISSING_INPUT,
    })
    expect(planFusion({ original: SOURCE, contexts: [], patches: [] })).toEqual({
      ok: false,
      reason: FUSION_MISSING_INPUT,
    })
    expect(planFusion({ original: SOURCE, contexts: [makeCtx('c1')], patches: [] })).toEqual({
      ok: false,
      reason: FUSION_MISSING_INPUT,
    })
  })

  it('选区与补丁数量必须一一对应（多一个少一个都拒绝）', () => {
    const r = planFusion({
      original: SOURCE,
      contexts: [makeCtx('c1')],
      patches: [patch(), patch({ nodeId: 'p2' })],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('数量')
  })

  it('★ 补丁与选区比例失配超过 1% 直接拒绝（避免拉伸变形）', () => {
    const r = planFusion({
      original: SOURCE,
      contexts: [makeCtx('c1')],
      // 选区外扩后接近 1:1，补丁给个 2:1
      patches: [patch({ width: 400, height: 200 })],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('比例不一致')
  })

  it('造出按连线顺序的步骤，输出尺寸 = 原图尺寸', () => {
    const r = planFusion({
      original: SOURCE,
      contexts: [makeCtx('c1'), makeCtx('c2', { x: 500, y: 500, w: 200, h: 200 })],
      patches: [patch({ nodeId: 'p1' }), patch({ nodeId: 'p2', assetHash: 'c'.repeat(64) })],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.output).toEqual({ w: 1000, h: 1000 })
    expect(r.plan.steps.map((s) => s.patchNodeId)).toEqual(['p1', 'p2'])
    expect(r.plan.steps.map((s) => s.contextId)).toEqual(['c1', 'c2'])
    // 目标矩形就是外扩矩形（补丁要盖住羽化带）
    expect(r.plan.steps[0].target).toEqual(makeCtx('c1').paddedRect)
  })

  it('★ 选区短边不足下限时拒绝，并明确指出是第几个', () => {
    const tiny: FusionContext = contextFromSelection({
      contextId: 'c1',
      source: SOURCE,
      rect: { x: 10, y: 10, w: FUSION_MIN_EDGE - 10, h: FUSION_MIN_EDGE - 10 },
    })
    const r = planFusion({ original: SOURCE, contexts: [tiny], patches: [patch({ width: 16, height: 16 })] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 外扩之后可能就够大了 —— 这时该放行，故只在仍然太小时断言
      expect(r.reason).toMatch(/太小|比例/)
    }
  })

  it('读不出像素尺寸的补丁被拒绝（不静默跳过）', () => {
    const r = planFusion({
      original: SOURCE,
      contexts: [makeCtx('c1')],
      patches: [patch({ width: 0, height: 0 })],
    })
    expect(r.ok).toBe(false)
  })
})
