import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ChannelStoreContext } from '../../../app/providers/ChannelStoreProvider'
import { createMemoryPlatform } from '../../../platform/memory'
import { createChannelStore, type ChannelStore } from '../../../state/channel/channelStore'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { CreationPanel, ratiosOf, resolutionsOf } from './CreationPanel'
import type { PanelModel } from './panelModel'

/**
 * 创作面板「无可用平台」引导条（G42 的面板侧）。
 *
 * 面板在平台下拉为空时必须给出**可点击的解释**，而且要区分两种成因——
 * 「一个渠道都没建」和「建了但没启用」。后者最容易被误以为已经配好了：
 * 用户在设置页点过「保存配置」就以为生效，实际还要勾「已启用」才出现在画布。
 *
 * SSR 渲染（项目测试环境为 node，无 testing-library）；渠道 store 由内存表驱动。
 */
const emptyModel: PanelModel = {
  thumbs: [],
  collections: [],
  emptyHint: '连线上游节点，或拖入素材',
  prompt: '',
  linkedPromptCount: 0,
  promptToggle: null,
}

function render(
  channels: ChannelStore,
  data = generationSpec.createDefaultData(),
  /** 生成节点才显示功能类别切换（§6.8），由装配层按节点类型注入 */
  showCategoryToggle = false,
  /** §6.7：提示词节点面板与生成节点共用本组件，但第三部分的规则不同 */
  mode?: 'generation' | 'prompt',
): string {
  return renderToString(
    createElement(
      ChannelStoreContext.Provider,
      { value: channels },
      createElement(CreationPanel, {
        data,
        model: emptyModel,
        running: false,
        globalRunning: false,
        error: null,
        onEvent: () => {},
        onClose: () => {},
        showCategoryToggle,
        mode,
      }),
    ),
  )
}

/** 内存渠道表：[] 表示从没配过；enabled 决定它是否出现在画布 */
async function channelStore(rows: { enabled: boolean; models?: unknown[] }[]): Promise<ChannelStore> {
  const platform = createMemoryPlatform({
    rows: {
      channels: rows.map((r, i) => ({
        id: `ch-${i + 1}`,
        name: `中转站${i + 1}`,
        protocol: 'openai-images',
        baseUrl: 'https://relay.example.com',
        credentialRef: null,
        enabled: r.enabled,
        modelCache: [
          {
            id: 'gpt-image-2',
            category: 'image',
            inputTypes: ['text'],
            aspectRatios: ['1:1'],
            maxCount: 4,
          },
        ],
        // 不给 models 的行走仓库的「老数据回落为全部缓存」路径，与加本字段前的行为一致
        ...(r.models === undefined ? {} : { models: r.models }),
        createdAt: i + 1,
      })),
    },
  })
  const store = createChannelStore(platform)
  await store.load()
  return store
}

describe('CreationPanel · 无可用平台时的引导条', () => {
  it('一个渠道都没有：说明「还没有配置任何渠道」，并给出可点击的出口', async () => {
    const html = render(await channelStore([]))
    expect(html).toContain('data-panel-setup-hint')
    expect(html).toContain('还没有配置任何渠道')
    expect(html).toContain('去后台设置')
  })

  it('渠道存在但未启用：文案切换为「已配置的渠道都未启用」', async () => {
    const html = render(await channelStore([{ enabled: false }]))
    expect(html).toContain('data-panel-setup-hint')
    expect(html).toContain('已配置的渠道都未启用')
    // 未启用的渠道名不该出现在面板上（chips 只列 enabled）
    expect(html).not.toContain('中转站1')
  })

  it('有启用渠道：引导条消失，平台 chip 出现并带出当前渠道名', async () => {
    const channels = await channelStore([{ enabled: true }])
    const html = render(channels, { ...generationSpec.createDefaultData(), channelId: 'ch-1' })
    expect(html).not.toContain('data-panel-setup-hint')
    expect(html).toContain('data-param-chip="channel"')
    expect(html).toContain('中转站1')
  })
})

