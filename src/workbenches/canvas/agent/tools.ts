import {
  AGENT_NODE_TYPES,
  alignGenerationMode,
  normalizeAgentPlan,
  validateAgentPlan,
  type AgentNodeType,
  type AgentPlan,
} from '../../../domain/agent/plan'
import type { ToolDeclaration } from '../../../domain/shared/execution/types'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { downstreamOf } from '../../../domain/canvas/graph/upstreamOf'
import { canBuildRequest } from '../../../features/canvas/execution/buildRunPlan'
import { applyAgentPlan } from './applyAgentPlan'
import type { AgentRunOutcome } from './runOutcome'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { createId } from '../../../shared/id'
import {
  avoidRectOverlap,
  isTopLevelNode,
  nodeMinSize,
  placeNodeWithoutOverlap,
  snapshotRects,
} from './agentGeometry'
import { lockedResize } from '../../../domain/canvas/nodeSpecs/resizeLock'
import {
  memoryCandidateProblems,
  normalizeMemoryCandidate,
  type MemoryCandidate,
} from '../../../domain/shared/memoryOrganizer'
import type { VisualReviewResult } from '../../../domain/agent/visualReview'

/**
 * Agent 的工具集（设计文档 §5 / §5.1）。
 *
 * 两条硬规矩：
 * ① **每个工具都映射到既有命令**，不新开旁路 —— 这样撤销、日志、指纹全都照常；
 * ② **读与写分开**：读类由循环直接调，写 / 花钱类由界面确认后才调（§9）。
 *    两者分别导出两个执行器，从类型上就不给「循环里偷偷写」的机会。
 */

/** 给模型看的工具声明。参数 schema 与设计文档 §5.1 一一对应 */
export const AGENT_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'readGraph',
    description: '看当前画布上有什么节点、怎么连的、哪些已经出过图。问「现在有什么」时用它。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all', 'selection'], description: '看全图还是只看选中' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'readAsset',
    description: '看指定节点的素材信息（类型、像素），用来判断能不能当参考图。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'applyPlan',
    description:
      '把一份工作流建到画布上：给出要建的节点与连线，一次性落地。' +
      '**这一步立刻生效、不会问用户**（建节点不花钱，用户马上能在画布上看到）；' +
      '随后要不要真的出图，系统会再问用户一次。' +
      '要用画布上已有的节点（例如用户先放好的素材图）当上游，就把那个节点写进 attach。',
    /**
     * ⚠️ **字段名必须写在 schema 里，不能只靠校验器事后拦。**
     *
     * 真机事故（用户 2026-10-06 截图）：`nodes` / `edges` / `attach` 原来都声明成
     * 光秃秃的 `{ type: 'object' }`，系统提示词里也只有「用 attach 指过去」这种白话，
     * **`localId` / `existingNodeId` 这两个真正的键名一次都没出现过**。于是模型只能猜：
     * 猜错就得到「第 1 条 attach 的 localId 不在计划里：undefined」，猜不出来就自己编
     * 一个 `cat_ref_1`，或者把画布节点 id 直接当连线起点 ⇒ 连试六轮都建不成。
     *
     * 当时的取舍是「形状靠校验器拦」（设计文档 §5.1 原话），但**校验器只会事后报错**，
     * 模型事前不知道键名，报错就只能靠反复试。节点 `data` 里那几十个字段确实不适合塞进
     * schema（会巨大且频繁漂移，那部分继续靠词表 + 校验器），但**计划自身的骨架只有几个键，
     * 必须在这里说死** —— 这是模型唯一能提前看到结构化契约的地方。
     */
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '一句话说明这份计划在做什么' },
        nodes: {
          type: 'array',
          description: '要**新建**的节点。',
          items: {
            type: 'object',
            properties: {
              localId: {
                type: 'string',
                description: '计划内部的临时 id（自己起，计划里唯一）。连线与 attach 都引用它，落地时换成真实节点 id。',
              },
              type: { type: 'string', enum: [...AGENT_NODE_TYPES] },
              title: { type: 'string', description: '节点标题（给人看的短名）' },
              data: {
                type: 'object',
                description:
                  '节点正文与参数，**必须用画布的键名**：提示词节点写 data.text，' +
                  '生成 / 批量 / 分组节点写 data.prompt；比例 data.ratio、清晰度 data.resolution、' +
                  '画质 data.quality、张数 data.count。写错不会报错，但那个框是空的、也跑不出图。',
              },
              order: { type: 'integer', description: '第几步，从 0 起（坐标不用给，系统自己排）' },
            },
            required: ['localId', 'type', 'data', 'order'],
          },
        },
        edges: {
          type: 'array',
          description: '连线。两端都填**节点在计划里的 localId**（不是画布上的真实 id）。',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '起点的 localId' },
              target: { type: 'string', description: '终点的 localId' },
              sourcePort: { type: 'string', description: '多口节点的输出口名；单口节点不用填' },
              targetPort: { type: 'string', description: '多口节点的输入口名；单口节点不用填' },
            },
            required: ['source', 'target'],
          },
        },
        attach: {
          type: 'array',
          description:
            '把计划里的某个节点**接到画布上已有的节点**（复用用户先放好的素材图，不重复建）。' +
            '写法：localId = 计划里那个节点的临时 id；existingNodeId = 画布上那个节点的真实 id' +
            '（就是画布摘要里 `- node_xxx｜...` 那一串）。',
          items: {
            type: 'object',
            properties: {
              localId: { type: 'string', description: '计划里那个节点的 localId' },
              existingNodeId: { type: 'string', description: '画布上已有的节点 id' },
            },
            required: ['localId', 'existingNodeId'],
          },
        },
      },
      required: ['summary', 'nodes', 'edges'],
    },
  },
  {
    name: 'updateNode',
    description:
      '改某个节点的**生成参数**（比例 / 张数 / 模型 / 时长），会先让用户确认。' +
      '**不要用它改画面内容（提示词）**：出过图的节点，正文就是上一版的记录，' +
      '覆盖掉用户就再也看不到上次写了什么。' +
      '要改画面就新建一个生成节点、用 attach 把旧图接成它的上游，把新提示词写在新节点上。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '只改一个节点时用' },
        /**
         * 批量改（用户 2026-10-06 第七批 #187）：说「都改」时**一次改完**，
         * 用户只确认一次。一次一个节点地改 = 让他确认八次。
         */
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            '一次改多个节点（用户说「都改 / 全部 / 这几张都改」时**必须**用这个）。' +
            '同一个 data 会应用到每一个节点上，用户只需要确认一次。',
        },
        data: { type: 'object' },
      },
      required: ['data'],
    },
  },
  {
    name: 'runNode',
    description:
      '跑指定的节点（会花钱，先让用户确认）。nodeIds 必须是画布上的真实 id：' +
      'applyPlan 返回的 resolvedNodes[].nodeId，或 readGraph 摘要里的 node_xxx；' +
      '绝不能填计划里的 localId 或节点标题。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'runFrom',
    description:
      '从指定节点开始，按连线顺序跑完整条下游链（会花钱，先让用户确认）。' +
      '用于「把这套流程继续跑下去」；只跑可真正发请求的生成 / 融合节点，' +
      '提示词节点只作为中间输入；批量 / 循环这类分发器请直接对它们调用 runNode。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '下游链的起点节点 id；可以给多个，系统按连线拓扑执行。',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'readResult',
    description: '看指定节点跑出来的产物（有没有图、哪个 hash）或失败原因。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'visualReview',
    description:
      '只读视觉验收。把目标图片和项目当前绑定的品牌 / 产品 / 角色 / 自定义套件素材一起交给视觉子代理，' +
      '检查标志、产品结构、角色身份、文字、排版、画质与整套一致性，返回可执行的 issue 清单。' +
      '该工具不会写画布、不会删除节点、不会自动重新生成或重跑付费请求。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要验收的真实画布节点 id，必须已有图片产物。',
        },
        checklist: {
          type: 'string',
          description: '用户这次点名的验收项；没点名就省略，使用项目套件与默认视觉规范。',
        },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'rememberMemory',
    description:
      '把用户明确要求长期记住的偏好、事实、硬约束或已确认决定整理成一条候选记忆。' +
      '只在用户说“记住 / 以后 / 每次 / 长期”或明确确认项目规则时使用；' +
      '一次性要求不要保存。系统会先把整理结果给用户确认，批准后才写入。' +
      '禁止保存密钥、令牌、密码、Cookie 或整段隐私数据。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '精炼后的单条记忆，最多 800 字' },
        kind: {
          type: 'string',
          enum: ['preference', 'fact', 'constraint', 'decision'],
        },
        scope: {
          type: 'string',
          enum: ['global', 'workbench', 'project', 'session'],
          description:
            '稳定个人偏好用 global；当前工作台用 workbench；本项目用 project；仅当前会话用 session。',
        },
        key: {
          type: 'string',
          description:
            '可选稳定主题键，例如 brand.primaryColor / brand.font / project.size；用于冲突检测。',
        },
        expiresInDays: {
          type: 'integer',
          minimum: 1,
          maximum: 3650,
          description: '可选有效天数；不确定就省略，表示长期有效。',
        },
      },
      required: ['text', 'kind', 'scope'],
    },
  },
  {
    name: 'moveNodes',
    description:
      '移动节点。可用 positions 给每个节点精确的左上角坐标，或 dx/dy 给一组节点相同位移。' +
      '坐标使用 readGraph 返回的 x / y；分组子节点使用组内坐标。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        positions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['nodeId', 'x', 'y'],
          },
        },
        dx: { type: 'number' },
        dy: { type: 'number' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'resizeNodes',
    description:
      '调整图片 / 节点的画布尺寸。可用 width / height 指定同宽同高，scale 指定等比缩放；' +
      '尺寸会保持各自原始宽高比、不拉伸图片。useMax:true 时同宽取最大宽、同高取最大高；' +
      '否则取最小值（避免自动把图放得过大）。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        width: { type: 'number', description: '统一宽度（画布单位），与 scale 二选一；不给数值则按 useMax 取当前最大/最小宽。' },
        height: { type: 'number', description: '统一高度（画布单位），与 scale 二选一；不给数值则按 useMax 取当前最大/最小高。' },
        scale: { type: 'number', description: '相对当前尺寸的等比缩放倍数，如 0.5 / 2。' },
        useMax: { type: 'boolean', description: '统一尺寸时取最大值而不是最小值。' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'deleteNodes',
    description: '删除指定节点。会级联删除关联连线；会先在确认卡中列出节点名，不删除素材库文件。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'arrangeNodes',
    description:
      '把一组同层节点排列成水平、垂直或网格；保持原选区左上角，按给定 gap 排布。' +
      '确定要自动整理画布时使用。',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        layout: { type: 'string', enum: ['horizontal', 'vertical', 'grid'] },
        gap: { type: 'number', description: '节点间距，默认 32。' },
        columns: { type: 'number', description: 'grid 模式的列数；不填按平方根估算。' },
      },
      required: ['nodeIds', 'layout'],
    },
  },
  {
    name: 'deleteEdges',
    description:
      '取消连线。优先传 readGraph 返回的 edgeIds；也可用 source/target 对精确指定。' +
      '删除连线不会删除节点。此操作会先让用户确认。',
    parameters: {
      type: 'object',
      properties: {
        edgeIds: { type: 'array', items: { type: 'string' } },
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
            },
            required: ['source', 'target'],
          },
        },
      },
    },
  },
  {
    name: 'compareNodes',
    description:
      '把两个有图的节点直接做成 A/B 对比节点：自动在右侧建对比节点并连接两张图。',
    parameters: {
      type: 'object',
      properties: {
        leftNodeId: { type: 'string' },
        rightNodeId: { type: 'string' },
      },
      required: ['leftNodeId', 'rightNodeId'],
    },
  },
  {
    name: 'sliceImage',
    description:
      '对图片节点提取选区或裁剪。rect 使用原图像素坐标 {x,y,w,h}；' +
      '不传 rect 时为该节点打开灯箱框选，用户画完框后由现有裁剪流程生成新节点。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        mode: { type: 'string', enum: ['extract', 'crop'] },
        rect: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
          },
          required: ['x', 'y', 'w', 'h'],
        },
        ratio: { type: 'string' },
      },
      required: ['nodeId', 'mode'],
    },
  },
  {
    name: 'splitGrid',
    description:
      '把图片节点按 rows × cols 宫格切分，并在右侧铺开生成每个切片节点。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        rows: { type: 'number' },
        cols: { type: 'number' },
      },
      required: ['nodeId', 'rows', 'cols'],
    },
  },
]

