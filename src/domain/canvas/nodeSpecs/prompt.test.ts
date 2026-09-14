import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs, resetSpecs } from './index'
import { promptSpec } from './prompt'
import { imageAssetInputsOf } from '../../shared/execution/inputs'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot, PromptData } from '../model/node'

function node(over: Partial<NodeSnapshot> & { id: string; type: NodeSnapshot['type'] }): NodeSnapshot {
  return {
    projectId: 'p1',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    title: over.id,
    disabled: false,
    data: {},
    ...over,
  } as NodeSnapshot
}

function graph(nodes: NodeSnapshot[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges, resultGroups: [] }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

/**
 * §6.7「反推提示词」的数据前提：上游那张图必须真的进 `inputs`。
 *
 * 此前 `collectInputs` 只产出本节点文本，于是上游图片**仅作可见素材**——
 * 线画了、缩略图显示了，请求里却永远只有文字。这组断言专门盯这条链路，
 * 免得哪天改动又把「图」悄悄漏掉（与 M6-12 的 `inputs` 是同一类事故）。
 */
describe('提示词节点规格 / 输入收集（§6.7 反推）', () => {
  it('上游生成节点已出图 → 收成图像素材输入', () => {
    const g = graph(
      [
        node({ id: 'p', type: 'prompt', data: { text: '描述它' } as never }),
        node({ id: 'up', type: 'generation', data: { mode: 'image', assetHash: 'h-up' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'up', target: 'p' }],
    )
    expect(promptSpec.collectInputs({ node: g.nodes[0]! as NodeSnapshot<PromptData>, graph: g })).toEqual([
      { kind: 'text', nodeId: 'p', text: '描述它' },
      { kind: 'asset', nodeId: 'up', assetHash: 'h-up', mime: 'image/png' },
    ])
  })

  it('上游还没出图（无 assetHash）→ 只有文本，不产生空素材项', () => {
    const g = graph(
      [
        node({ id: 'p', type: 'prompt', data: { text: 'x' } as never }),
        node({ id: 'up', type: 'generation', data: { mode: 'image' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'up', target: 'p' }],
    )
    expect(promptSpec.collectInputs({ node: g.nodes[0]! as NodeSnapshot<PromptData>, graph: g })).toEqual([
      { kind: 'text', nodeId: 'p', text: 'x' },
    ])
  })

  it('上游是提示词节点 → 不产生素材项（提示词没有图可喂）', () => {
    const g = graph(
      [
        node({ id: 'p', type: 'prompt', data: { text: 'x' } as never }),
        node({ id: 'up', type: 'prompt', data: { text: '上游提示词' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'up', target: 'p' }],
    )
    const inputs = promptSpec.collectInputs({ node: g.nodes[0]! as NodeSnapshot<PromptData>, graph: g })
    expect(inputs.filter((i) => i.kind === 'asset')).toEqual([])
  })

  it('imageAssetInputsOf 从收集结果里挑出图（视图与请求取同一份数据）', () => {
    const g = graph(
      [
        node({ id: 'p', type: 'prompt', data: { text: 'x' } as never }),
        node({ id: 'a', type: 'generation', data: { mode: 'image', assetHash: 'h1' } as never }),
        node({ id: 'b', type: 'generation', data: { mode: 'image', assetHash: 'h2' } as never }),
      ],
      [
        { id: 'e1', projectId: 'p1', source: 'a', target: 'p' },
        { id: 'e2', projectId: 'p1', source: 'b', target: 'p' },
      ],
    )
    const images = imageAssetInputsOf(promptSpec.collectInputs({ node: g.nodes[0]! as NodeSnapshot<PromptData>, graph: g }))
    expect(images.map((i) => i.assetHash)).toEqual(['h1', 'h2'])
    // 保留 nodeId：请求要能溯源「这张图来自哪个节点」
    expect(images.map((i) => i.nodeId)).toEqual(['a', 'b'])
  })
})
