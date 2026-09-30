import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs, getSpec, allSpecs, registeredTypes, resetSpecs } from './index'
import { registerSpec } from './registry'
import type { NodeSpec } from './types'
import type { PromptData } from '../model/node'

function fakeSpec(type: 'prompt'): NodeSpec<PromptData> {
  return {
    type,
    label: '假',
    sizing: { min: { w: 10, h: 10 } },
    ports: { input: true, output: true },
    accepts: { upstream: [] },
    createDefaultData: () => ({ text: '', upstreamPromptLinked: false }),
    collectInputs: () => [],
  }
}

describe('节点规格注册表', () => {
  beforeEach(() => {
    resetSpecs()
  })

  it('注册后可取回，未注册返回 null', () => {
    expect(getSpec('prompt')).toBeNull()
    registerAllSpecs()
    expect(getSpec('prompt')?.label).toBe('提示词')
    expect(getSpec('generation')?.label).toBe('生成')
    expect(getSpec('compare')?.label).toBe('对比')
    expect(getSpec('group')?.label).toBe('分组')
    expect(getSpec('batch')?.label).toBe('批量')
    expect(getSpec('board')?.label).toBe('画板')
    expect(getSpec('fusion')?.label).toBe('融合节点')
  })

  it('重复注册同一类型直接抛错', () => {
    registerAllSpecs()
    expect(() => registerSpec(fakeSpec('prompt'))).toThrow(/重复注册/)
  })

  it('registerAllSpecs 幂等', () => {
    registerAllSpecs()
    registerAllSpecs()
    expect(registeredTypes().sort()).toEqual([
      'batch',
      'board',
      'compare',
      'fusion',
      'generation',
      'group',
      'loop',
      'prompt',
    ])
    expect(allSpecs()).toHaveLength(8)
  })

  it('提示词节点默认数据可用，输入收集返回自身文本', () => {
    registerAllSpecs()
    const spec = getSpec('prompt')
    expect(spec?.createDefaultData()).toEqual({ text: '', upstreamPromptLinked: false, channelId: '', model: '' })

    const node = {
      id: 'n1',
      projectId: 'p1',
      type: 'prompt' as const,
      parentId: null,
      x: 0,
      y: 0,
      w: 240,
      h: 160,
      title: '提示词',
      disabled: false,
      data: { text: '一只猫', upstreamPromptLinked: false } satisfies PromptData,
    }
    expect(spec?.collectInputs({ node, graph: { projectId: 'p1', nodes: [], edges: [], } })).toEqual([
      { kind: 'text', nodeId: 'n1', text: '一只猫' },
    ])
  })

  it('M0 阶段提示词节点不实现 generate', () => {
    registerAllSpecs()
    expect(getSpec('prompt')?.generate).toBeUndefined()
  })

  // —— 对比节点（M3-1 / §6.10）——

  it('对比节点默认分割比例为 0.5，不可生成', () => {
    registerAllSpecs()
    const spec = getSpec('compare')
    expect(spec?.createDefaultData()).toEqual({ splitRatio: 0.5 })
    expect(spec?.generate).toBeUndefined()
    expect(spec?.toRunRequest).toBeUndefined()
  })

  it('对比节点按上游顺序取前 2 张带素材的图片', () => {
    registerAllSpecs()
    const spec = getSpec('compare')
    const mk = (id: string, assetHash?: string) => ({
      id,
      projectId: 'p1',
      type: 'generation' as const,
      parentId: null,
      x: 0,
      y: 0,
      w: 240,
      h: 240,
      title: '生成',
      disabled: false,
      data: {
        mode: 'image' as const,
        assetHash,
        prompt: '',
        linkedPromptNodeIds: [],
        channelId: 'c1',
        model: 'm1',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })
    const node = {
      id: 'cmp',
      projectId: 'p1',
      type: 'compare' as const,
      parentId: null,
      x: 0,
      y: 0,
      w: 240,
      h: 180,
      title: '对比',
      disabled: false,
      data: { splitRatio: 0.5 },
    }
    const graph = {
      projectId: 'p1',
      nodes: [mk('g1', 'h1'), mk('g2'), mk('g3', 'h3'), mk('g4', 'h4'), node],
      edges: [
        { id: 'e1', projectId: 'p1', source: 'g1', target: 'cmp' },
        { id: 'e2', projectId: 'p1', source: 'g2', target: 'cmp' },
        { id: 'e3', projectId: 'p1', source: 'g3', target: 'cmp' },
        { id: 'e4', projectId: 'p1', source: 'g4', target: 'cmp' },
      ],
      
    }
    // g2 无素材被跳过，取到 g1 / g3 两张后即停（超过 2 张忽略）
    expect(spec?.collectInputs({ node, graph })).toEqual([
      { kind: 'asset', nodeId: 'g1', assetHash: 'h1', mime: 'image/png' },
      { kind: 'asset', nodeId: 'g3', assetHash: 'h3', mime: 'image/png' },
    ])
  })

  it('对比节点吃上游「跑 4 张」的结果组：取组内前 2 张（§5.4 批量出图主流程）', () => {
    registerAllSpecs()
    const spec = getSpec('compare')
    const mk = (id: string, assetHash?: string, parentId: string | null = null) => ({
      id,
      projectId: 'p1',
      type: 'generation' as const,
      parentId,
      x: 0,
      y: 0,
      w: 240,
      h: 240,
      title: '生成',
      disabled: false,
      data: {
        mode: 'image' as const,
        assetHash,
        prompt: '',
        linkedPromptNodeIds: [],
        channelId: 'c1',
        model: 'm1',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })
    const node = {
      id: 'cmp',
      projectId: 'p1',
      type: 'compare' as const,
      parentId: null,
      x: 0,
      y: 0,
      w: 240,
      h: 180,
      title: '对比',
      disabled: false,
      data: { splitRatio: 0.5 },
    }
    /**
     * 上游跑 4 张 → 现在是**4 个并列承载节点**挂在来源下游（结果组已下线），
     * 对比节点从**多个上游节点**各取 1 张、取前 2 个。
     *
     * 旧用例是「一个上游 + 组内 4 张」。组没了，但**要验的规则没变**：
     * 对比节点不能退化成「只取 1 张」——否则批量出图 → 对比永远只有 A 没有 B。
     */
    const graph = {
      projectId: 'p1',
      nodes: [
        mk('g1', 'r1'),
        mk('c1', 'r5'),
        mk('c2', 'r2'),
        mk('c3', 'r3'),
        mk('c4', 'r4'),
        node,
      ],
      edges: [
        { id: 'e1', projectId: 'p1', source: 'g1', target: 'cmp' },
        { id: 'e2', projectId: 'p1', source: 'c1', target: 'cmp' },
        { id: 'e3', projectId: 'p1', source: 'c2', target: 'cmp' },
        { id: 'e4', projectId: 'p1', source: 'c3', target: 'cmp' },
        { id: 'e5', projectId: 'p1', source: 'c4', target: 'cmp' },
      ],
    }
    // 关键：不是「只取上游自身那 1 张」——否则批量出图 → 对比永远只有 A 没有 B
    expect(spec?.collectInputs({ node, graph })).toEqual([
      { kind: 'asset', nodeId: 'g1', assetHash: 'r1', mime: 'image/png' },
      { kind: 'asset', nodeId: 'c1', assetHash: 'r5', mime: 'image/png' },
    ])
  })
})