/** 画布现状摘要 —— 结构与设计文档 §4.2 的回填格式一致 */
export interface GraphSummary {
  /**
   * 兼容旧测试 / 旧会话里只含 nodes + edges 的摘要。`readGraph` 的运行时结果
   * 始终会带这些空间字段；这里保持可选，避免读旧历史时整段摘要失效。
   */
  bounds?: { x: number; y: number; w: number; h: number }
  nodes: {
    id: string
    type: string
    title: string
    hasOutput: boolean
    x?: number
    y?: number
    w?: number
    h?: number
    center?: { x: number; y: number }
    parentId?: string
    parentTitle?: string
    /** 在整张画布九个区域中的位置，例如「左上」「中部」「右下」。 */
    zone?: string
    /** 最近 4 个节点；distance 为矩形中心之间的欧氏距离。 */
    nearby?: {
      nodeId: string
      title: string
      direction: string
      distance: number
    }[]
    upstream?: string[]
    downstream?: string[]
    /**
     * 节点上的**正文**（生成 / 批量 / 分组是 `data.prompt`，提示词节点是 `data.text`），
     * 最多 160 字。
     *
     * 用户 2026-10-05 第六批：「我让他换成 3d 风格，但是他前面给我加了前置词小猫钓鱼，
     * 结果把内容也给我换成小猫去了，本来应该是只换成 3d 风格的」—— 根因就是**摘要里没有正文**：
     * 模型手上只有 `title`（「小猫钓鱼」），要写提示词时只能拿它当内容，
     * 于是「换风格」变成了「画一只钓鱼的小猫」。给它正文，它才可能「保留内容、只换风格」。
     */
    prompt?: string
    /**
     * 这个节点是**分发器**（批量 / 循环）时，产物的承载节点 id。
     *
     * 「有没有出图」不能只看它自己的 `assetHash` —— 展开出来的后续几次落在承载节点上。
     */
    carrierNodeIds?: string[]
  }[]
  edges: {
    id?: string
    source: string
    target: string
    sourcePort: string
    targetPort: string
  }[]
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

function centerOf(node: { x: number; y: number; w: number; h: number }) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 }
}

function directionBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  if (horizontal) return dx < 0 ? '左' : '右'
  return dy < 0 ? '上' : '下'
}

