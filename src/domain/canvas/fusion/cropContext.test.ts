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
import type { CropContext, NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { resolveCropContext } from './cropContext'

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

  it('环不会让它转不出来（同一节点只访问一次）', () => {
    const g = graph([node('a'), node('b')], [
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(resolveCropContext('a', g)).toEqual({ kind: 'none' })
  })
})