/**
 * 并发生成（用户报「一个节点生成时其他节点无法生成」）。
 *
 * 面板此前把 `globalRunning` 直接接到生成按钮的 `disabled`：任意一个节点在跑，
 * 其他节点的生成按钮就灰掉。并发槽位已经在执行宿主侧打开，界面必须同步放开，
 * 否则用户看到按钮灰着，会以为功能没有修好。
 */
describe('CreationPanel · 并发生成不再全局禁用按钮', () => {
  it('另一个节点在跑时，本节点生成按钮仍可点', async () => {
    const channels = await channelStore([
      { enabled: true, models: [{ id: 'relay-img', category: 'image', inputTypes: ['text'], maxCount: 4 }] },
    ])
    const html = renderToString(
      createElement(
        ChannelStoreContext.Provider,
        { value: channels },
        createElement(CreationPanel, {
          data: { ...generationSpec.createDefaultData(), channelId: 'ch-1', model: 'relay-img' },
          model: emptyModel,
          running: false,
          globalRunning: true,
          error: null,
          onEvent: () => {},
          onClose: () => {},
          showCategoryToggle: true,
        }),
      ),
    )
    expect(html).not.toContain('全局工作流运行中')
    expect(html).not.toMatch(/aria-label="生成当前节点"[^>]*disabled/)
  })
})

/**
 * 第三种空态（§7.4 之后才存在的）：平台选好了，但该渠道一个模型都没勾选。
 * 「拉取到的模型默认全部未勾选」，所以这是**新配渠道的默认状态**，不是边缘情况；
 * 而渠道没勾模型 → 生成节点取不到 model → 点生成**毫无动静**，
 * 与「没配平台」是同一类坑，必须同样给出可点击的解释。
 */
describe('CreationPanel · 平台已选但没勾模型', () => {
  /** 面板上「平台」已选好（channelId = ch-1），只差模型 */
  const withChannel = () => ({ ...generationSpec.createDefaultData(), channelId: 'ch-1' })

  it('给出「该渠道还没勾选模型」引导条，且不再挂一个点开是空的模型 chip', async () => {
    const channels = await channelStore([{ enabled: true, models: [] }])
    const html = render(channels, withChannel())
    expect(html).toContain('data-panel-setup-hint')
    expect(html).toContain('该渠道还没勾选模型')
    // 「没得选就别挂空壳」：引导条已经解释了原因，再留一个空下拉只是让人白点一次
    expect(html).not.toContain('data-param-chip="model"')
    expect(html).not.toContain('gpt-image-2')
  })

  it('勾选模型后引导消失，模型 chip 带出该模型', async () => {
    const channels = await channelStore([
      { enabled: true, models: [{ id: 'gpt-image-2', category: 'image', inputTypes: ['text'], maxCount: 4 }] },
    ])
    const html = render(channels, { ...withChannel(), model: 'gpt-image-2' })
    expect(html).not.toContain('data-panel-setup-hint')
    expect(html).toContain('data-param-chip="model"')
    expect(html).toContain('gpt-image-2')
  })

  it('没选平台时不说「未选模型」（那是两回事，未选平台要说字段名）', async () => {
    const channels = await channelStore([{ enabled: true, models: [] }])
    const html = render(channels) // channelId 为空
    expect(html).not.toContain('data-panel-setup-hint')
    expect(html).toContain('生图模型')
    expect(html).not.toContain('未选模型')
  })
})

/**
 * 生成数量上限：只在模型**显式声明** `maxCount` 时才生效。
 *
 * 真机探针实测过一个把「固定四项」（§6.8）压成一项的回归：`?? 1` 让「还没选模型」
 * 和「模型没上报 maxCount」（多数中转渠道的 /v1/models 不报此字段）都变成「最多 1 张」，
 * 于是 2张/4张/9张 一进面板就整排置灰，还提示「当前模型最多 1 张」——而当时根本没有当前模型。
 */