function zoneOf(
  center: { x: number; y: number },
  bounds: { x: number; y: number; w: number; h: number },
): string {
  if (bounds.w <= 0 || bounds.h <= 0) return '未知'
  const px = (center.x - bounds.x) / bounds.w
  const py = (center.y - bounds.y) / bounds.h
  const horizontal = px < 1 / 3 ? '左' : px > 2 / 3 ? '右' : ''
  const vertical = py < 1 / 3 ? '上' : py > 2 / 3 ? '下' : ''
  if (!horizontal && !vertical) return '中部'
  return `${horizontal}${vertical}` || '中部'
}

export function summarizeGraph(
  graph: Pick<GraphSnapshot, 'nodes' | 'edges'>,
  selectedIds?: readonly string[],
): GraphSummary {
  // 选中项由调用方给：画布 store 只暴露图快照，选中态在视图层
  const only = selectedIds ? new Set(selectedIds) : null
  const bounds =
    graph.nodes.length > 0
      ? {
          x: Math.min(...graph.nodes.map((node) => node.x)),
          y: Math.min(...graph.nodes.map((node) => node.y)),
          w:
            Math.max(...graph.nodes.map((node) => node.x + node.w)) -
            Math.min(...graph.nodes.map((node) => node.x)),
          h:
            Math.max(...graph.nodes.map((node) => node.y + node.h)) -
            Math.min(...graph.nodes.map((node) => node.y)),
        }
      : { x: 0, y: 0, w: 0, h: 0 }
  const nodeTitles = new Map(graph.nodes.map((node) => [node.id, node.title] as const))
  /**
   * 产出过图的**承载节点**：批量 / 循环展开时除第一次之外的产物落在它们身上
   * （见 `canvasPlacement` 的 `__carrierOf`）。
   *
   * 没有这一步，摘要会对着一个「跑出 5 张图的批量节点」说 `hasOutput: false` ——
   * agent 于是以为没出图，重复提交（用户 2026-10-16 报的就是这类判断错）。
   */
  const carriersByOwner = new Map<string, string[]>()
  for (const n of graph.nodes) {
    const owner = asRecord(n.data).__carrierOf
    if (typeof owner !== 'string') continue
    const list = carriersByOwner.get(owner) ?? []
    list.push(n.id)
    carriersByOwner.set(owner, list)
  }
  const nodes = graph.nodes
    .filter((n) => !only || only.has(n.id))
    .map((n) => {
      const data = asRecord(n.data)
      const text = typeof data.prompt === 'string' ? data.prompt : data.text
      const prompt = typeof text === 'string' ? text.trim().slice(0, 160) : ''
      const carrierIds = carriersByOwner.get(n.id) ?? []
      const center = centerOf(n)
      const nearby = graph.nodes
        .filter((other) => other.id !== n.id)
        .map((other) => {
          const otherCenter = centerOf(other)
          return {
            nodeId: other.id,
            title: other.title,
            direction: directionBetween(center, otherCenter),
            distance: Math.round(Math.hypot(otherCenter.x - center.x, otherCenter.y - center.y)),
          }
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4)
      const upstream = graph.edges.filter((edge) => edge.target === n.id).map((edge) => edge.source)
      const downstream = graph.edges
        .filter((edge) => edge.source === n.id)
        .map((edge) => edge.target)
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        x: Math.round(n.x),
        y: Math.round(n.y),
        w: Math.round(n.w),
        h: Math.round(n.h),
        center: { x: Math.round(center.x), y: Math.round(center.y) },
        ...(n.parentId
          ? { parentId: n.parentId, parentTitle: nodeTitles.get(n.parentId) ?? n.parentId }
          : {}),
        zone: zoneOf(center, bounds),
        nearby,
        upstream,
        downstream,
        hasOutput:
          typeof data.assetHash === 'string' ||
          carrierIds.some((cid) => {
            const carrier = graph.nodes.find((x) => x.id === cid)
            return carrier ? typeof asRecord(carrier.data).assetHash === 'string' : false
          }),
        ...(carrierIds.length > 0 ? { carrierNodeIds: carrierIds } : {}),
        ...(prompt ? { prompt } : {}),
      }
    })
  const ids = new Set(nodes.map((n) => n.id))
  return {
    bounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      w: Math.round(bounds.w),
      h: Math.round(bounds.h),
    },
    nodes,
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourcePort: e.sourcePort ?? 'output',
        targetPort: e.targetPort ?? 'input',
      })),
  }
}

export function readGraphSummary(
  store: CanvasStore,
  scope: unknown,
  selectedIds: readonly string[] = [],
): GraphSummary {
  return summarizeGraph(store.getSnapshot(), scope === 'selection' ? selectedIds : undefined)
}

/**
 * 素材信息。
 *
 * 尺寸只报**节点记录下来的**真实像素（`naturalSize`）：节点没记就说不知道，
 * 不去猜、也不为它去解码字节 —— agent 问它是为了判断「能不能当参考图」，
 * 一个编出来的尺寸会直接导致它做出错误判断。
 */
export function readAssetInfo(store: CanvasStore, nodeIds: unknown) {
  const graph = store.getSnapshot()
  const out: { nodeId: string; title?: string; mime: string; width?: number; height?: number }[] = []
  for (const id of asStringArray(nodeIds)) {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) {
      out.push({ nodeId: id, mime: 'unknown' })
      continue
    }
    const data = asRecord(node.data)
    const title = (node.title ?? '').trim()
    const size = asRecord(data.naturalSize)
    const w = typeof size.width === 'number' ? size.width : undefined
    const h = typeof size.height === 'number' ? size.height : undefined
    out.push({
      nodeId: id,
      ...(title ? { title } : {}),
      mime: node.type === 'generation' && data.mode === 'video' ? 'video/mp4' : 'image/png',
      ...(w && h ? { width: w, height: h } : {}),
    })
  }
  return out
}

/**
 * 产物与状态。
 *
 * 数据源是**节点自己记着的产物字段**（画布上显示的就是它），不是执行留痕表 ——
 * agent 关心的是「这个节点现在有什么」，而不是「历史上跑过几次」。
 */
export function readResults(store: CanvasStore, nodeIds: unknown) {
  const graph = store.getSnapshot()
  /**
   * **承载节点**：批量 / 循环展开时，除第一次之外的产物落在**新建的承载节点**上，
   * 它们带着 `data.__carrierOf = <源节点 id>`（见 `canvasPlacement` 的说明）。
   *
   * 用户 2026-10-16 报的「执行明明出了图，已读结果却说没留下记录」就是漏了这一步：
   * 只看被问的那个节点自己的 `assetHash`，批量跑出来的后续几次全都看不见。
   */
  const carriersOf = new Map<string, string[]>()
  for (const n of graph.nodes) {
    const owner = asRecord(n.data).__carrierOf
    if (typeof owner !== 'string') continue
    const list = carriersOf.get(owner) ?? []
    list.push(n.id)
    carriersOf.set(owner, list)
  }
  return asStringArray(nodeIds).map((id) => {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) return { nodeId: id, status: 'missing' as const }
    const title = (node.title ?? '').trim()
    const own = asRecord(node.data).assetHash
    const carrierIds = carriersOf.get(id) ?? []
    const hashes: string[] = []
    if (typeof own === 'string') hashes.push(own)
    for (const carrierId of carrierIds) {
      const carrier = graph.nodes.find((n) => n.id === carrierId)
      const hash = carrier ? asRecord(carrier.data).assetHash : undefined
      if (typeof hash === 'string') hashes.push(hash)
    }
    return hashes.length > 0
      ? {
          nodeId: id,
          ...(title ? { title } : {}),
          status: 'ok' as const,
          outputs: hashes.map((hash) => ({ hash, mime: 'image/png' })),
          /** 产物散在哪些节点上 —— 模型据此知道该去改哪一张，而不是再来问一遍 */
          ...(carrierIds.length > 0 ? { carrierNodeIds: carrierIds } : {}),
        }
      : {
          nodeId: id,
          ...(title ? { title } : {}),
          status: 'empty' as const,
          /**
           * 「这个节点自己是空的」**不等于**「这次没有出图」：批量 / 循环的产物可能全在
           * 承载节点上（它们此刻也还没图，或者已经被用户挪走）。把这句话带给模型，
           * 免得它把「源节点空」直接读成「没出图」再重复提交一次。
           */
          ...(carrierIds.length > 0 ? { note: '该节点是分发器（批量/循环），产物在承载节点上', carrierNodeIds: carrierIds } : {}),
        }
  })
}

