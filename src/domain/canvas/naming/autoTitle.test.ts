import { describe, expect, it } from 'vitest'
import {
  generatedNodeTitle,
  isGenericGenerationTitle,
  migrateLegacyGeneratedTitles,
  titleStemFromPrompt,
  titleStemFromMaterial,
} from './autoTitle'
import type { GenerationData, NodeSnapshot } from '../model/node'

describe('普通画布自动命名', () => {
  it('默认标题可识别，手动标题不会被当成默认名', () => {
    for (const title of [
      '生成',
      '图片生成',
      '生成的输出1',
      '提示词的输出2',
      '结果 3',
      'image',
      'image的输出1',
      'image的输出1-01',
      'image的输出1的输出2',
    ]) {
      expect(isGenericGenerationTitle(title), title).toBe(true)
    }
    expect(isGenericGenerationTitle('雨夜快递海报')).toBe(false)
    expect(isGenericGenerationTitle('小猫钓鱼')).toBe(false)
    expect(isGenericGenerationTitle('image of a dog')).toBe(false)
  })

  it('去掉常见命令词，只取提示词首句并限制视觉宽度', () => {
    expect(titleStemFromPrompt('请帮我生成一张白底运动鞋主图，右侧留白。', 'image')).toBe(
      '白底运动鞋主图',
    )
    expect(titleStemFromPrompt('帮我画一幅：雨夜里的红色电话亭。第二句不要。', 'image')).toBe(
      '雨夜里的红色电话亭',
    )
    expect(Array.from(titleStemFromPrompt('一'.repeat(40), 'image'))).toHaveLength(9)
  })

  it('空提示词有可读兜底，不会生成空标题', () => {
    expect(titleStemFromPrompt('   ', 'image')).toBe('图片')
    expect(titleStemFromPrompt('', 'video')).toBe('视频')
  })

  it('默认名改从提示词生成，多张结果带稳定序号', () => {
    expect(
      generatedNodeTitle({
        prompt: '请生成一张奶瓶产品主图',
        mode: 'image',
        slotKind: 'reuse',
        sourceTitle: '生成',
        targetTitle: '生成',
        index: 0,
        total: 1,
      }),
    ).toBe('奶瓶产品主图')

    expect(
      generatedNodeTitle({
        prompt: '请生成一张奶瓶产品主图',
        mode: 'image',
        slotKind: 'new',
        sourceTitle: '生成',
        targetTitle: '生成的输出1',
        index: 1,
        total: 2,
      }),
    ).toBe('奶瓶产品主图-02')
  })

  it('用户明确命名优先，不会被提示词摘要覆盖', () => {
    expect(
      generatedNodeTitle({
        prompt: '请生成一张奶瓶产品主图',
        mode: 'image',
        slotKind: 'reuse',
        sourceTitle: '生成',
        targetTitle: '客户 A 的春季主图',
        index: 0,
        total: 1,
      }),
    ).toBe('客户 A 的春季主图')
  })

  it('★★ 英文输出链不再被当成手动名，也不会进入素材名', () => {
    expect(titleStemFromMaterial('image的输出1-02.png')).toBe('')
    expect(
      generatedNodeTitle({
        prompt: '狗狗体型缩小50%，其他保持不变，',
        mode: 'image',
        slotKind: 'reuse',
        sourceTitle: 'image的输出1',
        targetTitle: 'image的输出1-02',
        materialTitle: 'image的输出1',
        index: 1,
        total: 4,
      }),
    ).toBe('狗狗体型缩小50%-02')
  })

  it('★★ 旧链式自动名按同一提示词成组迁移，空生成节点与手动名分别处理', () => {
    const gen = (
      id: string,
      title: string,
      over: Partial<GenerationData> = {},
    ): NodeSnapshot => ({
      id,
      projectId: 'p1',
      type: 'generation',
      parentId: null,
      x: 0,
      y: 0,
      w: 240,
      h: 240,
      title,
      disabled: false,
      data: {
        mode: 'image',
        assetHash: `h-${id}`,
        prompt: '狗狗体型缩小50%，其他保持不变，',
        linkedPromptNodeIds: [],
        channelId: 'ch1',
        model: 'm1',
        thumbOrder: [`h-${id}`],
        upstreamHidden: [],
        ...over,
      },
    })
    const nodes: NodeSnapshot[] = [
      gen('manual', '客户主图'),
      gen('empty', 'image的输出1', { assetHash: undefined }),
      gen('a', 'image的输出1-01'),
      gen('b', 'image的输出1-02'),
      gen('c', 'image的输出1-03'),
      gen('d', 'image的输出1-04'),
    ]

    const migrated = migrateLegacyGeneratedTitles(nodes)
    expect(migrated.updates).toHaveLength(5)
    expect(migrated.nodes.map((node) => node.title)).toEqual([
      '客户主图',
      '狗狗体型缩小50%',
      '狗狗体型缩小50%-01',
      '狗狗体型缩小50%-02',
      '狗狗体型缩小50%-03',
      '狗狗体型缩小50%-04',
    ])
    expect(migrateLegacyGeneratedTitles(migrated.nodes).updates).toHaveLength(0)
  })
})