describe('CreationPanel · 生成数量上限只在模型声明时生效', () => {
  const imgModel = (maxCount?: number) => ({
    id: 'relay-img',
    category: 'image' as const,
    inputTypes: ['text' as const],
    ...(maxCount === undefined ? {} : { maxCount }),
  })

  it('没选模型：2/4/9 不置灰，也不出现「当前模型最多 N 张」', async () => {
    const channels = await channelStore([{ enabled: true, models: [imgModel(4)] }])
    const html = render(channels, { ...generationSpec.createDefaultData(), channelId: 'ch-1' })
    expect(html).not.toContain('当前模型最多')
  })

  it('模型没上报 maxCount：同样不置灰（未声明 = 不知道上限 = 不设限）', async () => {
    const channels = await channelStore([{ enabled: true, models: [imgModel(undefined)] }])
    const html = render(channels, {
      ...generationSpec.createDefaultData(),
      channelId: 'ch-1',
      model: 'relay-img',
    })
    expect(html).not.toContain('当前模型最多')
  })

  it('模型显式声明 maxCount=4：够不到的 9张 才置灰并说明原因', async () => {
    const channels = await channelStore([{ enabled: true, models: [imgModel(4)] }])
    const html = render(channels, {
      ...generationSpec.createDefaultData(),
      channelId: 'ch-1',
      model: 'relay-img',
    })
    expect(html).toContain('当前模型最多 4 张')
  })
})

/**
 * 功能类别（§6.8）：「图片」与「视频」是**同一个生成节点**的两套参数，
 * 不是两种节点——模板「图生视频」建出来的就是 `{ type: 'generation', data: { mode: 'video' } }`。
 * 面板必须按 `data.mode` 换参数集，否则视频节点上摆着「画质 / 质量 / 数量」，
 * 用户点哪都改不了真正生效的东西（芯片还全都点得动，但没有任何意义）。
 */
/**
 * 比例档位（§6.8）。
 *
 * 此前兜底只有 1:1 / 3:2 / 2:3 三档，而多数中转的 `/v1/models` 不报 `aspectRatios`
 * ——用香蕉这类实际支持到 21:9 的模型时，用户能选到的比例就只有这三档。
 * 抽成 `ratiosOf` 纯函数也正是为了能直接断言「没上报时到底看到几档」
 * （SSR 下浮层是收起的，看渲染结果断言不了这件事）。
 */
describe('CreationPanel · 比例档位（§6.8）', () => {
  const THIRTEEN = [
    '1:1',
    '1:2',
    '2:1',
    '9:16',
    '16:9',
    '3:4',
    '4:3',
    '3:2',
    '2:3',
    '5:4',
    '4:5',
    '21:9',
    '9:21',
  ]

  it('模型没上报比例 → 13 档兜底，含超宽 21:9 / 9:21', () => {
    expect(ratiosOf(undefined)).toEqual(THIRTEEN)
    expect(ratiosOf({ id: 'x', category: 'image', inputTypes: ['text'] })).toEqual(THIRTEEN)
    expect(ratiosOf({ id: 'x', category: 'image', inputTypes: ['text'], aspectRatios: [] })).toEqual(
      THIRTEEN,
    )
  })

  it('★ 模型只上报 1:1 / 16:9（残缺快照）→ 仍给全 13 档，不把网格砍成两格', () => {
    expect(
      ratiosOf({ id: 'x', category: 'image', inputTypes: ['text'], aspectRatios: ['1:1', '16:9'] }),
    ).toEqual(THIRTEEN)
  })
})

/**
 * 提示词节点面板（§6.7 第三部分）。
 *
 * 与 §6.8 的两处**刻意不同**，别按生成节点那套去「统一」：
 * ① 结尾也要有生成按钮（提示词节点自己不发请求，语义是触发下游生成）；
 * ② 没有可用的文本模型时，要的是**禁用 + 直说「暂无可用文本模型」**，
 *    不是把 chip 藏起来换一条引导条——藏起来用户就不知道这个字段还在。
 */