export interface AgentToolContext {
  store: CanvasStore
  /** 记忆候选的默认目标；Agent 无权改当前项目 / 会话。 */
  memoryContext?: {
    workbench: 'canvas' | 'ecommerce' | 'storyboard'
    projectId: string
    sessionId?: string
  }
  /** 新节点的落点（§6：优先视口中心偏左） */
  origin: { x: number; y: number }
  /** 跑节点 —— 由执行层注入：agent 自己不直接发渠道请求 */
  runNodes: (
    nodeIds: string[],
    signal?: AbortSignal,
  ) => Promise<AgentRunOutcome[]>
  /** Agent 回合取消信号；确认后执行的付费/写操作也必须跟随停止。 */
  signal?: AbortSignal
  /** 把本轮 applyPlan 产生的 localId 别名解析成真实节点 id（确定性兜底） */
  resolveNodeIds?: (nodeIds: readonly string[]) => string[]
  /** 当前选中的节点 —— `readGraph` 的 `selection` 范围要用；不给就按全图算 */
  selectedIds?: () => readonly string[]
  /**
   * 用户这次是不是「多张图各自一条流程」（见 `expectsPerImageFlows`）。
   *
   * 用户 2026-10-06 第七批 #183：「明明是单独的两个需求他给我替换成了一个需求」。
   * 提示词里已经写了硬约束，这里再做一道**确定性检查** —— 不靠模型自觉。
   */
  perImage?: boolean
  /**
   * 新建节点要补的默认数据（渠道 + 模型 + 生成参数）。
   *
   * 解析默认值要读渠道库（异步），而工具执行器在画布层、拿不到渠道 store，
   * 所以由界面层把「解析」这件事注入进来 —— 解出来的东西**与用户手建节点同源**
   * （两条路都走 `channels.defaultForNewNode`），不会出现「手建的能用、agent 建的
   * 点了没反应」这种分叉。
   *
   * 不给也能跑，但那意味着建出来的生成节点没渠道没模型。
   */
  defaultsForNewNode?: (
    types: readonly AgentNodeType[],
  ) => Promise<Partial<Record<AgentNodeType, Record<string, unknown>>>>
  /**
   * **生成节点该用哪个模型** —— 用户在对话窗上点选的图片 / 视频档
   * （用户 2026-10-03：「我创作面板有什么模型就用什么模型…模型有三个选项」）。
   *
   * 按节点的 `data.mode` 选：视频节点给视频模型，其余给图片模型。
   * 返回 undefined 就保持渠道默认配方不动。
   *
   * 与 `defaultsForNewNode` 一样由界面层注入：工具层认得节点，但不认得渠道 store。
   */
  recipeForGenerated?: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => { channelId: string; model: string } | undefined
  /**
   * 逻辑模型 → 能提供它的渠道。`updateNode` 只接受用户点选的模型，
   * 渠道必须和创建面板一样由系统反查，不能让模型自己填。
   */
  channelIdForModel?: (model: string) => string | undefined

  /**
   * **当前画布上选中的节点用的是哪个模型**（按类别；没有选中 / 选中项没有模型时返回空串）。
   *
   * 用户 2026-10-16：「改成跟随选中」。agent 建生成节点时，模型要**优先跟随用户刚选中的
   * 那个节点**，而不是 Agent 面板里那档默认值 —— 真机上用户要香蕉 2、却建成了
   * 清单第一个（GPT Image 2.5），根因就是默认值只能取「列表第一个」。
   */
  selectedModelOf?: (kind: 'image' | 'video') => string

  /**
   * 模型名 → 它是哪一类（`image` / `video` / `chat`）。由界面层注入（那边有渠道目录）。
   *
   * 只为一件事：**生成节点的 `mode` 以模型为准**。真模型（Agnes 2.5 Pro）会把视频节点
   * 写成 `mode: "image"`（它把「生成节点」当默认档），只写对 `model: "Agnes Video 2.0"`；
   * 而执行层是按 `mode` 走图片 / 视频两条链的 —— 不纠正的话，视频模型被塞进生图链路，
   * 点了生成**一个请求都发不出去**（用户 2026-10-03 让我用 agent 做视频时实测到的）。
   */
  categoryOfModel?: (model: string) => 'image' | 'video' | 'chat' | undefined
  /** 像素级裁剪 / 提取选区；由画布宿主注入，工具层不碰 AssetPort 与 Canvas。 */
  sliceImage?: (
    nodeId: string,
    mode: 'extract' | 'crop',
    rect: { x: number; y: number; w: number; h: number },
    ratio?: string,
  ) => Promise<{ ok: boolean; nodeId?: string; reason?: string }>
  /** 宫格切分；由画布宿主注入。 */
  splitGrid?: (
    nodeId: string,
    rows: number,
    cols: number,
  ) => Promise<{ ok: boolean; nodeIds?: string[]; reason?: string }>
  rememberMemory?: (
    candidate: MemoryCandidate,
  ) => Promise<{ ok: boolean; memoryId?: string; text?: string; reason?: string }>
  /** 只读视觉验收；由界面层注入真实视觉模型与素材读取能力。 */
  visualReview?: (input: {
    nodeIds: readonly string[]
    checklist?: string
  }) => Promise<VisualReviewResult>
}

/**
 * `runFrom` 的节点集合：起点 + 沿连线可达的下游。
 *
 * 两个刻意的边界：
 * - **提示词节点不是可执行项**（它没有 `toRunRequest`），只作为链路中的输入；
 * - **批量 / 循环不在这里展开**。它们各自的 `runNode` 已经会按自己的分发语义跑下游，
 *   若再被这里当作普通节点扫一遍，会产生重复执行。遇到就如实拒绝，让模型改用
 *   `runNode` 直接触发那个分发器。
 */
export function runFromNodeIds(
  store: CanvasStore,
  nodeIds: unknown,
): { ok: true; ids: string[] } | { ok: false; problems: string[] } {
  const graph = store.getSnapshot()
  const starts = asStringArray(nodeIds)
  if (starts.length === 0) return { ok: false, problems: ['runFrom 缺少起点节点'] }

  const reachable = new Set<string>()
  for (const start of starts) {
    if (!graph.nodes.some((n) => n.id === start)) {
      return { ok: false, problems: [`找不到起点节点：${start}`] }
    }
    reachable.add(start)
    for (const id of downstreamOf(start, graph.edges)) reachable.add(id)
  }

  const nodes = graph.nodes.filter((n) => reachable.has(n.id))
  const dispatchers = nodes.filter((n) => n.type === 'batch' || n.type === 'loop')
  if (dispatchers.length > 0) {
    return {
      ok: false,
      problems: [
        `下游链里有分发器节点（${dispatchers.map((n) => n.title || n.id).join('、')}），请直接对分发器运行 runNode`,
      ],
    }
  }

  const disabled = nodes.filter((n) => n.disabled && canBuildRequest(n))
  if (disabled.length > 0) {
    return {
      ok: false,
      problems: [
        `下游链里有已禁用节点（${disabled.map((n) => n.title || n.id).join('、')}），先启用或移除它`,
      ],
    }
  }

  const ids = nodes.filter(canBuildRequest).map((n) => n.id)
  if (ids.length === 0) return { ok: false, problems: ['这条下游链里没有可运行的节点'] }
  return { ok: true, ids }
}

