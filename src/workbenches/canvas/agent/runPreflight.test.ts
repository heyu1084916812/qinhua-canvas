import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createChannel } from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import { runPreflightProblems } from './runPreflight'

registerAllSpecs()

const node = (overrides: Partial<Record<string, unknown>> = {}): NodeSnapshot =>
  ({
    id: 'gen-1',
    type: 'generation',
    title: '婴童泳圈三视图',
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    parentId: null,
    data: {
      mode: 'image',
      prompt: '婴童泳圈三视图',
      channelId: 'ch-1',
      model: 'gpt-image-2',
      ...overrides,
    },
  }) as NodeSnapshot

const graph = (nodes: NodeSnapshot[]): GraphSnapshot =>
  ({ projectId: 'p1', nodes, edges: [] }) as GraphSnapshot

const channel = {
  ...createChannel({
    name: '图片渠道',
    protocol: 'openai-images',
    baseUrl: 'https://example.com',
  }),
  id: 'ch-1',
  enabled: true,
  hasToken: true,
  models: [],
  modelCache: [],
}

describe('runPreflightProblems', () => {
  it('没有渠道时在确认前返回真实原因，不进入“无记录”分支', () => {
    expect(runPreflightProblems(['gen-1'], graph([node()]), [])).toEqual([
      '「婴童泳圈三视图」无法运行：还没有配置任何渠道',
    ])
  })

  it('渠道、模型、提示词都齐时不阻塞', () => {
    expect(runPreflightProblems(['gen-1'], graph([node()]), [channel])).toEqual([])
  })

  it('节点残留旧渠道时，仍按逻辑模型映射到已启用渠道', () => {
    const mapped = {
      ...channel,
      id: 'ch-chat2api',
      modelMap: { 'GPT Image 2': 'gpt-image-2' },
      models: [
        {
          id: 'gpt-image-2',
          category: 'image',
          inputTypes: ['text', 'image'],
        },
      ] as ModelCapability[],
    }
    expect(
      runPreflightProblems(
        ['gen-1'],
        graph([
          node({
            channelId: 'ch-smoke-removed',
            model: 'GPT Image 2',
          }),
        ]),
        [mapped],
      ),
    ).toEqual([])
  })

  it('渠道已启用但没有令牌时也提前拦住', () => {
    expect(
      runPreflightProblems(['gen-1'], graph([node()]), [{ ...channel, hasToken: false }]),
    ).toEqual(['「婴童泳圈三视图」无法运行：所选渠道缺少有效令牌、地址或可用协议'])
  })

  it('确认后渠道被停用时返回与节点一致的明确原因', () => {
    expect(
      runPreflightProblems(
        ['gen-1'],
        graph([node()]),
        [
          { ...channel, enabled: false },
          { ...channel, id: 'ch-2', name: '备用渠道', enabled: true },
        ],
      ),
    ).toEqual(['「婴童泳圈三视图」无法运行：所选渠道已停用'])
  })

  it('非生成节点和不存在节点都如实处理', () => {
    const prompt = { ...node(), id: 'prompt-1', type: 'prompt' } as NodeSnapshot
    expect(runPreflightProblems(['prompt-1', 'missing'], graph([prompt]), [channel])).toEqual([
      '节点不存在：missing',
    ])
  })
})
