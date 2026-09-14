import { describe, it, expect, beforeEach } from 'vitest'
import { createCanvasStore } from '../workbenches/canvas/store'
import { createMemoryPlatform } from '../../platform/memory'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { seedTemplate, TEMPLATES } from './templates'
import type { PlatformKit } from '../../platform/ports'

let platform: PlatformKit

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
  platform = createMemoryPlatform()
})

describe('模板库', () => {
  it('六个模板元数据齐全且 id 稳定', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      'blank',
      'text2img',
      'img2img',
      'img2video',
      'batch-img',
      'batch-style',
    ])
  })

  it('blank 不生成任何节点，也不进撤销栈', () => {
    const store = createCanvasStore({ platform, projectId: 'p-blank' })
    seedTemplate(store, 'blank')
    expect(store.getSnapshot().nodes).toHaveLength(0)
    expect(store.canUndo()).toBe(false)
  })

  it('text2img：提示词 + 图片生成，且提示词 → 生成已连线', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    seedTemplate(store, 'text2img')
    const g = store.getSnapshot()
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(g.nodes.map((n) => n.type).sort()).toEqual(['generation', 'prompt'])
    const prompt = g.nodes.find((n) => n.type === 'prompt')!
    expect(g.edges[0]!.source).toBe(prompt.id)
  })

  it('img2img：底图生成 → 图生图，两端同为 image 模式（M6-12）', () => {
    const store = createCanvasStore({ platform, projectId: 'p-img2img' })
    seedTemplate(store, 'img2img')
    const g = store.getSnapshot()
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.every((n) => n.type === 'generation')).toBe(true)
    expect(g.edges).toHaveLength(1)
    const modes = g.nodes.map((n) => (n.data as { mode: string }).mode)
    expect(modes).toEqual(['image', 'image'])
    // 上游 → 下游：下游把上游的产物当参考图
    expect(g.edges[0]!.source).toBe(g.nodes[0]!.id)
    expect(g.edges[0]!.target).toBe(g.nodes[1]!.id)
  })

  it('img2video：图片生成 → 视频生成（generation→generation 连线合法）', () => {
    const store = createCanvasStore({ platform, projectId: 'p2' })
    expect(() => seedTemplate(store, 'img2video')).not.toThrow()
    const g = store.getSnapshot()
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.every((n) => n.type === 'generation')).toBe(true)
    expect(g.edges).toHaveLength(1)
    expect((g.nodes[1]!.data as { mode: string }).mode).toBe('video')
  })

  it('batch-img：提示词 → 图片生成（count=4）→ 对比节点（§5.4）', () => {
    const store = createCanvasStore({ platform, projectId: 'p3' })
    seedTemplate(store, 'batch-img')
    const g = store.getSnapshot()
    expect(g.nodes.map((n) => n.type)).toEqual(['prompt', 'generation', 'compare'])
    expect(g.edges).toHaveLength(2)
    const gen = g.nodes[1]!
    expect((gen.data as { count?: number }).count).toBe(4)
    // 提示词 → 生成 → 对比，三段都真的连上了（不是只把节点摆出来）
    expect(g.edges[0]!.source).toBe(g.nodes[0]!.id)
    expect(g.edges[0]!.target).toBe(gen.id)
    expect(g.edges[1]!.source).toBe(gen.id)
    expect(g.edges[1]!.target).toBe(g.nodes[2]!.id)
  })

  it('batch-style：批量容器 → 生成节点（§5.4「批量节点 + 外部素材 → 生成节点」）', () => {
    const store = createCanvasStore({ platform, projectId: 'p4' })
    seedTemplate(store, 'batch-style')
    const g = store.getSnapshot()
    expect(g.nodes.map((n) => n.type)).toEqual(['batch', 'generation'])
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.source).toBe(g.nodes[0]!.id)
    expect(g.edges[0]!.target).toBe(g.nodes[1]!.id)
  })

  it('模板 hint 里不再出现「待 M3」这类过期承诺', () => {
    for (const t of TEMPLATES) {
      expect(t.hint).not.toMatch(/M\d/)
      expect(t.hint.length).toBeGreaterThan(0)
    }
  })

  it('模板预置合并为单个撤销单元（一次 undo 清空全部）', () => {
    const store = createCanvasStore({ platform, projectId: 'p5' })
    seedTemplate(store, 'text2img')
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(store.getSnapshot().nodes).toHaveLength(0)
  })
})