/** 读类执行器：循环里直接调（设计文档 §4） */
export async function executeReadTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const a = asRecord(args)
  switch (name) {
    case 'readGraph':
      return readGraphSummary(ctx.store, a.scope, ctx.selectedIds?.() ?? [])
    case 'readAsset':
      return { assets: readAssetInfo(ctx.store, a.nodeIds) }
    case 'readResult':
      return { results: readResults(ctx.store, a.nodeIds) }
    case 'visualReview': {
      const rawIds = asStringArray(a.nodeIds)
      const nodeIds = ctx.resolveNodeIds ? ctx.resolveNodeIds(rawIds) : rawIds
      if (!ctx.visualReview) {
        return {
          ok: false,
          verdict: 'unreviewable',
          summary: '当前会话没有接入视觉验收子代理',
          issues: [],
          targetNodeIds: nodeIds,
          limitations: ['缺少视觉模型或素材读取能力'],
        }
      }
      return ctx.visualReview({
        nodeIds,
        ...(typeof a.checklist === 'string' && a.checklist.trim()
          ? { checklist: a.checklist.trim() }
          : {}),
      })
    }
    default:
      return { ok: false, error: `没有这个读类工具：${name}` }
  }
}

/**
 * 写 / 花钱的执行器：**只应由界面的「确认」按钮调用**（设计文档 §9）。
 *
 * 与读类分开导出，是为了让「循环里偷偷写」在代码结构上就写不出来。
 */
/**
 * `applyPlan` 的**落前检查**：先归一化、再校验，返回问题列表（空 = 可以落地）。
 *
 * 这是「计划 → 画布」的唯一关口，两个用处：
 * ① 落地前把**形状差异**补齐（`normalizeAgentPlan`），别因为 `order` 写成字符串
 *    这种事整份拒绝；
 * ② 真推不出来的（不认识类型 / 连线指向不存在）整份拒绝，并把问题回给模型。
 *
 * 用户 2026-10-02 报的「重复让我确认新建工作流、重复了三次、画布上什么都没有」
 * 就出在这一步：当时建图还排在确认卡后面，用户先点一次确认我们才发现计划不合法。
 * 现在**建图根本不问**（见 `agentLoop` 的 `WRITE_TOOLS`），失败也直接以
 * 步骤卡的形式露在对话里。
 */
export function planProblems(
  args: unknown,
  existingNodeIds: readonly string[],
): { problems: string[]; plan: AgentPlan | null } {
  const { plan } = normalizeAgentPlan(args)
  const checked = validateAgentPlan(plan, existingNodeIds)
  if (!checked.ok) return { problems: checked.errors, plan: null }
  /**
   * 过形状这一关之后再看一眼**内容**：有没有节点按定义就永远跑不起来。
   *
   * 用户 2026-10-04 报的正是这一类：「结构全对，但是没有提示词」—— 计划能落地、
   * 看着像模像样，可是下游生成节点一个提示词都拿不到（`toRunRequest` 直接返回 null）。
   * 落地之后再让用户自己发现，比当场把话还给模型糟得多。
   */
  const promptless = promptlessGenerationProblems(checked.plan)
  return promptless.length > 0
    ? { problems: promptless, plan: null }
    : { problems: [], plan: checked.plan }
}

/**
 * 上游能**给文字**的节点类型（与 `generationSpec.collectInputs` 同口径）：
 * 提示词节点给 `data.text`，循环节点每轮给 `__roundPrompt`，生成 / 批量 / 分组
 * 自身也可能带着正文。判不出来的（attach 过来的既有节点）一律**当它能给**，
 * 宁可放过、也不要冤枉一份正常计划。
 */
const TEXT_SOURCE_TYPES = new Set<AgentNodeType>(['prompt', 'loop', 'group', 'batch', 'generation'])

/**
 * 找「**永远跑不起来**的生成节点」：自己没有正文，上游也没有一个能给文字的节点。
 *
 * 为什么值得当场拦：`generationSpec.toRunRequest` 在提示词为空时直接返回 null，
 * 也就是这个节点点多少次都不会发请求 —— 不拦的话用户只会看到一张建好的、跑不动的图。
 */
export function promptlessGenerationProblems(plan: AgentPlan): string[] {
  const byId = new Map(plan.nodes.map((n) => [n.localId, n]))
  const attached = new Set((plan.attach ?? []).map((a) => a.localId))
  const out: string[] = []
  for (const [i, node] of plan.nodes.entries()) {
    if (node.type !== 'generation') continue
    /**
     * **被 attach 的节点不用有提示词**：它本来就在画布上（是复用，不是新建），
     * 这条检查管的是「这次**要建**的生成节点跑不跑得起来」。
     * 以前没跳过：模型按规矩把既有图写成 attach 后，反而被这条判成「没有提示词」而整份退回
     * （2026-10-06 第七批 #183 的排查里撞上）。
     */
    if (attached.has(node.localId)) continue
    const own = node.data.prompt
    if (typeof own === 'string' && own.trim()) continue
    const upstream = plan.edges
      .filter((e) => e.target === node.localId)
      .map((e) => byId.get(e.source))
    const hasTextSource = upstream.some(
      (u) => u && (attached.has(u.localId) || TEXT_SOURCE_TYPES.has(u.type)),
    )
    if (hasTextSource) continue
    out.push(
      `第 ${i + 1} 个节点（generation「${node.title ?? node.localId}」）既没有自己的提示词，` +
        '上游也没有能给它文字的节点 —— 这条链永远跑不出图。' +
        '把用户要的画面写进它的 data.prompt，或建一个提示词节点（正文写在 data.text）连到它。',
    )
  }
  return out
}

function selectedNodes(store: CanvasStore, ids: readonly string[]) {
  const graph = store.getSnapshot()
  const unique = [...new Set(ids)]
  const nodes = unique.map((id) => graph.nodes.find((node) => node.id === id))
  const missing = unique.filter((_, index) => !nodes[index])
  return {
    unique,
    nodes: nodes.filter((node): node is NonNullable<typeof node> => !!node),
    missing,
  }
}

async function moveNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要移动的节点'] }
  const { unique, nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点的位置与尺寸由容器管理，请把节点移出组后再操作'] }
  }

  const positionRows = Array.isArray(args.positions) ? args.positions.map(asRecord) : []
  const positions = new Map(
    positionRows.flatMap((row) => {
      const nodeId = typeof row.nodeId === 'string' ? row.nodeId : ''
      const x = Number(row.x)
      const y = Number(row.y)
      return nodeId && Number.isFinite(x) && Number.isFinite(y)
        ? [[nodeId, { x, y }] as const]
        : []
    }),
  )
  const dx = Number.isFinite(Number(args.dx)) ? Number(args.dx) : 0
  const dy = Number.isFinite(Number(args.dy)) ? Number(args.dy) : 0
  if (positions.size === 0 && dx === 0 && dy === 0) {
    return { ok: false, problems: ['请提供 positions，或非零的 dx / dy'] }
  }
  if (positions.size > 0 && unique.some((id) => !positions.has(id))) {
    return { ok: false, problems: ['positions 必须覆盖 nodeIds 里的每一个节点'] }
  }

  store.beginPlan(`agent-move:${createId('plan')}`, 'Agent 移动节点')
  for (const node of nodes) placeNodeWithoutOverlap(store, node.id, {
    x: node.x + (positions.get(node.id) ? positions.get(node.id)!.x - node.x : dx),
    y: node.y + (positions.get(node.id) ? positions.get(node.id)!.y - node.y : dy),
    w: node.w,
    h: node.h,
  })
  store.endPlan()
  await store.flush()
  const after = store.getSnapshot().nodes
  return {
    ok: true,
    moved: nodes.map((node) => {
      const latest = after.find((item) => item.id === node.id) ?? node
      return { nodeId: node.id, x: Math.round(latest.x), y: Math.round(latest.y) }
    }),
  }
}

