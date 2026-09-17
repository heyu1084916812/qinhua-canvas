import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs, resetSpecs } from './index'
import { getSpec } from './registry'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot } from '../model/node'

function node(over: Partial<NodeSnapshot> & { id: string; type: NodeSnapshot['type'] }): NodeSnapshot {
  return {
    projectId: 'p1',
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    title: over.id,
    disabled: false,
    data: {},
    ...over,
  } as NodeSnapshot
}

function graph(nodes: NodeSnapshot[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges, }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('生成节点规格 / 输入收集（M6-12）', () => {
  it('上游生成节点的产物被收成图像输入（图生图 / 图生视频）', () => {
    const g = graph(
      [
        node({ id: 'down', type: 'generation', data: { mode: 'image' } as never }),
        node({ id: 'up', type: 'generation', data: { mode: 'image', assetHash: 'h-up' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'up', target: 'down' }],
    )
    expect(getSpec('generation')!.collectInputs({ node: g.nodes[0]!, graph: g })).toEqual([
      { kind: 'asset', nodeId: 'up', assetHash: 'h-up', mime: 'image/png' },
    ])
  })

  it('上游还没生成（无 assetHash）→ 不产生输入，也不报错', () => {
    const g = graph(
      [
        node({ id: 'down', type: 'generation', data: { mode: 'image' } as never }),
        node({ id: 'up', type: 'generation', data: { mode: 'image' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'up', target: 'down' }],
    )
    expect(getSpec('generation')!.collectInputs({ node: g.nodes[0]!, graph: g })).toEqual([])
  })

  it('提示词与图片上游并存 → 文本 + 图像都收', () => {
    const g = graph(
      [
        node({ id: 'down', type: 'generation', data: { mode: 'image' } as never }),
        node({ id: 'txt', type: 'prompt', data: { text: '一只猫' } as never }),
        node({ id: 'img', type: 'generation', data: { assetHash: 'h1' } as never }),
      ],
      [
        { id: 'e1', projectId: 'p1', source: 'txt', target: 'down' },
        { id: 'e2', projectId: 'p1', source: 'img', target: 'down' },
      ],
    )
    const inputs = getSpec('generation')!.collectInputs({ node: g.nodes[0]!, graph: g })
    expect(inputs.map((i) => i.kind)).toEqual(['text', 'asset'])
  })

  it('被「隐藏上游」勾选的图不参与输入（§6.8 小眼睛语义一致）', () => {
    const g = graph(
      [
        node({
          id: 'down',
          type: 'generation',
          data: { mode: 'image', upstreamHidden: ['img'] } as never,
        }),
        node({ id: 'img', type: 'generation', data: { assetHash: 'h1' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'img', target: 'down' }],
    )
    expect(getSpec('generation')!.collectInputs({ node: g.nodes[0]!, graph: g })).toEqual([])
  })
})

/**
 * 请求参数按功能类别分支（§6.8）。
 *
 * 这一组盯的是一个「声明了却无人消费」的洞：`GenerationData` 里的
 * `size` / `durationSec` / `refMode` 三个视频字段在三个规格的参数构造里**都没被发出去**，
 * 于是视频参数在链路上等于不存在——数据结构接好了，却从没被读过，
 * 与 M6-12 之前 `inputs` 从未被渠道消费是同一类问题。
 */
describe('生成节点规格 / 请求参数按功能类别分支（§6.8）', () => {
  const reqOf = (type: NodeSnapshot['type'], data: Record<string, unknown>) => {
    const g = graph([node({ id: 'n', type, data: data as never })])
    return getSpec(type)!.toRunRequest!({
      node: g.nodes[0]!,
      inputs: [],
      params: g.nodes[0]!.data,
      graph: g,
    })
  }

  it('图片模式：发 数量 / 比例 / 画质 / 质量', () => {
    const req = reqOf('generation', {
      mode: 'image',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      count: 4,
      ratio: '1:1',
      resolution: '2k',
      quality: 'high',
      size: '720p',
    })
    expect(req!.kind).toBe('image')
    expect(req!.params).toEqual({ count: 4, ratio: '1:1', resolution: '2k', quality: 'high' })
  })

  it('画质 = 自动（或未设置）→ 不塞进 params：「自动」是不指定，不是 1K', () => {
    // 原样下发会让渠道收到一个它不认的档位值（'auto' 从来不是画质档位）。
    const auto = reqOf('generation', {
      mode: 'image',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      resolution: 'auto',
    })
    expect(auto!.params).toEqual({ count: 1, ratio: null, resolution: null, quality: null })

    const unset = reqOf('generation', {
      mode: 'image',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
    })
    expect(unset!.params.resolution).toBeNull()
  })

  it('视频模式：发 尺寸 / 时长 / 参考模式', () => {
    const req = reqOf('generation', {
      mode: 'video',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      size: '720p',
      durationSec: 8,
      refMode: 'all-purpose',
      count: 4,
    })
    expect(req!.kind).toBe('video')
    expect(req!.params).toEqual({ ratio: null, size: '720p', durationSec: 8, refMode: 'all-purpose' })
  })

  it('视频模式不发图片参数：别让渠道收到 resolution 却不知道该不该用', () => {
    const req = reqOf('generation', {
      mode: 'video',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      resolution: '2k',
      quality: 'high',
      count: 4,
    })
    expect(req!.params).not.toHaveProperty('resolution')
    expect(req!.params).not.toHaveProperty('quality')
    expect(req!.params).not.toHaveProperty('count')
  })

  it('分组复用同一份参数构造（三处各抄一份是本洞的成因）', () => {
    const req = reqOf('group', {
      mode: 'video',
      channelId: 'c',
      model: 'm',
      prompt: 'p',
      size: '480p',
      durationSec: 5,
      refMode: 'first-last-frame',
      childIds: [],
    })
    expect(req!.params).toEqual({ ratio: null, size: '480p', durationSec: 5, refMode: 'first-last-frame' })
  })
})