describe('CreationPanel · 提示词节点面板（§6.7）', () => {
  const chatModel = { id: 'gpt-chat', category: 'chat' as const, inputTypes: ['text' as const] }
  const imageOnly = { id: 'gpt-image-2', category: 'image' as const, inputTypes: ['text' as const] }
  const asPrompt = () => generationSpec.createDefaultData()

  it('第三部分以生成按钮收尾（提示词节点 = 触发下游生成）', async () => {
    const html = render(await channelStore([{ enabled: true, models: [chatModel] }]), asPrompt(), false, 'prompt')
    expect(html).toContain('aria-label="生成下游节点"')
  })

  it('渠道里没有文本模型 → 模型 chip 禁用并直说「暂无可用文本模型」', async () => {
    const html = render(
      await channelStore([{ enabled: true, models: [imageOnly] }]),
      { ...asPrompt(), channelId: 'ch-1' },
      false,
      'prompt',
    )
    expect(html).toContain('data-param-chip="model"')
    expect(html).toContain('暂无可用文本模型')
    expect(/data-param-chip="model"[^>]*?disabled=/.test(html)).toBe(true)
    // §6.7 要的是禁用 + 说明，不是 §6.8 那套「隐藏 chip + 引导条」
    expect(html).not.toContain('该渠道还没勾选')
  })

  it('有文本模型时正常可点（不再显示那句占位）', async () => {
    const html = render(
      await channelStore([{ enabled: true, models: [chatModel] }]),
      { ...asPrompt(), channelId: 'ch-1', model: 'gpt-chat' },
      false,
      'prompt',
    )
    expect(html).toContain('gpt-chat')
    expect(html).not.toContain('暂无可用文本模型')
  })
})

/**
 * 画质「自动」档（§6.8）。
 *
 * 此前 `resolution` 只有 1K/2K/4K，未设置时 chip 只能拿字段名「画质」当占位，
 * 用户分不清那是档位名还是「没选」。补上「自动」后与「质量」chip 同一口径：
 * 未设置即显示「自动」，语义是「不指定、交给模型」。
 */
describe('CreationPanel · 画质「自动」档（§6.8）', () => {
  const imgModel = { id: 'relay-img', category: 'image' as const, inputTypes: ['text' as const], maxCount: 4 }
  const withModel = () => channelStore([{ enabled: true, models: [imgModel] }])

  it('未设置 → chip 显示「自动」，不再拿字段名当占位', async () => {
    const html = render(
      await withModel(),
      { ...generationSpec.createDefaultData(), channelId: 'ch-1', model: 'relay-img' },
      true,
    )
    expect(html).toContain('data-param-chip="resolution"')
    expect(html).toContain('自动')
    expect(html).not.toContain('>画质<')
  })

  it('选了 2K → 显示 2K', async () => {
    const html = render(
      await withModel(),
      {
        ...generationSpec.createDefaultData(),
        channelId: 'ch-1',
        model: 'relay-img',
        resolution: '2k',
      },
      true,
    )
    expect(html).toContain('2K')
  })

  it('★ 模型只报 1k/2k（残缺快照）→ 4K 仍出现在列表里，不被隐藏', () => {
    // 用户 2026-09-16 报「image-2 没有 4K」的根因：旧实现拿模型上报当白名单，
    // 只报 1k/2k 时 4K 被直接过滤掉，面板上永远看不到。
    expect(resolutionsOf({ ...imgModel, resolutions: ['1k', '2k'] })).toEqual(['auto', '1k', '2k', '4k'])
    expect(resolutionsOf(undefined)).toEqual(['auto', '1k', '2k', '4k'])
    expect(resolutionsOf({ ...imgModel, resolutions: [] })).toEqual(['auto', '1k', '2k', '4k'])
  })
})

/**
 * 提示词节点「反推」（§6.7）：输入是**上游图片**而不是文本，
 * 因此按钮的禁用条件与「优化 / 翻译」相反——有图就能点，没图点了也是空跑。
 */