async function arrangeNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length < 2) return { ok: false, problems: ['至少需要 2 个节点才能排列'] }
  const { unique, nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点由容器自动排版，不需要再排列'] }
  }
  const parents = new Set(nodes.map((node) => node.parentId ?? null))
  if (parents.size > 1) {
    return { ok: false, problems: ['一次只能排列同一层级的节点，不能混排分组内外的节点'] }
  }
  const layout = String(args.layout ?? '')
  if (!['horizontal', 'vertical', 'grid'].includes(layout)) {
    return { ok: false, problems: ['layout 只能是 horizontal / vertical / grid'] }
  }
  const gapRaw = Number(args.gap)
  const gap = Number.isFinite(gapRaw) ? Math.min(240, Math.max(8, gapRaw)) : 32
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)
  const left = Math.min(...ordered.map((node) => node.x))
  const top = Math.min(...ordered.map((node) => node.y))
  const targets = new Map<string, { x: number; y: number }>()

  if (layout === 'horizontal') {
    let cursor = left
    for (const node of ordered) {
      targets.set(node.id, { x: cursor, y: top })
      cursor += node.w + gap
    }
  } else if (layout === 'vertical') {
    let cursor = top
    for (const node of ordered) {
      targets.set(node.id, { x: left, y: cursor })
      cursor += node.h + gap
    }
  } else {
    const columnsRaw = Number(args.columns)
    const columns = Number.isFinite(columnsRaw)
      ? Math.min(ordered.length, Math.max(1, Math.floor(columnsRaw)))
      : Math.min(ordered.length, Math.ceil(Math.sqrt(ordered.length)))
    const rows = Math.ceil(ordered.length / columns)
    const colWidths = Array.from({ length: columns }, (_, col) =>
      Math.max(...ordered.filter((_, index) => index % columns === col).map((node) => node.w)),
    )
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(
        ...ordered
          .slice(row * columns, (row + 1) * columns)
          .map((node) => node.h),
      ),
    )
    ordered.forEach((node, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      targets.set(node.id, {
        x: left + colWidths.slice(0, col).reduce((sum, width) => sum + width + gap, 0),
        y: top + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0),
      })
    })
  }

  store.beginPlan(`agent-arrange:${createId('plan')}`, 'Agent 排列节点')
  const graph = store.getSnapshot()
  const settled: { x: number; y: number; w: number; h: number }[] = []
  const fixed = snapshotRects(graph.nodes.filter((other) => !unique.includes(other.id)))
  const remaining = ordered.map((node) => ({ ...node }))
  while (remaining.length > 0) {
    const node = remaining.shift()!
    const current = remaining.map((item) => ({ ...item }))
    const target = targets.get(node.id)!
    const final = avoidRectOverlap(
      { ...node, ...target },
      [
        ...fixed,
        ...settled,
        ...current,
      ],
    )
    targets.set(node.id, { x: final.x, y: final.y })
    store.dispatch({
      kind: 'node.move',
      ids: [node.id],
      dx: final.x - node.x,
      dy: final.y - node.y,
      phase: 'end',
    })
    settled.push({ x: final.x, y: final.y, w: node.w, h: node.h })
  }
  store.endPlan()
  await store.flush()
  return {
    ok: true,
    layout,
    positions: ordered.map((node) => ({
      nodeId: node.id,
      x: Math.round(targets.get(node.id)!.x),
      y: Math.round(targets.get(node.id)!.y),
    })),
  }
}

async function resizeNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要调整的节点'] }
  const { nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点的位置与尺寸由容器管理，请把节点移出组后再调整'] }
  }
  const scale = Number(args.scale)
  const width = Number(args.width)
  const height = Number(args.height)
  const scaled = Number.isFinite(scale) && scale > 0
  const uniformWidth = Number.isFinite(width) && width > 0
  const uniformHeight = Number.isFinite(height) && height > 0
  if (Number(scaled) + Number(uniformWidth) + Number(uniformHeight) !== 1) {
    return { ok: false, problems: ['width / height / scale 只能指定其中一项'] }
  }
  const useMax = args.useMax === true
  const uniformW = uniformWidth
    ? Number.isFinite(width)
      ? width
      : useMax
        ? Math.max(...nodes.map((node) => node.w))
        : Math.min(...nodes.map((node) => node.w))
    : 0
  const uniformH = uniformHeight
    ? Number.isFinite(height)
      ? height
      : useMax
        ? Math.max(...nodes.map((node) => node.h))
        : Math.min(...nodes.map((node) => node.h))
    : 0
  const changes = nodes.map((node) => {
    const ratio = node.w / Math.max(1, node.h)
    let w = node.w
    let h = node.h
    if (scaled) {
      w *= scale
      h *= scale
    } else if (uniformWidth) {
      w = uniformW
      h = uniformW / ratio
    } else {
      h = uniformH
      w = uniformH * ratio
    }
    const min = nodeMinSize(node)
    return {
      node,
      rect: lockedResize({ x: node.x, y: node.y, w, h }, 0, 0, min, w / h),
    }
  })
  const graph = store.getSnapshot()
  store.beginPlan(`agent-resize:${createId('plan')}`, 'Agent 调整节点尺寸')
  const adjusted: { nodeId: string; w: number; h: number; x: number; y: number }[] = []
  for (const { node, rect } of changes) {
    const occupied = [
      ...snapshotRects(graph.nodes.filter((other) => !ids.includes(other.id))),
      ...nodes
        .filter((other) => other.id !== node.id)
        .map((other) => {
          const previous = adjusted.find((item) => item.nodeId === other.id)
          return previous ?? { x: other.x, y: other.y, w: other.w, h: other.h }
        }),
    ]
    const final = avoidRectOverlap(rect, occupied)
    store.dispatch({ kind: 'node.resize', id: node.id, rect: final, phase: 'end' })
    const moved = placeNodeWithoutOverlap(store, node.id, final)
    adjusted.push({
      nodeId: node.id,
      w: Math.round(final.w),
      h: Math.round(final.h),
      x: Math.round(moved.x),
      y: Math.round(moved.y),
    })
  }
  store.endPlan()
  await store.flush()
  return { ok: true, nodes: adjusted }
}

async function deleteNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要删除的节点'] }
  const { nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  const graph = store.getSnapshot()
  const beforeIds = new Set(graph.nodes.map((node) => node.id))
  store.dispatch({ kind: 'node.delete', ids: nodes.map((node) => node.id) })
  await store.flush()
  return {
    ok: true,
    deletedNodeIds: [...beforeIds].filter(
      (id) => !store.getSnapshot().nodes.some((node) => node.id === id),
    ),
  }
}

