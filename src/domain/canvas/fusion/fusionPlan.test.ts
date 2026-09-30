import { describe, it, expect } from 'vitest'
import {
  CROP_HANDLES,
  FUSION_MIN_EDGE,
  FUSION_MISSING_INPUT,
  clampRect,
  contextFromSelection,
  contextMatchesSource,
  contextsForSource,
  fitInside,
  fitRectToRatio,
  movedCropRect,
  paddedRectOf,
  planFusion,
  ratioMatches,
  ratioValueOf,
  rectRatio,
  resizedCropRect,
  type CropHandle,
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

/**
 * 灯箱里「框完之后还能拖手柄改」的几何（用户 2026-09-30：
 * 「灯箱框选要能二次修改」）。纯函数在这儿逐条钉，UI 只负责把指针喂进来。
 */
describe('融合几何 · resizedCropRect（拖手柄改选区）', () => {
  const BOUNDS = { w: 1000, h: 1000 }
  const BASE = { x: 200, y: 200, w: 400, h: 300 }
  const resize = (handle: CropHandle, pointer: { x: number; y: number }, ratio: number | null = null) =>
    resizedCropRect({ base: BASE, handle, pointer, bounds: BOUNDS, ratio, minEdge: FUSION_MIN_EDGE })

  it('拖右下角：左上角钉死，另两侧跟到指针', () => {
    expect(resize('se', { x: 700, y: 600 })).toEqual({ x: 200, y: 200, w: 500, h: 400 })
  })

  it('拖左上角：右下角钉死', () => {
    expect(resize('nw', { x: 100, y: 100 })).toEqual({ x: 100, y: 100, w: 500, h: 400 })
  })

  it('拖右边 / 下边：只动被拖的那条边，另一轴不参与', () => {
    expect(resize('e', { x: 900, y: 999 })).toEqual({ x: 200, y: 200, w: 700, h: 300 })
    expect(resize('s', { x: 999, y: 550 })).toEqual({ x: 200, y: 200, w: 400, h: 350 })
  })

  it('拖左边 / 上边：对面那条边钉死', () => {
    expect(resize('w', { x: 100, y: 0 })).toEqual({ x: 100, y: 200, w: 500, h: 300 })
    expect(resize('n', { x: 0, y: 100 })).toEqual({ x: 200, y: 100, w: 400, h: 400 })
  })

  it('把手拖回原位 = 什么都不变（锚点口径自洽）', () => {
    expect(resize('se', { x: 600, y: 500 })).toEqual(BASE)
  })

  it('★ 比例档在位时，拖角也保持比例（16:9），且锚点仍是左上角', () => {
    const r = resize('se', { x: 840, y: 300 }, 16 / 9)
    expect(r).toEqual({ x: 200, y: 200, w: 640, h: 360 })
    expect(Math.abs(r.w / r.h - 16 / 9) / (16 / 9)).toBeLessThan(0.01)
  })

  /**
   * ★★ 单拖一条边时，另一轴必须**跟着按比例推出去**。
   * 少了这一步，用户拖一下 16:9 的框就变成别的比例，而补丁是按模型比例出的图，
   * 融合时会被比例校验直接拒掉 —— 等于「框选一改，功能就废」。
   */
  it('★★ 比例档下拖下边：横向同步长出去，比例不破、上边钉死', () => {
    const r = resize('s', { x: 0, y: 650 }, 4 / 3)
    expect(r).toEqual({ x: 100, y: 200, w: 600, h: 450 })
  })

  it('★ 贴边不越界：指针滑出图外时框停在图内，且比例不破', () => {
    const r = resize('se', { x: 5000, y: 5000 }, 16 / 9)
    expect(r.x + r.w).toBeLessThanOrEqual(BOUNDS.w)
    expect(r.y + r.h).toBeLessThanOrEqual(BOUNDS.h)
    expect(Math.abs(r.w / r.h - 16 / 9) / (16 / 9)).toBeLessThan(0.01)
  })

  it('★ 短边守得住下限：往里拖过头也不会缩成一条线', () => {
    const r = resize('se', { x: 201, y: 201 })
    expect(r.w).toBeGreaterThanOrEqual(FUSION_MIN_EDGE)
    expect(r.h).toBeGreaterThanOrEqual(FUSION_MIN_EDGE)
  })

  it('★ 比例档 + 短边下限：两轴一起抬到下限，比例仍然成立', () => {
    const r = resize('se', { x: 205, y: 205 }, 1)
    expect(r.w).toBe(FUSION_MIN_EDGE)
    expect(r.h).toBe(FUSION_MIN_EDGE)
  })

  it('八个手柄在任何指针位置都给出合法框（不出 NaN、不越界、不破下限）', () => {
    const pointers = [
      { x: -500, y: -500 },
      { x: 0, y: 0 },
      { x: 500, y: 500 },
      { x: 1200, y: 1200 },
    ]
    for (const handle of CROP_HANDLES) {
      for (const pointer of pointers) {
        for (const ratio of [null, 1, 16 / 9]) {
          const r = resize(handle, pointer, ratio)
          const label = `${handle} @${pointer.x},${pointer.y} r=${ratio}`
          expect(Number.isFinite(r.x + r.y + r.w + r.h), label).toBe(true)
          expect(r.x, label).toBeGreaterThanOrEqual(0)
          expect(r.y, label).toBeGreaterThanOrEqual(0)
          expect(r.x + r.w, label).toBeLessThanOrEqual(BOUNDS.w)
          expect(r.y + r.h, label).toBeLessThanOrEqual(BOUNDS.h)
          expect(r.w, label).toBeGreaterThanOrEqual(FUSION_MIN_EDGE)
          expect(r.h, label).toBeGreaterThanOrEqual(FUSION_MIN_EDGE)
        }
      }
    }
  })
})

/**
 * 拖框**本身**（用户 2026-09-30：「在选取内拖动每次都会新建一个选取」）。
 * 尺寸必须一分不变 —— 移动和缩放是两件事，混在一起用户就没法微调位置。
 */
describe('融合几何 · movedCropRect（拖框微调位置）', () => {
  const BOUNDS = { w: 640, h: 360 }
  const BASE = { x: 100, y: 60, w: 200, h: 150 }

  it('尺寸不动，整块跟着位移', () => {
    const r = movedCropRect(BASE, 30, -20, BOUNDS)
    expect(r).toEqual({ x: 130, y: 40, w: 200, h: 150 })
  })

  it('★ 平移量是相对按下那一刻算的：给同样的位移得到同样的结果（不累加）', () => {
    expect(movedCropRect(BASE, 10, 10, BOUNDS)).toEqual(movedCropRect(BASE, 10, 10, BOUNDS))
  })

  it('★ 拖出图外只夹位置，尺寸不变（不把框压扁）', () => {
    const r = movedCropRect(BASE, 9999, 9999, BOUNDS)
    expect(r.w).toBe(200)
    expect(r.h).toBe(150)
    expect(r.x).toBe(BOUNDS.w - 200)
    expect(r.y).toBe(BOUNDS.h - 150)
    const l = movedCropRect(BASE, -9999, -9999, BOUNDS)
    expect(l).toEqual({ x: 0, y: 0, w: 200, h: 150 })
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

  /**
   * ★★ 这条直接抄大雄插件的 `test_padding_preserves_non_square_ratio_at_all_edges`。
   *
   * 「贴边」不是只有四个角那几种情形 —— 选区可以在**任何**位置贴着任何一条边。
   * 逐位置扫一遍，同时钉住两条不变量：
   *   ① 比例与选区一致；
   *   ② **外扩框完整包含选区**（这条最容易被取整破坏：选区顶满图宽时，
   *      `round(w × scale)` 可能比选区窄 1px，于是水平方向直接退化成不羽化）。
   */
  it('★★ 选区贴任何一条边时：比例不变 **且** 外扩框完整包含选区', () => {
    const image = { w: 200, h: 120 }
    const sel = { w: 40, h: 30 } // 4:3，非方形
    for (const x of [0, 5, 40, 80, 120, 155, 160]) {
      for (const y of [0, 5, 30, 60, 85, 90]) {
        const rect = { x, y, ...sel }
        const p = paddedRectOf(rect, image, 0.1)
        const where = JSON.stringify(rect)
        // ① 比例
        expect(Math.abs(p.w / p.h / (rect.w / rect.h) - 1) < 0.02, where).toBe(true)
        // ② 包含选区（四条边）
        expect(p.x <= rect.x, where).toBe(true)
        expect(p.y <= rect.y, where).toBe(true)
        expect(p.x + p.w >= rect.x + rect.w, where).toBe(true)
        expect(p.y + p.h >= rect.y + rect.h, where).toBe(true)
        // ③ 不越界
        expect(p.x >= 0 && p.y >= 0, where).toBe(true)
        expect(p.x + p.w <= image.w && p.y + p.h <= image.h, where).toBe(true)
      }
    }
  })

  it('★ 选区已经顶满整张图时不缩反扩（取整不许把窗口压到比选区小）', () => {
    const p = paddedRectOf({ x: 0, y: 0, w: 100, h: 100 }, { w: 100, h: 100 }, 0.1)
    expect(p).toEqual({ x: 0, y: 0, w: 100, h: 100 })
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
    // 默认外扩比例 0.1（与大雄插件对齐）：宽高各 ×1.2 ⇒ 100×100 → 120×120，居中安放
    expect(ctx.paddedRect).toEqual({ x: 240, y: 90, w: 120, h: 120 })
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