describe('CreationPanel · 提示词节点「反推」（§6.7）', () => {
  const chatModel = { id: 'gpt-chat', category: 'chat' as const, inputTypes: ['text' as const] }
  const asPrompt = () => generationSpec.createDefaultData()

  const renderWithImages = async (imageCount: number | undefined) => {
    const html = renderToString(
      createElement(
        ChannelStoreContext.Provider,
        { value: await channelStore([{ enabled: true, models: [chatModel] }]) },
        createElement(CreationPanel, {
          data: { ...asPrompt(), channelId: 'ch-1', model: 'gpt-chat' },
          model: emptyModel,
          running: false,
          globalRunning: false,
          error: null,
          onEvent: () => {},
          onClose: () => {},
          mode: 'prompt',
          promptImageCount: imageCount,
          promptTools: { status: 'idle' as const, error: null, run: () => {} },
        }),
      ),
    )
    return html
  }

  it('没有上游图片 → 反推禁用，title 直说要先连图', async () => {
    const html = await renderWithImages(0)
    expect(html).toContain('data-panel-prompt-tool="describe"')
    expect(html).toMatch(/data-panel-prompt-tool="describe"[^>]*disabled=/)
    expect(html).toContain('反推需要上游图片')
  })

  it('有上游图片 → 反推可点，title 说清会覆盖当前文本', async () => {
    const html = await renderWithImages(2)
    expect(html).toContain('data-panel-prompt-tool="describe"')
    expect(html).not.toMatch(/data-panel-prompt-tool="describe"[^>]*disabled=/)
    expect(html).toContain('反推出绘画提示词')
  })
})

describe('CreationPanel · 功能类别切换（图片 / 视频）', () => {
  const imgModel = { id: 'relay-img', category: 'image' as const, inputTypes: ['text' as const], maxCount: 4 }
  const videoModel = {
    id: 'relay-video',
    category: 'video' as const,
    inputTypes: ['text' as const],
    aspectRatios: ['16:9', '9:16'],
    durations: [3, 15] as [number, number],
    maxReferenceImages: 2,
  }
  const withBoth = () => channelStore([{ enabled: true, models: [imgModel, videoModel] }])

  it('图片模式：参数是 画质 / 质量 / 数量，没有视频参数', async () => {
    const html = render(
      await withBoth(),
      { ...generationSpec.createDefaultData(), channelId: 'ch-1', model: 'relay-img' },
      true,
    )
    expect(html).toContain('data-param-mode="image"')
    expect(html).toContain('data-param-mode="video"')
    expect(html).toContain('data-param-chip="resolution"')
    expect(html).toContain('data-param-chip="quality"')
    expect(html).toContain('张')
    expect(html).not.toContain('data-param-chip="size"')
    expect(html).not.toContain('data-param-duration')
  })

  it('视频模式：换成 尺寸 / 时长 / 参考模式，画质 / 质量 / 数量整块退场', async () => {
    const html = render(
      await withBoth(),
      { ...generationSpec.createDefaultData(), channelId: 'ch-1', model: 'relay-video', mode: 'video' },
      true,
    )
    expect(html).toContain('data-param-chip="size"')
    expect(html).toContain('data-param-duration')
    expect(html).toContain('data-param-duration-range')
    expect(html).toContain('data-param-chip="refMode"')
    expect(html).not.toContain('data-param-chip="resolution"')
    expect(html).not.toContain('data-param-chip="quality"')
    expect(html).not.toContain('张')
  })

  it('视频模式只列视频类模型：占位文案也说清是「视频模型」', async () => {
    const html = render(
      await withBoth(),
      { ...generationSpec.createDefaultData(), channelId: 'ch-1', mode: 'video' },
      true,
    )
    expect(html).toContain('视频模型')
    expect(html).not.toContain('relay-img')
  })

  it('分组 / 批量共用本面板，但不给功能类别切换', async () => {
    const html = render(await withBoth(), { ...generationSpec.createDefaultData(), channelId: 'ch-1' })
    expect(html).not.toContain('data-param-mode')
  })
})