async function deleteEdgesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const graph = store.getSnapshot()
  const requested = new Set(asStringArray(args.edgeIds))
  const pairs = Array.isArray(args.pairs) ? args.pairs.map(asRecord) : []
  for (const edge of graph.edges) {
    if (
      pairs.some(
        (pair) =>
          pair.source === edge.source &&
          pair.target === edge.target,
      )
    ) {
      requested.add(edge.id)
    }
  }
  const existing = [...requested].filter((id) => graph.edges.some((edge) => edge.id === id))
  if (existing.length === 0) {
    return { ok: false, problems: ['没有找到要删除的连线'] }
  }
  store.beginPlan(`agent-unlink:${createId('plan')}`, 'Agent 取消连线')
  for (const id of existing) store.dispatch({ kind: 'edge.remove', id })
  store.endPlan()
  await store.flush()
  return { ok: true, deletedEdgeIds: existing }
}

async function compareNodesInStore(
  store: CanvasStore,
  args: Record<string, unknown>,
) {
  const leftId = typeof args.leftNodeId === 'string' ? args.leftNodeId : ''
  const rightId = typeof args.rightNodeId === 'string' ? args.rightNodeId : ''
  if (!leftId || !rightId || leftId === rightId) {
    return { ok: false, problems: ['需要两个不同的节点 id'] }
  }
  const graph = store.getSnapshot()
  const left = graph.nodes.find((node) => node.id === leftId)
  const right = graph.nodes.find((node) => node.id === rightId)
  if (!left || !right) return { ok: false, problems: ['对比节点不存在'] }
  if (
    !(left.data as { assetHash?: unknown }).assetHash ||
    !(right.data as { assetHash?: unknown }).assetHash
  ) {
    return { ok: false, problems: ['两个节点都必须已有图片'] }
  }
  if ((left.parentId ?? null) !== (right.parentId ?? null)) {
    return { ok: false, problems: ['对比的两个节点必须在同一层级'] }
  }
  if (left.parentId || right.parentId) {
    return { ok: false, problems: ['组内节点请移出组后再创建对比节点'] }
  }
  const spec = getSpec('compare')
  if (!spec) return { ok: false, problems: ['对比节点尚未注册'] }
  const id = createId('node')
  const at = {
    x: Math.max(left.x + left.w, right.x + right.w) + 80,
    y: Math.min(left.y, right.y),
  }
  const comparisonSize = getSpec('compare')?.sizing?.min ?? { w: 360, h: 270 }
  const placedAt = avoidRectOverlap(
    { ...at, ...comparisonSize },
    graph.nodes.map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h })),
  )
  store.beginPlan(`agent-compare:${id}`, 'Agent 创建对比')
  store.dispatch({
    kind: 'node.create',
    projectId: graph.projectId,
    type: 'compare',
    id,
    at: placedAt,
    title: `${left.title} / ${right.title} 对比`,
    ...(left.parentId ? { parentId: left.parentId } : {}),
    data: spec.createDefaultData(),
  })
  store.dispatch({ kind: 'edge.connect', source: left.id, target: id })
  store.dispatch({ kind: 'edge.connect', source: right.id, target: id })
  store.endPlan()
  store.setSelection([id])
  await store.flush()
  return { ok: true, compareNodeId: id }
}

