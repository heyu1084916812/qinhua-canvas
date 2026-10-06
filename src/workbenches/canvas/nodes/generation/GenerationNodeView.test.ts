import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createCanvasStore } from '../../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../../storeContext'
import { PlatformProvider } from '../../../../app/providers/PlatformProvider'
import { AssetSwapIcon, GenerationNodeView, assetIsVideo } from './GenerationNodeView'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { NodeViewProps } from '../registry'
import type { NodeSnapshot } from '../../../../domain/canvas/model/node'

/**
 * 生成节点**本体**（产品文档 §6.8「状态 A / 状态 B」）。
 *
 * 本组把本体从「参数芯片 + 提示词 + 生成按钮」减重为**媒体框**，
 * 所以这里的断言重点有两类：
 * ① 该有的（占位框 + `+` / 素材 / 居中状态）；
 * ② **不该有的**——参数下拉、提示词框、生成按钮一律不得再出现在本体里
 *    （它们属于下方创作参数面板，留着就是两套 UI）。
 *
 * 用 SSR（renderToString）验证结构，不依赖 DOM（项目测试环境为 node，无 testing-library）。
 * 交互（点击 `+` 触发上传、双击开灯箱）由冒烟在真浏览器里验证。
 */
function genNode(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    id: 'n-gen',
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 240,
    title: '生成',
    disabled: false,
      data: generationSpec.createDefaultData(),
    ...overrides,
  }
}

function render(props: NodeViewProps): string {
  const canvasStore = createCanvasStore({
    platform: createMemoryPlatform(),
    projectId: 'p1',
    debounceMs: 0,
  })
  return renderToString(
    createElement(
      PlatformProvider,
      { runtime: 'memory' as const },
      createElement(CanvasStoreProvider, {
        store: canvasStore,
        children: createElement(GenerationNodeView, props),
      }),
    ),
  )
}

function baseProps(overrides: Partial<NodeViewProps> = {}): NodeViewProps {
  return {
    node: genNode(),
    size: { w: 240, h: 208 },
    scale: 1,
    selected: false,
    running: false,
      runMode: 'idle',
    error: null,
    emit: () => {},
    ...overrides,
  }
}

beforeEach(() => {
  registerAllSpecs()
})

describe('GenerationNodeView · 状态 A（空态）', () => {
  /**
   * 上传入口从 `＋` 图标改为**文字按钮「上传素材」**（用户 2026-09-19）：
   * 纯符号要用户猜含义，文字把「点这里会发生什么」直接说清。
   * 断言跟着改成断言文案，而不是断言某个字形——字形还会再变，文案是稳定契约。
   */
  it('渲染占位框与「上传素材」文字按钮', () => {
    const html = render(baseProps())
    expect(html).toContain('data-generation-media')
    expect(html).toContain('data-node-upload')
    expect(html).toContain('上传素材')
  })

  it('空态不渲染素材骨架（骨架只在「已有内容」时出现）', () => {
    expect(render(baseProps())).not.toContain('data-node-asset-loading')
  })
})

describe('GenerationNodeView · 状态 B（有内容）', () => {
  /**
   * 用户 2026-10-03：「刚刚生成的视频，只有双击进来（灯箱）才能看」。
   *
   * 灯箱按 `assets` 行的 mime 渲染所以是对的；节点此前只认 `data.mode`，
   * 两者对不上时就会拿 `<img>` 去显示 mp4 —— 页面上是一块空白。
   */
  it('★★ 素材类型以 mime 为准：mp4 素材即使节点 mode 还是 image 也算视频', () => {
    expect(assetIsVideo('video/mp4', 'image')).toBe(true)
    expect(assetIsVideo('image/png', 'video')).toBe(false)
  })

  it('拿不到 mime 时才退回节点自己的 mode', () => {
    expect(assetIsVideo(null, 'video')).toBe(true)
    expect(assetIsVideo(null, 'image')).toBe(false)
  })

  it('已有 assetHash 时不再显示 `+` 上传入口', () => {
    const node = genNode({ data: { ...generationSpec.createDefaultData(), assetHash: 'h1' } })
    const html = render(baseProps({ node }))
    expect(html).not.toContain('data-node-upload')
  })

  it('素材本体尚未读回时显示中立骨架，而不是退回上传入口', () => {
    // SSR 不跑 effect ⇒ useAsset 拿不到 objectURL，正对应「hash 已有、字节还在路上」
    const node = genNode({ data: { ...generationSpec.createDefaultData(), assetHash: 'h1' } })
    expect(render(baseProps({ node }))).toContain('data-node-asset-loading')
  })
})

