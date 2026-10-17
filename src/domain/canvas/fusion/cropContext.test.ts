/**
 * 「上下文跟着图片走」的解析规则（产品文档 §6.23）。
 *
 * 这几条是从参考实现里抄下来的**边界**，每一条错了都会导致「融到错的地方」
 * 或者「明明该能融却被拦下」：
 *  - 局部上下文能穿过中间若干个改图节点继续被找到；
 *  - **完整图边界**（融合结果）之前**不再往上找** —— 否则第二轮会挂回上一轮的选区；
 *  - 多个不同选区混进同一张图 = **冲突**，不许猜；
 *  - 同一个选区被两条路径带到同一张图 = 不是冲突（不然「同一张局部图喂两次」会误报）。
 */
import { describe, it, expect } from 'vitest'
import type { CropContext, FusionContext, NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { cropContextFor, missingContextReason, resolveCropContext } from './cropContext'
import { contextFromSelection, planFusion } from './fusionPlan'

const SOURCE = { assetHash: 'a'.repeat(64), width: 1000, height: 1000 }

function localCtx(rect = { x: 10, y: 20, w: 100, h: 50 }): CropContext {
  return {
    source: SOURCE,
    rect,
    paddedRect: { x: 5, y: 15, w: 110, h: 60 },
    paddingRatio: 0.1,
  }
}

function node(id: string, type: NodeSnapshot['type'] = 'generation', data: object = {}): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    title: id,
    disabled: false,
    data: data as NodeSnapshot['data'],
  }
}

function graph(nodes: NodeSnapshot[], links: [string, string][]): GraphSnapshot {
  return {
    projectId: 'p1',
    nodes,
    edges: links.map(([source, target], i) => ({ id: `e${i}`, projectId: 'p1', source, target })),
  }
}

