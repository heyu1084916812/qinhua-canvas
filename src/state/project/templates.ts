import type { Command } from '../commands'
import type { CommandResult } from '../shared/types'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeType, NodeData } from '../../domain/canvas/model/node'
import { getSpec } from '../../domain/canvas/nodeSpecs'
import { createId } from '../../shared/id'

/**
 * 模板库（产品文档 §5.4）。
 *
 * 五个模板只预置「节点起始结构」，不预生成任何内容。预置**必须走命令层
 * dispatch**（架构 §4.3：图数据唯一入口），不许直接往 IndexedDB 塞行。
 *
 * 约束：
 * - 预置结构用到的节点类型必须在 `registerAllSpecs()` 里注册过（compare / batch
 *   已随 M3 落地，不再是「待实现」），未注册类型会被 `seedTemplate` 静默跳过。
 * - 为支持「图生视频」（图片生成 → 视频生成），generation 的 accepts.upstream 已扩展为
 *   含 'generation'（见 nodeSpecs/generation.ts），不引入新节点类型。
 */

export type TemplateId =
  | 'blank'
  | 'text2img'
  | 'img2img'
  | 'img2video'
  | 'batch-img'
  | 'batch-style'

export interface TemplateMeta {
  id: TemplateId
  name: string
  /** 副标题，说明预置了什么 */
  hint: string
}

export const TEMPLATES: readonly TemplateMeta[] = [
  { id: 'blank', name: '空白项目', hint: '从零开始' },
  { id: 'text2img', name: '文生图', hint: '提示词 → 图片生成' },
  { id: 'img2img', name: '图生图', hint: '图片 → 图片生成（带上参考图）' },
  { id: 'img2video', name: '图生视频', hint: '图片 → 视频生成' },
  { id: 'batch-img', name: '批量出图', hint: '提示词 → 图片生成 ×4 → 对比' },
  { id: 'batch-style', name: '批量套图', hint: '批量容器 + 素材 → 生成' },
]

/** 接收模板预置的最小目标接口：结构化满足 CanvasStore，避免 state→workbenches 反向依赖 */
export interface TemplateTarget {
  dispatch(cmd: Command): CommandResult
  beginPlan(planId: string, label: string): void
  endPlan(): void
  getSnapshot(): GraphSnapshot
}

interface NodeBlueprint {
  type: NodeType
  x: number
  y: number
  title: string
  /** 覆盖在 spec.createDefaultData() 之上的字段 */
  data?: Partial<NodeData>
}

interface EdgeBlueprint {
  /** 在 nodes 数组中的下标 */
  from: number
  to: number
}

interface TemplateBlueprint {
  nodes: NodeBlueprint[]
  edges: EdgeBlueprint[]
}

const BLUEPRINTS: Record<TemplateId, TemplateBlueprint> = {
  blank: { nodes: [], edges: [] },

  text2img: {
    nodes: [
      { type: 'prompt', x: 0, y: 0, title: '提示词' },
      { type: 'generation', x: 320, y: 0, title: '图片生成', data: { mode: 'image' } },
    ],
    edges: [{ from: 0, to: 1 }],
  },

  // M6-12：上游先出图，下游把它的产物当参考图上传（走 /v1/images/edits）。
  // 两个节点都是 image 模式——图生图与图生视频的唯一差别就是下游的 mode。
  img2img: {
    nodes: [
      { type: 'generation', x: 0, y: 0, title: '底图', data: { mode: 'image' } },
      { type: 'generation', x: 320, y: 0, title: '图生图', data: { mode: 'image' } },
    ],
    edges: [{ from: 0, to: 1 }],
  },

  img2video: {
    nodes: [
      { type: 'generation', x: 0, y: 0, title: '图片', data: { mode: 'image' } },
      { type: 'generation', x: 320, y: 0, title: '视频生成', data: { mode: 'video' } },
    ],
    edges: [{ from: 0, to: 1 }],
  },

  // §5.4「批量出图」：末端对比节点吃上游「跑 4 张」的产物（结果组前 2 张，§6.10）。
  // 4 张结果落在结果组内，对比节点靠 `upstreamImagesOf(expandResults)` 取前两张。
  // 对比节点的 x 刻意留在结果组落位的右侧（来源 x=320 + 组宽 ≈ 380 + 间距），
  // 否则预置节点会压在跑完的结果组框上。
  'batch-img': {
    nodes: [
      { type: 'prompt', x: 0, y: 0, title: '提示词' },
      { type: 'generation', x: 320, y: 0, title: '批量出图', data: { mode: 'image', count: 4 } },
      { type: 'compare', x: 1040, y: 0, title: '对比' },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
  },

  // §5.4「批量套图」：批量容器空着等用户拖入素材（外部素材由用户提供，不预造假图），
  // 容器作为上游连到生成节点，跑起来是「每个素材各出一份结果」（§6.12）。
  'batch-style': {
    nodes: [
      { type: 'batch', x: 0, y: 0, title: '素材' },
      { type: 'generation', x: 320, y: 0, title: '生成（套图）', data: { mode: 'image' } },
    ],
    edges: [{ from: 0, to: 1 }],
  },
}

/**
 * 把模板节点结构经命令层写入目标 store。
 * 整段预置被 beginPlan/endPlan 包成一个撤销单元——用户一次「套用模板」只占一步撤销。
 * 空模板（blank）直接返回，不产生任何命令。
 */
export function seedTemplate(target: TemplateTarget, templateId: TemplateId): void {
  const bp = BLUEPRINTS[templateId]
  if (!bp || bp.nodes.length === 0) return

  const projectId = target.getSnapshot().projectId
  target.beginPlan(`template:${templateId}`, `套用模板：${templateId}`)

  const ids: string[] = []
  for (const n of bp.nodes) {
    const spec = getSpec(n.type)
    if (!spec) continue // 防御：未注册类型跳过（registerAllSpecs 漏注册时不至于整段崩）
    const data = { ...spec.createDefaultData(), ...(n.data ?? {}) } as NodeData
    const id = createId('node')
    ids.push(id)
    target.dispatch({
      kind: 'node.create',
      projectId,
      type: n.type,
      at: { x: n.x, y: n.y },
      id,
      title: n.title,
      data,
    })
  }

  for (const e of bp.edges) {
    const source = ids[e.from]
    const targetId = ids[e.to]
    if (!source || !targetId) continue
    target.dispatch({ kind: 'edge.connect', source, target: targetId })
  }

  target.endPlan()
}