describe('GenerationNodeView · 本体不含参数（§6.8：参数归创作面板）', () => {
  it('不渲染任何参数下拉', () => {
    expect(render(baseProps())).not.toContain('<select')
  })

  it('不渲染提示词输入框', () => {
    expect(render(baseProps())).not.toContain('<textarea')
  })

  it('不渲染生成按钮（含其三种 aria-label）', () => {
    const html = render(baseProps())
    expect(html).not.toContain('生成当前节点')
    expect(html).not.toContain('取消当前生成')
    expect(html).not.toContain('全局工作流运行中')
  })
})

describe('GenerationNodeView · 状态居中（§6.8「在节点中心显示」）', () => {
  it('本节点运行中：居中转圈', () => {
    const html = render(baseProps({ running: true }))
    expect(html).toContain('data-node-status="running"')
  })

  it('★ 全局运行中（本节点未参与）：**不长**任何状态覆盖层', () => {
    // 用户实测报「生成某个节点时，其他没让它生成的节点也在转圈」。
    // 「全局运行中」是**生成按钮**的状态（§6.8 按钮变 LoaderCircle 并禁用），
    // 不属于节点本体——本体只表达自己的 running / error（§6.19.5）。
    const html = render(baseProps({ running: false, globalRunning: true }))
    expect(html).not.toContain('data-node-status=')
    expect(html).not.toContain('全局工作流运行中')
  })

  it('全局运行中 + 本节点也在跑：仍显示自己的「生成中」', () => {
    const html = render(baseProps({ running: true, globalRunning: true }))
    expect(html).toContain('data-node-status="running"')
    expect(html).not.toContain('data-node-status="busy"')
  })

  it('失败：居中显示报错原因，且不再转圈', () => {
    const html = render(baseProps({ error: '网络错误' }))
    expect(html).toContain('data-node-status="error"')
    expect(html).toContain('网络错误')
    expect(html).not.toContain('data-node-status="running"')
  })

  it('空闲：无状态覆盖层', () => {
    expect(render(baseProps())).not.toContain('data-node-status=')
  })
})

/**
 * 素材操作（清除 / 替换）那颗按钮的图标（用户 2026-10-06 给了参考图）。
 *
 * 上一版是"两条细的描边箭头"（strokeWidth 1.6、14px），用户看图后要求换成
 * **实心圆底 + 两条粗白箭头**并"画一个一模一样的矢量图，不要符号"。
 *
 * 这里钉的是**形状契约**（尺寸 / 部件数 / 颜色来源），不是像素级外观。
 *
 * ⚠️ 直接渲染 `AssetSwapIcon`，而不是渲染整个节点再去里面找：节点里的这一段要等
 * `useAssetThumb` 在 effect 里把 URL 解析出来才挂载，而单测跑 SSR（effect 不执行），
 * 断言**永远拿不到目标**（第一版就这么红过）。"节点真的用了它"由冒烟在真浏览器里钉。
 */
describe('GenerationNodeView · 素材操作图标（矢量复刻）', () => {
  const icon = renderToString(createElement(AssetSwapIcon))

  it('★★ 实心双箭头：两根圆角轴 + 两个实心头（不是细描边符号）', () => {
    // 轴：4 个填充部件里正好两根矩形
    expect((icon.match(/<rect/g) ?? []).length).toBe(2)
    // 全部颜色都走 currentColor（两套主题自动反转），一个硬编码颜色都不许有
    expect((icon.match(/fill="currentColor"/g) ?? []).length).toBe(4)
    expect(icon).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // 头是实心三角（闭合路径）+ 同色描边磨圆角
    expect((icon.match(/stroke-linejoin="round"/g) ?? []).length).toBe(2)
  })

  it('★ 图标尺寸 = 按钮直径 26px（按 14px 画会缩成一小撮，箭头看不出来）', () => {
    expect(icon).toContain('width="26"')
    expect(icon).toContain('height="26"')
  })

  it('★ 两条箭头上下镜像、居中：上箭头朝左、下箭头朝右', () => {
    // 上箭头尖端 x=2.8（靠左）、下箭头尖端 x=13.2（靠右）：关于中线 8 左右对称
    expect(icon).toContain('M2.8 5.6 7.4 3.9v3.4z')
    expect(icon).toContain('M13.2 10.4 8.6 8.7v3.4z')
    // 上下也对称（中线 8）：两条轴心的 y 之和必须是 16 —— 第一版只相距 4.2，
    // 两侧圆角一磨两条箭头就粘成一块（放大对照图里肉眼可见），这条正是钉它
    const shafts = [...icon.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
    expect(shafts).toHaveLength(2)
    const centers = shafts.map((m) => Number(m[1]) + Number(m[2]) / 2)
    expect(centers[0] + centers[1]).toBeCloseTo(16, 5)
    expect(centers[1] - centers[0]).toBeGreaterThanOrEqual(4.5)
  })
})