describe('resolveCropContext · 沿上游找上下文', () => {
  it('整条链上没有局部图 → none（普通图片）', () => {
    const g = graph([node('src'), node('gen')], [['src', 'gen']])
    expect(resolveCropContext('gen', g)).toEqual({ kind: 'none' })
  })

  it('自己就带上下文 → 直接用它', () => {
    const g = graph([node('local', 'generation', { cropContext: localCtx() })], [])
    const r = resolveCropContext('local', g)
    expect(r.kind).toBe('local')
    if (r.kind === 'local') expect(r.context.rect).toEqual({ x: 10, y: 20, w: 100, h: 50 })
  })

  it('★ 穿过中间若干**改图节点**仍然找得到（多轮改图不丢上下文）', () => {
    const g = graph(
      [
        node('orig'),
        node('local', 'generation', { cropContext: localCtx() }),
        node('edit1'),
        node('edit2'),
      ],
      [
        ['orig', 'local'],
        ['local', 'edit1'],
        ['edit1', 'edit2'],
      ],
    )
    expect(resolveCropContext('edit2', g).kind).toBe('local')
  })

  it('★★ 碰到「完整图边界」就停下：融合结果不许继承上一轮的选区', () => {
    const g = graph(
      [
        node('orig'),
        node('local', 'generation', { cropContext: localCtx() }),
        node('fused', 'fusion', { cropContext: { full: true } }),
        node('after'),
      ],
      [
        ['orig', 'local'],
        ['local', 'fused'],
        ['fused', 'after'],
      ],
    )
    expect(resolveCropContext('fused', g)).toEqual({ kind: 'none' })
    expect(resolveCropContext('after', g)).toEqual({ kind: 'none' })
  })

  it('★★ 两个**不同**选区混进同一张图 → 冲突（不许猜）', () => {
    const g = graph(
      [
        node('a', 'generation', { cropContext: localCtx({ x: 0, y: 0, w: 100, h: 50 }) }),
        node('b', 'generation', { cropContext: localCtx({ x: 500, y: 500, w: 100, h: 50 }) }),
        node('merged'),
      ],
      [
        ['a', 'merged'],
        ['b', 'merged'],
      ],
    )
    expect(resolveCropContext('merged', g)).toEqual({ kind: 'conflict' })
  })

  it('同一个选区从两条路径汇进来**不算**冲突', () => {
    const ctx = localCtx()
    const g = graph(
      [
        node('a', 'generation', { cropContext: ctx }),
        node('b', 'generation', { cropContext: ctx }),
        node('merged'),
      ],
      [
        ['a', 'merged'],
        ['b', 'merged'],
      ],
    )
    expect(resolveCropContext('merged', g).kind).toBe('local')
  })

  /**
   * ★★★ 「裁剪」写的是 `{ full: true }`（完整图边界），**不是"不写字段"**（对账 #553）。
   *
   * 这条差别很要命：字段缺席时解析会**继续往上穿**，于是「从一张局部图上再裁剪」
   * 会莫名继承上一层的选区 —— 那张裁剪图就会被当成"属于原图某块"的局部图，
   * 融合时挂到不相干的位置上。边界标记才会让它当场停住。
   */
  it('★★★ 裁剪图（full 边界）不许继承祖先的选区', () => {
    const g = graph(
      [
        node('local', 'generation', { cropContext: localCtx() }),
        node('cut', 'generation', { cropContext: { full: true } }),
      ],
      [['local', 'cut']],
    )
    expect(resolveCropContext('cut', g)).toEqual({ kind: 'none' })
  })

  it('环不会让它转不出来（同一节点只访问一次）', () => {
    const g = graph([node('a'), node('b')], [
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(resolveCropContext('a', g)).toEqual({ kind: 'none' })
  })
})

/**
 * **写**这一侧的守卫（用户 2026-10-17 / 对账 #553）。
 *
 * 上面那些用例只能证明"给定了 `{full:true}` 会停"，证明不了我们**真的写了**它 ——
 * 而"该写什么"与"怎么读"是两个会各自单独写错的地方，两边各要一条确定性断言。
 */
describe('cropContextFor · 新裁出来的图该带什么上下文', () => {
  const selection: FusionContext = { id: 'fctx1', ...(localCtx() as Omit<FusionContext, 'id'>) }

  it('★★★ 裁剪写的是「完整图边界」，不是"不写字段"', () => {
    expect(cropContextFor('crop', selection)).toEqual({ full: true })
  })

  it('★ 提取选区写的是真选区，且不带 id（这是图的属性，不是某条记录）', () => {
    const written = cropContextFor('extract', selection)
    expect(written).not.toHaveProperty('id')
    expect(written).toEqual(localCtx())
  })

  it('★★★ 两半接得上：写了边界 ⇒ 从"外层局部图"里再裁剪也不继承它的选区', () => {
    const g = graph(
      [
        node('ancestor', 'generation', { cropContext: localCtx() }),
        node('cut', 'generation', { cropContext: cropContextFor('crop', selection) }),
      ],
      [['ancestor', 'cut']],
    )
    expect(resolveCropContext('cut', g)).toEqual({ kind: 'none' })
  })
})

/**
 * 用户 2026-10-17 报「两个局部提取出来的选区进行生图之后在进入融合节点会有 bug」
 * （对账 #553）时的心智模型：**同一张原图的两块地方各裁一次 → 各自改图 → 一起融回原图**。
 *
 * 这一条把那个模型在纯函数层走一遍，把"本来就支持"和"会被拦下"的边界钉清楚 ——
 * 以后谁要改冲突规则，先看这里：**`conflict` 是按"单张补丁的上游链"算的，
 * 不是按"两张之间"算的**。两张矩形不同的局部图从来就不冲突。
 */
describe('两张各自独立的局部图一起融合（对账 #553 的起因）', () => {
  const rectA = { x: 100, y: 100, w: 200, h: 200 }
  const rectB = { x: 600, y: 600, w: 200, h: 200 }

  it('★★★ 各解析出自己的上下文、且 planFusion 放行（不是冲突）', () => {
    const ctxA = contextFromSelection({ contextId: 'cA', source: SOURCE, rect: rectA })
    const ctxB = contextFromSelection({ contextId: 'cB', source: SOURCE, rect: rectB })
    const g = graph(
      [
        node('cropA', 'generation', { cropContext: ctxA }),
        node('editA'),
        node('cropB', 'generation', { cropContext: ctxB }),
        node('editB'),
        node('fusion', 'fusion'),
      ],
      [
        ['cropA', 'editA'],
        ['cropB', 'editB'],
        ['editA', 'fusion'],
        ['editB', 'fusion'],
      ],
    )
    const a = resolveCropContext('editA', g)
    const b = resolveCropContext('editB', g)
    expect(a.kind).toBe('local')
    expect(b.kind).toBe('local')
    if (a.kind !== 'local' || b.kind !== 'local') return
    /** 各归各的矩形 —— 不是"谁把谁覆盖了" */
    expect(a.context.rect).toEqual(rectA)
    expect(b.context.rect).toEqual(rectB)

    /** 两张方形补丁 ↔ 两条方形外扩矩形（1.2 倍仍是方形）⇒ 比例校验放行 */
    const planned = planFusion({
      original: SOURCE,
      contexts: [
        { id: 'ctx:a', ...a.context },
        { id: 'ctx:b', ...b.context },
      ],
      patches: [
        { nodeId: 'editA', assetHash: '1'.repeat(64), width: 240, height: 240 },
        { nodeId: 'editB', assetHash: '2'.repeat(64), width: 240, height: 240 },
      ],
    })
    expect(planned.ok).toBe(true)
    if (planned.ok) expect(planned.plan.steps.map((s) => s.target)).toEqual([ctxA.paddedRect, ctxB.paddedRect])
  })
})

/**
 * 「为什么解析不到选区」必须**量着图说**（用户 2026-10-17 在真实项目里撞上 → 对账 #557）。
 *
 * 背景：原来那句写死了「用「裁剪」得到的不带上下文」。而用户明明是用「提取选区」做的
 * 局部图，真正的原因是**上游接的不是那张局部图** —— 一句断言式的原因把人指到了错方向。
 * 现在按图上实际情况分三种，判据取"有没有点出真实的上游"，取"提示非空"抓不住退化。
 */
describe('missingContextReason · 量着图说原因', () => {
  it('★★★ 上游接的是别的图（例如原图）→ 把上游名字点出来', () => {
    const g = graph(
      [{ ...node('u1', 'generation'), title: 'IMG_9134' }, node('gen')],
      [['u1', 'gen']],
    )
    const reason = missingContextReason('gen', g, 1)
    expect(reason).toContain('第 1 张局部图没有选区上下文')
    expect(reason).toContain('IMG_9134')
    expect(reason).toContain('没有')
    expect(reason).toContain('提取选区')
  })

  it('★★ 没有上游 → 明说"没有上游"，而不是猜一个原因', () => {
    const g = graph([node('gen')], [])
    const reason = missingContextReason('gen', g, 2)
    expect(reason).toContain('第 2 张')
    expect(reason).toContain('没有上游')
  })

  it('★★ 它自己就是完整图边界（裁剪 / 融合产物）→ 指出这一条，不去怪上游', () => {
    const g = graph([node('cut', 'generation', { cropContext: { full: true } })], [])
    const reason = missingContextReason('cut', g, 1)
    expect(reason).toContain('完整图边界')
    expect(reason).toContain('裁剪')
    expect(reason).not.toContain('没有上游')
  })
})