export async function executeConfirmedTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const a = asRecord(args)
  switch (name) {
    case 'applyPlan': {
      const existing = ctx.store.getSnapshot().nodes.map((n) => n.id)
      const { problems, plan } = planProblems(a, existing)
      if (!plan) return { ok: false, problems }
      /**
       * **「每张图各自一条流程」的确定性检查**（用户 2026-10-06 第七批 #183）。
       *
       * 提示词里已经写了硬约束，但真机上模型照样把两张图并成一条 —— 于是两个需求被办成一个。
       * 这一条不靠它自觉：用户 @ 了多张图、又没说「合成」时，**生成节点数少于图数**
       * 就把计划退回给模型重做（`problems` 会回填给它，下一轮它会按这个改）。
       */
      if (ctx.perImage) {
        const graph = ctx.store.getSnapshot()
        const attachedIds = new Set((plan.attach ?? []).map((at) => at.localId))
        const attachedImages = (plan.attach ?? []).filter((at) => {
          const n = graph.nodes.find((x) => x.id === at.existingNodeId)
          return Boolean((n?.data as { assetHash?: string } | undefined)?.assetHash)
        }).length
        const newGenerations = plan.nodes.filter(
          (n) => n.type === 'generation' && !attachedIds.has(n.localId),
        ).length
        if (attachedImages >= 2 && newGenerations < attachedImages) {
          return {
            ok: false,
            problems: [
              `用户要的是每张图各自处理，但这份计划只建了 ${newGenerations} 个生成节点、@ 了 ${attachedImages} 张图。`,
              '请**一张图配一个生成节点**：各自 attach、各自在 edges 里连线，不要并成一条流程。',
            ],
          }
        }
      }
      /**
       * 生成节点的 `mode` **以模型自己的类别为准**（详见 `alignGenerationMode`）：
       * 真模型常把视频节点写成 `mode:"image"`，不纠正的话请求都组不出来。
       */
      const aligned = ctx.categoryOfModel
        ? alignGenerationMode(plan, ctx.categoryOfModel)
        : { plan, notes: [] }
      const finalPlan = aligned.plan
      /**
       * 先把「新建节点的默认数据」解出来，再交给纯函数建命令。
       *
       * 只解**计划里真用到的类型**：一次对话可能只建生成节点，没必要去问聊天模型。
       * 复用（attach）的节点不新建，也就不需要默认值。
       */
      const needed = [...new Set(finalPlan.nodes.map((n) => n.type))]
      const defaults = ctx.defaultsForNewNode ? await ctx.defaultsForNewNode(needed) : undefined
      const applied = applyAgentPlan(ctx.store, finalPlan, ctx.origin, {
        /**
         * 三层打底由 `buildLandingCommand` 负责，这里只把**用户点选的那一档**
         * 叠进「渠道默认配方」这一层：计划里自己写了模型仍然以计划为准（§11）。
         */
        dataFor: (type: AgentNodeType, node) => {
          const base = defaults?.[type] ?? {}
          const picked = ctx.recipeForGenerated?.(type, node)
          return picked ? { ...base, channelId: picked.channelId, model: picked.model } : base
        },
      })
      // 自检结果整份回填：模型要靠它决定补连线还是改图（§6.1）
      return {
        ok: applied.ok,
        problems: applied.problems,
        createdNodeIds: applied.createdNodeIds,
        ...(aligned.notes.length > 0 ? { notes: aligned.notes } : {}),
      }
    }
    case 'updateNode': {
      /**
       * **批量改：一次确认**（用户 2026-10-06 第七批 #187）。
       *
       * 用户原话：「我说八张都改模型的时候还需要我一个一个的确认，这不符合逻辑，
       * 这种改动应该一次性让我确认即可」。原来只收单个 `nodeId`，模型只能一次改一个 ——
       * 真机截图里「八张都改刚刚的那个模型」后面跟了 **7 次**「已改节点参数」和 7 次确认。
       *
       * 现在补上 `nodeIds`（复数）：同一个 patch **一次改完整批**，确认卡也只弹一次。
       * 一次意图 = 一次确认。
       */
      const ids = [
        ...new Set([
          ...asStringArray(a.nodeIds),
          ...(typeof a.nodeId === 'string' && a.nodeId ? [a.nodeId] : []),
        ]),
      ]
      if (ids.length === 0) return { ok: false, problems: ['没有指定要改的节点'] }
      const graph = ctx.store.getSnapshot()
      const missing = ids.filter((id) => !graph.nodes.some((n) => n.id === id))
      if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
      /**
       * `channelId` 是内部实现，Agent 无权直接指定。先剥掉，再由模型反查补回。
       * 这样模型即使把某个内置渠道 id 写进 patch，也不会改变真实路由。
       */
      const patch = { ...asRecord(a.data) }
      delete patch.channelId
      const requestedModel =
        typeof patch.model === 'string' ? patch.model.trim() : undefined
      const routedPatch =
        requestedModel === undefined
          ? patch
          : requestedModel
            ? (() => {
                const channelId = ctx.channelIdForModel?.(requestedModel)
                return channelId
                  ? { ...patch, model: requestedModel, channelId }
                  : null
              })()
            : { ...patch, model: '' }
      if (routedPatch === null) {
        return {
          ok: false,
          problems: [`没有可用渠道提供模型「${requestedModel}」，请先在后台勾选并配置映射`],
        }
      }
      /**
       * ★★ **出过图的节点，正文是历史记录，不许覆盖**（用户 2026-10-05 第五批第 4 条：
       * 「agent 提出的需求应该先新建节点，然后把提示词放在新建节点上，而不是把提示词覆盖
       * 原有的节点，这样才会有原本的记录，否则第一个图片的提示词直接被覆盖了」）。
       *
       * 这是**确定性拦截**，不靠提示词自觉：真机上模型就是走了 `updateNode` 把
       * 「小猫钓鱼」那句提示词整句换成了「小狗钓鱼」，用户回头再也看不到上一版写了什么。
       * 拦下来之后把「该怎么做」一并告诉它（循环会把 problems 回填给模型），
       * 它下一轮就会改成「新建节点 + attach 旧图」。
       *
       * 只拦**正文**（`prompt` / `text`）：比例 / 张数 / 模型这些参数本来就是我们让
       * 用户随时改的（用户也确实会点名要改）。
       *
       * 批量时**一个不合格就整批不动**：改一半比不改更难收拾。
       */
      const touchesText = 'prompt' in routedPatch || 'text' in routedPatch
      if (touchesText) {
        const blocked = graph.nodes.filter(
          (n) => ids.includes(n.id) && Boolean((n.data as { assetHash?: unknown }).assetHash),
        )
        if (blocked.length > 0) {
          return {
            ok: false,
            problems: [
              `这些节点已经出过图，正文是上一版的记录，不能覆盖：${blocked
                .map((n) => `「${n.title ?? n.id}」`)
                .join('、')}`,
              '要改就**新建生成节点**、用 attach 把它们接成上游，把新提示词写在新节点上，再 runNode 跑新节点。',
            ],
          }
        }
      }
      for (const id of ids) ctx.store.dispatch({ kind: 'node.updateData', id, patch: routedPatch })
      return { ok: true }
    }
    case 'runNode': {
      const rawIds = asStringArray(a.nodeIds)
      const ids = ctx.resolveNodeIds ? ctx.resolveNodeIds(rawIds) : rawIds
      if (ids.length === 0) return { ok: false, problems: ['没有指定要跑的节点'] }
      const outcomes = await ctx.runNodes(ids, ctx.signal)
      return { ok: outcomes.every((o) => o.ok), outcomes }
    }
    case 'runFrom': {
      const rawIds = asStringArray(a.nodeIds)
      const ids = ctx.resolveNodeIds ? ctx.resolveNodeIds(rawIds) : rawIds
      const resolved = runFromNodeIds(ctx.store, ids)
      if (!resolved.ok) return resolved
      const outcomes = await ctx.runNodes(resolved.ids, ctx.signal)
      return { ok: outcomes.every((o) => o.ok), outcomes }
    }
    case 'rememberMemory': {
      if (!ctx.rememberMemory) {
        return { ok: false, reason: '当前会话没有接入个人记忆存储' }
      }
      const candidate = normalizeMemoryCandidate(a, {
        ...(ctx.memoryContext?.workbench
          ? { workbench: ctx.memoryContext.workbench }
          : {}),
        ...(ctx.memoryContext?.projectId
          ? { projectId: ctx.memoryContext.projectId }
          : {}),
        ...(ctx.memoryContext?.sessionId
          ? { sessionId: ctx.memoryContext.sessionId }
          : {}),
      })
      const problems = memoryCandidateProblems(candidate)
      if (problems.length > 0) return { ok: false, reason: problems.join('；') }
      return ctx.rememberMemory(candidate)
    }
    case 'moveNodes':
      return moveNodesInStore(ctx.store, a)
    case 'arrangeNodes':
      return arrangeNodesInStore(ctx.store, a)
    case 'resizeNodes':
      return resizeNodesInStore(ctx.store, a)
    case 'deleteNodes':
      return deleteNodesInStore(ctx.store, a)
    case 'deleteEdges':
      return deleteEdgesInStore(ctx.store, a)
    case 'compareNodes':
      return compareNodesInStore(ctx.store, a)
    case 'sliceImage': {
      const nodeId = typeof a.nodeId === 'string' ? a.nodeId : ''
      const mode = a.mode === 'crop' ? 'crop' : a.mode === 'extract' ? 'extract' : null
      if (!nodeId || !mode) return { ok: false, problems: ['需要 nodeId 与 extract / crop 模式'] }
      const node = ctx.store.getSnapshot().nodes.find((item) => item.id === nodeId)
      if (!node) return { ok: false, problems: ['节点不存在'] }
      if (!(node.data as { assetHash?: unknown }).assetHash) {
        return { ok: false, problems: ['这个节点还没有图片'] }
      }
      const rect = asRecord(a.rect)
      const x = Number(rect.x)
      const y = Number(rect.y)
      const w = Number(rect.w)
      const h = Number(rect.h)
      if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
        if (!ctx.sliceImage) return { ok: false, problems: ['当前画布没有接入裁剪能力'] }
        const result = await ctx.sliceImage(
          nodeId,
          mode,
          { x, y, w, h },
          typeof a.ratio === 'string' ? a.ratio : undefined,
        )
        if (result.ok && result.nodeId) {
          const created = ctx.store.getSnapshot().nodes.find((item) => item.id === result.nodeId)
          if (created) placeNodeWithoutOverlap(ctx.store, created.id, created)
        }
        return result
      }
      ctx.store.openCropLightbox(nodeId, { plain: mode === 'crop' })
      return {
        ok: true,
        waitingForSelection: true,
        message: `已在灯箱打开「${mode === 'crop' ? '裁剪' : '提取选区'}」，请在图上框选后确认`,
      }
    }
    case 'splitGrid': {
      const nodeId = typeof a.nodeId === 'string' ? a.nodeId : ''
      const rows = Math.floor(Number(a.rows))
      const cols = Math.floor(Number(a.cols))
      if (
        !nodeId ||
        !Number.isFinite(rows) ||
        !Number.isFinite(cols) ||
        rows < 1 ||
        cols < 1 ||
        rows > 64 ||
        cols > 64
      ) {
        return { ok: false, problems: ['需要 nodeId、rows 与 cols，且行列数必须在 1–64'] }
      }
      if (!ctx.splitGrid) return { ok: false, problems: ['当前画布没有接入宫格切分能力'] }
      const result = await ctx.splitGrid(nodeId, rows, cols)
      if (result.ok && result.nodeIds?.length) {
        for (const id of result.nodeIds) {
          const created = ctx.store.getSnapshot().nodes.find((item) => item.id === id)
          if (created) placeNodeWithoutOverlap(ctx.store, created.id, created)
        }
      }
      return result
    }
    default:
      return { ok: false, problems: [`没有这个工具：${name}`] }
  }
}
