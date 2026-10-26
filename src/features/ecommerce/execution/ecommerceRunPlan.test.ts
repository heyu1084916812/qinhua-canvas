import { describe, expect, it } from 'vitest'
import { buildEcommerceRunPlan } from './ecommerceRunPlan'

describe('buildEcommerceRunPlan', () => {
  it('每个结果行生成一个 task，不依赖画布节点 id', () => {
    const plan = buildEcommerceRunPlan({
      taskId: 'ect_1',
      mediaKind: 'image',
      channelId: 'ch_1',
      model: 'upstream-image',
      credentialGroupId: 'group_1',
      inputs: [
        {
          kind: 'asset',
          nodeId: 'input_product',
          assetHash: 'asset_1',
          mime: 'image/png',
        },
      ],
      shots: [
        {
          resultId: 'ecr_1',
          subjectId: 'ecsubject_1',
          prompt: '第一张',
          params: { ratio: '1:1', count: 1 },
          metadata: { shotTitle: '主图', ratio: '1:1' },
        },
        {
          resultId: 'ecr_2',
          prompt: '第二张',
          params: { ratio: '3:4', count: 1 },
        },
      ],
    })

    expect(plan.id).toBe('ecommerce:ect_1:run')
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]).toMatchObject({
      id: 'ect_1:task:1',
      nodeId: 'ecsubject_1',
      planId: 'ecommerce:ect_1:run',
      taskId: 'ect_1',
      resultId: 'ecr_1',
      request: {
        kind: 'image',
        channelId: 'ch_1',
        model: 'upstream-image',
        credentialGroupId: 'group_1',
        prompt: '第一张',
      },
      metadata: { shotTitle: '主图' },
    })
    expect(plan.tasks[1]).toMatchObject({
      resultId: 'ecr_2',
      seq: 1,
      request: { prompt: '第二张', params: { ratio: '3:4', count: 1 } },
    })
  })

  it('相同输入得到稳定指纹，提示词变化则指纹变化', () => {
    const make = (prompt: string) =>
      buildEcommerceRunPlan({
        taskId: 'ect_1',
        mediaKind: 'video',
        channelId: 'ch_1',
        model: 'video-model',
        inputs: [],
        shots: [{ resultId: 'ecr_1', prompt, params: { durationSec: 5 } }],
      }).tasks[0]!.fingerprint

    expect(make('同一句')).toBe(make('同一句'))
    expect(make('同一句')).not.toBe(make('换一句'))
  })

  it('缺少任务、渠道、模型或结果行时直接失败', () => {
    expect(() =>
      buildEcommerceRunPlan({
        taskId: '',
        mediaKind: 'image',
        channelId: 'ch',
        model: 'm',
        inputs: [],
        shots: [{ resultId: 'r', prompt: 'p', params: {} }],
      }),
    ).toThrow('任务 id')
    expect(() =>
      buildEcommerceRunPlan({
        taskId: 't',
        mediaKind: 'image',
        channelId: '',
        model: 'm',
        inputs: [],
        shots: [{ resultId: 'r', prompt: 'p', params: {} }],
      }),
    ).toThrow('缺少渠道')
    expect(() =>
      buildEcommerceRunPlan({
        taskId: 't',
        mediaKind: 'image',
        channelId: 'c',
        model: '',
        inputs: [],
        shots: [{ resultId: 'r', prompt: 'p', params: {} }],
      }),
    ).toThrow('缺少模型')
    expect(() =>
      buildEcommerceRunPlan({
        taskId: 't',
        mediaKind: 'image',
        channelId: 'c',
        model: 'm',
        inputs: [],
        shots: [],
      }),
    ).toThrow('没有结果行')
  })
})
