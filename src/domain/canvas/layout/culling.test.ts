import { describe, it, expect } from 'vitest'
import type { NodeSnapshot } from '../model/node'
import { visibleTopLevelIds, visibleWorldRect, CULL_MARGIN_SCREEN } from './culling'

function node(id: string, x: number, y: number, w = 160, h = 80): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'prompt',
    parentId: null,
    x,
    y,
    w,
    h,
    title: id,
    disabled: false,
    data: { text: '', upstreamPromptLinked: false, channelId: '', model: '' },
  }
}

/** surface 1280×800、zoom 1 时可见的世界矩形（margin 外扩后） */
function viewAt(vp = { x: 0, y: 0, zoom: 1 }) {
  return visibleWorldRect(vp, 1280, 800)
}

describe('visibleWorldRect', () => {
  it('屏幕视口换算为世界矩形并外扩 margin', () => {
    const r = viewAt()
    const m = CULL_MARGIN_SCREEN
    expect(r.x).toBe(-m)
    expect(r.y).toBe(-m)
    expect(r.w).toBe(1280 + m * 2)
    expect(r.h).toBe(800 + m * 2)
  })

  it('zoom 缩小时世界矩形按比例放大', () => {
    const r = viewAt({ x: 0, y: 0, zoom: 0.5 })
    expect(r.w).toBeGreaterThan(1280 * 2)
  })
})

describe('visibleTopLevelIds', () => {
  it('视口内节点可见，视口外被裁掉', () => {
    const nodes = [node('in', 100, 100), node('far', 5000, 5000)]
    const ids = visibleTopLevelIds(nodes, { x: 0, y: 0, zoom: 1 }, 1280, 800)
    expect(ids.has('in')).toBe(true)
    expect(ids.has('far')).toBe(false)
  })

  it('margin 外扩：视口边界外的邻近节点仍可见（平移预热挂载）', () => {
    const nodes = [node('near', 1300, 0), node('far', 4000, 0)]
    const ids = visibleTopLevelIds(nodes, { x: 0, y: 0, zoom: 1 }, 1280, 800)
    expect(ids.has('near')).toBe(true)
    expect(ids.has('far')).toBe(false)
  })

  it('与视口仅边界相邻（margin 外）的节点被精确过滤', () => {
    // 世界可见右边界 = 1280 + margin(280) = 1560；节点放在 1561 起应被裁掉
    const nodes = [node('beyond', 1561 + 2, 0)]
    const ids = visibleTopLevelIds(nodes, { x: 0, y: 0, zoom: 1 }, 1280, 800)
    expect(ids.has('beyond')).toBe(false)
  })

  it('跨格大节点（尺寸超过格径）不漏判', () => {
    const nodes = [node('big', 600, 600, 1200, 1200), node('far', -5000, -5000)]
    const ids = visibleTopLevelIds(nodes, { x: 0, y: 0, zoom: 1 }, 1280, 800)
    expect(ids.has('big')).toBe(true)
    expect(ids.has('far')).toBe(false)
  })

  it('surface 尺寸为 0 时回退全量（宁可多渲染不可白屏）', () => {
    const nodes = [node('a', 0, 0), node('b', 99999, 99999)]
    const ids = visibleTopLevelIds(nodes, { x: 0, y: 0, zoom: 1 }, 0, 0)
    expect(ids.size).toBe(2)
  })

  it('平移后可见集合随视口变化', () => {
    const nodes = [node('a', 0, 0), node('b', 3000, 0)]
    const vp = { x: 0, y: 0, zoom: 1 }
    expect(visibleTopLevelIds(nodes, vp, 1280, 800).has('b')).toBe(false)
    // 平移到 x=3000 附近 → b 可见、a 移出
    const vp2 = { x: 3000, y: 0, zoom: 1 }
    const ids = visibleTopLevelIds(nodes, vp2, 1280, 800)
    expect(ids.has('b')).toBe(true)
    expect(ids.has('a')).toBe(false)
  })

  it('负坐标节点同样覆盖（格索引下界）', () => {
    // margin 280：-280 以内的负坐标节点可见，更远的被裁
    const nodes = [node('neg', -200, -200), node('far', -3000, -3000)]
    const ids = visibleTopLevelIds(nodes, { x: 0, y: 0, zoom: 1 }, 1280, 800)
    expect(ids.has('neg')).toBe(true)
    expect(ids.has('far')).toBe(false)
  })
})
