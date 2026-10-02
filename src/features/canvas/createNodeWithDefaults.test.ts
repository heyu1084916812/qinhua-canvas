import { describe, it, expect } from 'vitest'
import { resolveDefaults } from './createNodeWithDefaults'
import { createChannelStore } from '../../state/channel/channelStore'
import { createMemoryPlatform } from '../../platform/memory'
import { registerAllSpecs } from '../../domain/canvas/nodeSpecs'

/**
 * 注册表必须显式初始化。
 *
 * `getSpec()` 在没注册时返回 null，`newGeneratingNodeData` 拿不到 spec 默认数据、
 * 只会返回 channelId / model ⇒ 生成节点会**丢掉 mode 等基础字段**。
 * 真机由应用启动时注册，单测环境得自己来（这一步漏了会得到「以为测了、其实是空跑」）。
 */
registerAllSpecs()

/**
 * 「新建节点带默认配方」的类型边界（用户 2026-09-23 实测踩到）。
 *
 * `node.create` 的 data 是**整体替换** `spec.createDefaultData()`，不是合并。
 * 曾经无条件给所有类型注入 `{channelId, model}`，会把气泡节点自己的默认结构挤掉。
 *
 * 这一组钉住「只有需要配方的类型才注入」。
 */

async function store() {
  const platform = createMemoryPlatform({
    rows: {
      channels: [
        {
          id: 'ch-1',
          name: '中转站',
          protocol: 'openai-images',
          baseUrl: 'https://relay.example.com',
          credentialRef: null,
          enabled: true,
          models: [
            { id: 'img-1', category: 'image', inputTypes: ['text'], maxCount: 4 },
            { id: 'chat-1', category: 'chat', inputTypes: ['text'], maxCount: 1 },
          ],
          modelCache: [],
          createdAt: 1,
        },
      ],
    },
  } as never)
  const s = createChannelStore(platform)
  await s.load()
  return s
}

describe('resolveDefaults · 只有需要配方的类型才注入默认值', () => {

  it('★ 分组：同样不加（它的默认数据是 items）', async () => {
    const data = await resolveDefaults({ channels: await store(), type: 'group' })
    expect(Object.keys(data)).toEqual([])
  })

  it('生成节点：带上渠道、模型与生成参数', async () => {
    const data = await resolveDefaults({ channels: await store(), type: 'generation' })
    expect(data.channelId).toBe('ch-1')
    expect(data.model).toBe('img-1')
    // newGeneratingNodeData 必须基于 spec 默认值叠加，否则会丢掉 mode
    expect(data.mode).toBe('image')
  })

  it('提示词节点：带上渠道与模型（文本类）', async () => {
    const data = await resolveDefaults({ channels: await store(), type: 'prompt' })
    expect(data.channelId).toBe('ch-1')
    /**
     * 提示词节点要的是**文本模型**，不是图片模型（传错类别会让它拿到生图模型）。
     *
     * 默认值取固定清单里的对话名，不是渠道里排第一的文本模型 —— 后者实测是
     * `advanced-voice`，用户明确说「目前需要一个默认的显示，不是 advanced-voice」。
     *
     * 2026-10-01 起清单里多了 Agnes 自己的显示名并排在最前（用户当前平台）；
     * 2026-10-03 用户要求把对话档换成两个免费 Flash，故默认值变成清单第一项
     * `Agnes 2.0 Flash`。**渠道真有的那个优先**（见 generationPreset 的 pickModel），
     * 本 fixture 的 `chat-1` 不在清单别名里，所以回落到清单第一项。
     */
    expect(data.model).toBe('Agnes 2.0 Flash')
  })

  it('extraData 与默认值合并（提示词节点的 text 不会丢）', async () => {
    const data = await resolveDefaults({
      channels: await store(),
      type: 'prompt',
      extraData: { text: '', upstreamPromptLinked: false },
    })
    expect(data).toMatchObject({ text: '', upstreamPromptLinked: false })
  })
})
