import type { Point, Rect, Size } from '../../domain/canvas/geometry/rect'
import type { NodeSnapshot, NodeType } from '../../domain/canvas/model/node'
import type { RunRecord, RunScope, RunMode } from '../../domain/canvas/model/runRecord'
// 执行模式词表上移共享执行 domain（M6-5 路径 B），此处转出保持既有引用路径可用
import type { ExecutionMode } from '../../domain/shared/execution/types'

/**
 * 命令联合（架构 §4.3）。
 * 图数据的每一次变更都经过 dispatch(command) —— 这是唯一入口。
 *
 * M0-11 扩展（相对架构原文的偏差，见交接本第 4 组）：
 * - node.create 增加 id / title / parentId / size：执行引擎需要引用自己创建出的节点
 *   （否则拿不到新节点 id，无法把生成的 assetHash 写回去）
 * - runPlan.execute 增加 planId / createdAt：执行计划要能落 tasks 表并被取消
 * - node.runRecord.append 携带 record：reducer 是纯函数且不持有 runRecords 表
 */
export type Command =
  | {
      kind: 'node.create'
      projectId: string
      type: NodeType
      at: Point
      data?: unknown
      id?: string
      title?: string
      parentId?: string | null
      size?: Size
    }
  | { kind: 'node.move'; ids: string[]; dx: number; dy: number; phase: 'begin' | 'move' | 'end' }
  /**
   * 复制节点（§4.2 Alt + 拖动 / Ctrl+C/V）。
   * reducer 必须是纯函数，因此新 id 由调用方传入（与 node.create 一致）：
   * - `ids` 与 `newIds` 一一对应，长度不符即报错（早失败好过静默错位）
   * - `dx/dy` 是副本相对原节点的位移（Alt 拖动原地复制时传 0,0）
   * - `rewire`：true 时把原节点的**上下游连线复制一份指向副本**（§4.2「保留上下游连线」）
   */
  | {
      kind: 'node.duplicate'
      ids: string[]
      newIds: string[]
      dx?: number
      dy?: number
      rewire?: boolean
    }
  /**
   * 粘贴剪贴板内容（§4.2 `Ctrl/Cmd + V`）。
   *
   * 与 `node.duplicate` 的分工：duplicate 复制的是**图里现存的节点**（Alt + 拖动，
   * 原地副本 + 可选重连上下游）；paste 的来源是**剪贴板快照**，原件可能早已被删，
   * 所以载荷自带完整节点与连线，不要求它们在图里。
   *
   * 新 id 与落位坐标由调用方算好（`domain/canvas/clipboard.ts` 的纯函数），
   * reducer 只负责把 `projectId` 盖成当前项目——这也让剪贴板能跨项目粘贴。
   */
  | {
      kind: 'node.paste'
      nodes: NodeSnapshot[]
      /** 端点可选：老剪贴板载荷与默认口不写字段（见 `edge.connect`） */
      edges: { source: string; target: string; sourcePort?: string; targetPort?: string }[]
    }
  /**
   * 删除节点（§6.20 Delete / Backspace、§4.1 右键「删除」）。
   *
   * 级联范围（一次 dispatch 全部处理，保证一步撤销能整组恢复）：
   * - 待删节点的**全部后代**（容器递归，避免留下 parentId 悬空的子节点）
   * - 与上述任一节点相连的**全部连线**
   * - 结果组 childIds 里的引用；引用被清空的结果组一并删除（避免空壳残留）
   */
  | { kind: 'node.delete'; ids: string[] }
  | { kind: 'node.resize'; id: string; rect: Rect; phase: 'begin' | 'move' | 'end' }
  | { kind: 'node.rename'; id: string; title: string }
  /**
   * 禁用 / 启用节点（§4.1 / §9.3 数据流不变量 5）：只改 NodeBase.disabled，不动 data。
   *
   * 支持一次传多个 id（将来多选禁用直接用）；真源仍是逐节点的 `disabled` 字段。
   * 禁用后执行计划跳过它，但它已有的产物 hash 仍可被下游当只读上游读取。
   */
  | { kind: 'node.setDisabled'; ids: string[]; disabled: boolean }
  /**
   * 改节点数据（参数 / 产物）。
   *
   * `size` 是**可选的尺寸联动**：产物写回时「data 换成新产物」与「框换成产物比例」
   * 必须同一拍发生——分成两条命令会留下「已经是新图、框还是旧比例」的中间态。
   * 之所以不复用 `node.resize`：它要求完整 rect（会顺手移动节点），而落位场景
   * 只想改尺寸、位置一个字都不该动（§6.16）。
   */
  | { kind: 'node.updateData'; id: string; patch: Record<string, unknown>; transient?: boolean; size?: Size }
  /**
   * 改归属（拖进 / 拖出容器）。
   *
   * `at` = **容器给的落位**（local 坐标）：只有**批量**用得上 —— 它的位置语义是
   * 3×3 格位，拖进去就该吸到空位（而不是保持世界位置）。分组不吃它（要保画布位置）。
   */
  | { kind: 'node.reparent'; id: string; toParent: string | null; index?: number; at?: Point }
  /**
   * 把容器（分组 / 批量）的框按内容重算（用户第 15 批 #334-④）。
   *
   * 两种模式，**分工是定死的**（别在别处再算一遍）：
   * - `hug`（缺省，自动路径用）：框 = 当前框 ⊎ 贴合框，**只长不缩**
   *   ——「把其中一个节点拖出去，分组面板也不需要在自适应剩下的节点的大小」，
   *   而"只拖出一半"要「分组背景适应节点」；
   * - `tight`：「排列与整理 → 整理节点」用，框 = 贴合框（该缩就缩）。
   *
   * 两种都**保持孩子的世界位置不变**：需要时连原点一起挪，并同步改写每个孩子的 local 坐标。
   */
  | { kind: 'node.refitContainer'; id: string; mode?: 'hug' | 'tight' }
  /**
   * 建一条边。
   *
   * `sourcePort` / `targetPort` 缺省 = 历史口径（`output` → `input`）。
   * 融合节点的「局部修改图」入口在**右侧**、id 是 `patch`（产品文档 §6.23），
   * 只按 (source,target) 无法表达它。
   */
  | { kind: 'edge.connect'; source: string; target: string; sourcePort?: string; targetPort?: string }
  | { kind: 'edge.remove'; id: string }
  | { kind: 'container.reorder'; containerId: string; orderedChildIds: string[] }
  /**
   * Agent 落计划：**多节点 + 连线一次落地**（设计文档 §3 / §5）。
   *
   * 与 `node.paste` 的关键差别：**连线可以一端指向画布上已有的节点**。
   * paste 刻意只保留「两端都在本批内」的边（它的来源是剪贴板快照），
   * 而 agent 的典型用法正是「从你已放好的素材节点连到我新生成的节点」——
   * 拿 paste 会**静默丢掉这条边**，于是图看起来建好了、其实是断的。
   *
   * 另一点：paste 不校验连线合法性（原图既然合法，搬过来仍合法）；
   * 这里的图是模型生成的，**必须**逐条过 `canConnect`。
   */
  | {
      kind: 'agent.applyPlan'
      /** 要新建的节点；id 与坐标由调用方算好（与 node.paste 同口径） */
      nodes: NodeSnapshot[]
      /** 连线：两端可在本批内，也可指向画布上已有节点 */
      edges: { source: string; target: string; sourcePort?: string; targetPort?: string }[]
    }
  // 生成产物落库：节点只持有 hash，媒体本体（字节）写 assets 表（产品文档 §8 hash 主键）
  | {
      kind: 'asset.put'
      /**
       * `createdAt` / `projectId` 是**素材库要用的两个字段**（2026-09-29）。
       *
       * 素材本体此前只有字节与尺寸：能画出来，但「什么时候来的、属于哪个项目」
       * 一概不知 —— 于是素材库既排不了序，也说不出来源。这两个字段可选，
       * 老数据缺它们由 `toLibraryAssets` 从生成记录 / 持有节点回落，零迁移。
       */
      asset: {
        hash: string
        mime: string
        bytes: Uint8Array
        width?: number
        height?: number
        createdAt?: number
        projectId?: string
      }
    }
  // RunRecord：执行留痕，「从不删除」是硬性要求（日志面板的数据源）
  | { kind: 'node.runRecord.append'; nodeId: string; record: RunRecord }
  // runPlan 是「执行计划」的图数据化形态（§4.5）
  | {
      kind: 'runPlan.execute'
      planId: string
      scope: RunScope
      mode: ExecutionMode
      originNodeId?: string
      createdAt?: number
    }
  | { kind: 'runPlan.cancel'; runPlanId: string; at?: number }

export type { RunScope, RunMode, ExecutionMode }
