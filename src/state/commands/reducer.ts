import type { Command } from './index'
import type { CommandResult, TransactionBoundary } from '../shared/types'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeData, GroupData } from '../../domain/canvas/model/node'
import { CONTAINER_TYPES } from '../../domain/canvas/model/node'
import type { Patch, Row } from '../../domain/patch/types'
import type { Rect } from '../../domain/canvas/geometry/rect'
import { invertPatches } from '../../domain/patch/apply'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import { canConnect } from '../../domain/canvas/graph/canConnect'
import { canReparent, applyReparent, edgesToDropOnReparent } from '../../domain/canvas/graph/reparent'
import { createId } from '../../shared/id'
import { toPersistPlan, applyGraphPatches } from '../workbenches/canvas/persist'
import { containerMinSize, groupFitSize } from '../../domain/canvas/layout/packContainer'
import { CONTAINER_PADDING } from '../../domain/canvas/layout/constants'
import { DEFAULT_SOURCE_PORT, DEFAULT_TARGET_PORT, edgeKey } from '../../domain/canvas/model/edge'

export interface ReduceOutput {
  result: CommandResult
  next: GraphSnapshot
}

function findNode(graph: GraphSnapshot, id: string): NodeSnapshot | undefined {
  return graph.nodes.find((n) => n.id === id)
}

/**
 * 组：把框调成"孩子们的包围盒 + 四边等距"，必要时**把组原点一起挪**
 * （孩子跑到原点外时），并同步修正每个孩子的 local 坐标 ——
 * 世界位置一个像素都不变（用户 2026-10-06 第 14 批第 1 条：
 * 「原本在画布中是什么位置…就是什么位置」）。
 *
 * 两种模式（用户第 15 批 #334-④ 定死了二者的分工）：
 * - **`hug`（默认，自动路径用）**：框 = 当前框 ⊎ 贴合框 —— **只长不缩**。
 *   用户原话：「如果把其中一个节点拖出去，分组面板也**不需要**去自适应剩下的节点的大小」
 *   ⇒ 自动路径永不缩框（缩框是「排列与整理 → 整理节点」那个手动动作，见 `tight`）；
 *   而"只拖出一半"要「分组背景适应节点」⇒ 自动路径要能长。
 * - **`tight`（「整理节点」用）**：框 = 贴合框（该缩就缩）—— 这是唯一会缩框的路径。
 *
 * 提到模块级：`node.reparent`（拖进 / 拖出）与 `node.delete`（删掉组内节点）都要用，
 * 两处各写一份迟早漂移。
 */
function refitGroupPatches(
  patches: Patch[],
  g: NodeSnapshot,
  kids: readonly { id: string; x: number; y: number; w: number; h: number }[],
  mode: 'hug' | 'tight' = 'hug',
): void {
  /**
   * ★★ **空组：框一点都不动**（用户第 17 批 #2：「分组里面的节点全部拖出去之后，
   * 那个分组背景板也不需要变…但是全部节点出去后就不行了，就给我缩小了」）。
   *
   * 少了这一条，最后一个孩子走掉时 `useHug` 会因为 `kids.length > 0` 不成立而翻成 false
   * ⇒ 落到"贴合"路径 ⇒ 框被 `groupFitSize([])` 的空板默认尺寸顶掉
   *（实测：570×280 的框，两个成员都出去之后变成 240×192）。
   *
   * 「只长不缩」的语义本来就是"自动路径不缩框"，空组是它的极端情况：
   * 没有孩子就没有"贴合"可言，框留在原地等用户继续用（要缩只剩手动「整理节点」）。
   */
  if (kids.length === 0) return
  const fit = groupFitSize(kids)
  /** 贴合框在**世界坐标**下的左上角（孩子存的是 local ⇒ 加组原点） */
  const tightX = kids.length > 0 ? g.x + Math.min(...kids.map((k) => k.x)) - CONTAINER_PADDING : g.x
  const tightY = kids.length > 0 ? g.y + Math.min(...kids.map((k) => k.y)) - CONTAINER_PADDING : g.y
  /** 只长不缩：自动路径把"当前框"也并进来（负方向要挪原点、正方向只改尺寸）。空组在上面的早退里已经排除 */
  const useHug = mode === 'hug'
  const x = useHug ? Math.min(g.x, tightX) : tightX
  const y = useHug ? Math.min(g.y, tightY) : tightY
  const right = useHug ? Math.max(g.x + g.w, tightX + fit.w) : tightX + fit.w
  const bottom = useHug ? Math.max(g.y + g.h, tightY + fit.h) : tightY + fit.h
  const nextW = Math.max(1, Math.ceil(right - x))
  const nextH = Math.max(1, Math.ceil(bottom - y))
  const shiftX = g.x - x
  const shiftY = g.y - y
  /** 框与孩子都没动 ⇒ 一条补丁都不发（免得每次拖拽松手都压一条无意义的撤销记录） */
  const moved = shiftX !== 0 || shiftY !== 0
  const resized = nextW !== g.w || nextH !== g.h
  if (!moved && !resized) return
  patches.push({
    op: 'patch',
    table: 'nodes',
    id: g.id,
    changes: { x, y, w: nextW, h: nextH },
  })
  if (moved) {
    for (const k of kids) {
      patches.push({
        op: 'patch',
        table: 'nodes',
        id: k.id,
        changes: { x: k.x + shiftX, y: k.y + shiftY },
      })
    }
  }
}

function fail(kind: Command['kind'], reason: string): never {
  throw new Error(`[command ${kind}] ${reason}`)
}

/**
 * **批量**节点的框：自动尺寸 vs 手工缩放（用户第 15 批 #335-①）。
 *
 * 批量的位置语义是格位 ⇒ 框天然 = 网格 + 四边 20（`containerMinSize`）。
 * 但用户把框拉大 = **把整套单元与素材一起放大**（`containerScale`），那是**手工尺寸**，
 * 自动路径不许把它按回网格：只有"当前框正好等于**上一个子节点数**的网格尺寸"
 *（⇒ 它是自动长出来的）才跟着子节点数变化；否则保持不动。
 *
 * 这条判据在批 14 的 #325 里被撤过一次 —— 当时"两个节点进批量下方空一片"的根因是
 * **打批量时那个包住内容的包装框**（比网格大得多、永远不等于网格尺寸）没被清掉；
 * 现在包装框改成直接按**网格尺寸**建（见 `wrapSelection`），判据于是成立。
 */
function batchFitPatches(
  patches: Patch[],
  c: NodeSnapshot,
  prevCount: number,
  nextCount: number,
): void {
  const prev = containerMinSize('batch', prevCount)
  const next = containerMinSize('batch', nextCount)
  /** 手工缩放过的框：自动路径一个字都不动它 */
  if (c.w !== prev.w || c.h !== prev.h) return
  if (c.w === next.w && c.h === next.h) return
  patches.push({ op: 'patch', table: 'nodes', id: c.id, changes: { w: next.w, h: next.h } })
}

/** 跨表求逆：表之间相互独立，逐表调用 domain 的 invertPatches 后拼接 */
function invertGraphPatches(graph: GraphSnapshot, patches: readonly Patch[]): Patch[] {
  const inv: Patch[] = []
  for (const table of ['nodes', 'edges'] as const) {
    const tps = patches.filter((p) => p.table === table)
    if (!tps.length) continue
    const rows = table === 'nodes' ? graph.nodes : graph.edges
    inv.push(...invertPatches(rows as never, tps as never))
  }
  return inv
}

interface Handled {
  patches: Patch[]
  transaction: TransactionBoundary
}

function handle(cmd: Command, graph: GraphSnapshot): Handled {
  switch (cmd.kind) {
    case 'node.create': {
      const spec = getSpec(cmd.type)
      if (!spec) fail(cmd.kind, `未知节点类型：${cmd.type}`)
      const data = (cmd.data as NodeData | undefined) ?? spec.createDefaultData()
      // 位置与尺寸一律由调用方给定（结果组下线后不再有「算出来的格位」这回事）
      const size = cmd.size ?? { w: spec.sizing.min.w, h: spec.sizing.min.h }
      const node: NodeSnapshot = {
        id: cmd.id ?? createId('node'),
        projectId: cmd.projectId,
        type: cmd.type,
        parentId: cmd.parentId ?? null,
        x: cmd.at.x,
        y: cmd.at.y,
        w: size.w,
        h: size.h,
      title: cmd.title ?? spec.label,
      disabled: false,
      data,
      }
      const patches: Patch[] = [{ op: 'upsert', table: 'nodes', row: node as unknown as Row }]
      return {
        patches,
        transaction: { mode: 'standalone', label: `新建 ${spec.label}` },
      }
    }

    case 'node.move': {
      const patches: Patch[] = []
      for (const id of cmd.ids) {
        const n = findNode(graph, id)
        if (!n) fail(cmd.kind, `节点不存在：${id}`)
        patches.push({ op: 'patch', table: 'nodes', id, changes: { x: n.x + cmd.dx, y: n.y + cmd.dy } })
      }
      return {
        patches,
        transaction: { mode: 'coalesce', groupId: `move:${cmd.ids.join(',')}`, label: '移动节点' },
      }
    }

    /**
     * 复制节点（§4.2 Alt + 拖动「原地复制出新节点，保留上下游连线」）。
     *
     * 语义：副本落到原节点 + (dx,dy)，数据深拷贝一份（assetHash 只引用不复制字节）；
     * `rewire` 为真时，把原节点的每条**外部**连线复制成指向副本的连线
     * （上游：外部节点 → 副本；下游：副本 → 外部节点）。
     *
     * 集合内部（ids 之间的连线）也一并复制，这样多选 + Alt 拖动能整组复制。
     * 连线重建统一走 canConnect 校验，非法连线静默跳过（复制不该因一条边失败而中断）。
     */
    case 'node.duplicate': {
      if (cmd.ids.length !== cmd.newIds.length) {
        fail(cmd.kind, `ids 与 newIds 长度不一致：${cmd.ids.length} vs ${cmd.newIds.length}`)
      }
      const dx = cmd.dx ?? 0
      const dy = cmd.dy ?? 0
      const idMap = new Map<string, string>()
      const patches: Patch[] = []
      // 副本快照（连线校验要用：补丁尚未应用，graph 里查不到新 id）
      const copies = new Map<string, NodeSnapshot>()

      for (let i = 0; i < cmd.ids.length; i += 1) {
        const src = findNode(graph, cmd.ids[i])
        if (!src) fail(cmd.kind, `节点不存在：${cmd.ids[i]}`)
        /**
         * **容器（分组 / 批量）的成员要一起复制**（用户第 15 批 #336：
         * 「alt+拖动…复制分组面板和批量节点的时候没有把里面的节点素材复制，是一个bug」）。
         *
         * 成员的 local 坐标**照抄**（它们本来就是相对容器原点的），父级改指副本；
         * `assetHash` 只引用不复制字节（与"素材存在库里、节点只记 hash"同一条口径）。
         * 先算成员、再算容器：容器副本的 `data.childIds` 要按新旧 id 对照表改写，
         * 否则副本的顺序表指向的还是原节点（副本会"有子节点但排序表是空的"）。
         */
        const kidIdOf = new Map<string, string>()
        if (CONTAINER_TYPES.has(src.type)) {
          for (const kid of graph.nodes.filter((n) => n.parentId === src.id)) {
            const kidId = createId('node')
            kidIdOf.set(kid.id, kidId)
            const kidCopy: NodeSnapshot = {
              ...kid,
              id: kidId,
              parentId: cmd.newIds[i],
              data: structuredClone(kid.data),
            }
            /** 成员的 id 也进 `idMap`：它的外部连线按同一条规则重建（与普通节点一致） */
            idMap.set(kid.id, kidId)
            copies.set(kidCopy.id, kidCopy)
            patches.push({ op: 'upsert', table: 'nodes', row: kidCopy as unknown as Row })
          }
        }
        const data = structuredClone(src.data)
        if (kidIdOf.size > 0) {
          const keep = (data as { childIds?: string[] }).childIds ?? []
          /** 顺序表里可能还有没进图的老 id：只映射存在的那些（与 `childIdsOf` 同一口径） */
          ;(data as { childIds?: string[] }).childIds = keep.map((id) => kidIdOf.get(id) ?? id)
        }
        const copy: NodeSnapshot = {
          ...src,
          id: cmd.newIds[i],
          x: src.x + dx,
          y: src.y + dy,
          // 数据深拷贝：避免副本与原节点共享同一个 data 对象引用
          data,
        }
        idMap.set(src.id, cmd.newIds[i])
        copies.set(copy.id, copy)
        patches.push({ op: 'upsert', table: 'nodes', row: copy as unknown as Row })
      }

      if (cmd.rewire) {
        // 副本本身不在 graph 里，连线校验要同时能查到原节点与副本
        const resolve = (id: string): NodeSnapshot | undefined =>
          graph.nodes.find((n) => n.id === id) ?? copies.get(id)

        for (const e of graph.edges) {
          const ns = idMap.get(e.source)
          const nt = idMap.get(e.target)
          // 两端都不在复制集合内：与本次复制无关
          if (!ns && !nt) continue
          const source = ns ?? e.source
          const target = nt ?? e.target
          const sn = resolve(source)
          const tn = resolve(target)
          if (!sn || !tn) continue
          if (!canConnect(sn, tn, graph, { sourcePort: e.sourcePort, targetPort: e.targetPort }).ok) continue
          patches.push({
            op: 'upsert',
            table: 'edges',
            row: {
              id: createId('edge'),
              projectId: graph.projectId,
              source,
              target,
              ...(e.sourcePort && e.sourcePort !== DEFAULT_SOURCE_PORT ? { sourcePort: e.sourcePort } : {}),
              ...(e.targetPort && e.targetPort !== DEFAULT_TARGET_PORT ? { targetPort: e.targetPort } : {}),
            } as unknown as Row,
          })
        }
      }

      return {
        patches,
        transaction: { mode: 'standalone', label: '复制节点' },
      }
    }

    /**
     * 粘贴剪贴板内容（§4.2 `Ctrl/Cmd + V`、§4.1 画布空白右键「粘贴」）。
     *
     * 与 `node.duplicate` 的关键差别：载荷自带完整节点，不要求原件还在图里——
     * 所以「复制 → 删原件 → 粘贴」照样成立，也能跨项目粘。
     *
     * 校验口径（比连线交互宽松，但拒绝两种会毁掉图的情况）：
     * - **id 撞车**：upsert 会把同名现有节点整个覆盖掉，等于静默丢失用户数据 → 直接失败；
     * - **父指针悬空**：`pasteNodes` 已把找不到的 parentId 归零，这里再挡一道是双保险
     *   （命令层不该假定调用方一定用了 domain 的纯函数）。
     *
     * 连线不再走 `canConnect`：剪贴板里的边两端**都在本批内**（`pasteEdges` 的口径），
     * 原图既然合法，搬过来仍是同一张子图，环与类型规则都不会被打破。这里只挡重复边。
     */
    case 'node.paste': {
      if (cmd.nodes.length === 0) fail(cmd.kind, '剪贴板为空')
      const existing = new Set(graph.nodes.map((n) => n.id))
      const incoming = new Set(cmd.nodes.map((n) => n.id))
      for (const id of incoming) {
        if (existing.has(id)) fail(cmd.kind, `粘贴的节点 id 与现有节点冲突：${id}`)
      }
      for (const n of cmd.nodes) {
        if (n.parentId && !incoming.has(n.parentId) && !existing.has(n.parentId)) {
          fail(cmd.kind, `粘贴节点的父节点不存在：${n.parentId}`)
        }
      }

      const patches: Patch[] = cmd.nodes.map((n) => ({
        op: 'upsert',
        table: 'nodes',
        // projectId 一律盖成当前项目：剪贴板可能来自另一个项目（§4.2 跨项目粘贴）
        row: { ...n, projectId: graph.projectId } as unknown as Row,
      }))

      const seen = new Set<string>()
      for (const e of cmd.edges) {
        if (!incoming.has(e.source) || !incoming.has(e.target)) continue
        const key = edgeKey(e.source, e.target, e.sourcePort, e.targetPort)
        if (seen.has(key)) continue
        if (graph.edges.some((x) => edgeKey(x.source, x.target, x.sourcePort, x.targetPort) === key)) {
          continue
        }
        seen.add(key)
        patches.push({
          op: 'upsert',
          table: 'edges',
          row: {
            id: createId('edge'),
            projectId: graph.projectId,
            source: e.source,
            target: e.target,
            ...(e.sourcePort && e.sourcePort !== DEFAULT_SOURCE_PORT ? { sourcePort: e.sourcePort } : {}),
            ...(e.targetPort && e.targetPort !== DEFAULT_TARGET_PORT ? { targetPort: e.targetPort } : {}),
          } as unknown as Row,
        })
      }

      return {
        patches,
        transaction: {
          mode: 'standalone',
          label: cmd.nodes.length > 1 ? `粘贴 ${cmd.nodes.length} 个节点` : '粘贴节点',
        },
      }
    }

    /**
     * Agent 落计划（设计文档 §3 / §5）。
     *
     * 与 `node.paste` 的两点实质差别（见命令类型上的注释）：
     * ① 连线允许一端指向**画布上已有的节点**（复用素材节点的场景）；
     * ② 连线是模型生成的，**必须逐条过 `canConnect`**，不能像 paste 那样跳过校验。
     *
     * 整批一个 standalone 事务 ⇒ **一次撤销全部回退**。
     */
    case 'agent.applyPlan': {
      if (cmd.nodes.length === 0) fail(cmd.kind, '计划里没有要建的节点')
      const existing = new Set(graph.nodes.map((n) => n.id))
      for (const n of cmd.nodes) {
        if (existing.has(n.id)) fail(cmd.kind, `计划要建的节点 id 与现有节点冲突：${n.id}`)
      }

      const patches: Patch[] = cmd.nodes.map((n) => ({
        op: 'upsert',
        table: 'nodes',
        row: { ...n, projectId: graph.projectId } as unknown as Row,
      }))

      /**
       * 连线校验要用**含新节点的图**：`canConnect` 看的是上下游类型与端口，
       * 只拿旧图去验，新节点之间的边会一律被判成「端点不存在」。
       */
      const virtual: GraphSnapshot = { ...graph, nodes: [...graph.nodes, ...cmd.nodes] }
      const byId = new Map(virtual.nodes.map((n) => [n.id, n]))
      const seen = new Set<string>()
      for (const e of cmd.edges) {
        const source = byId.get(e.source)
        const target = byId.get(e.target)
        if (!source) fail(cmd.kind, `连线的起点不存在：${e.source}`)
        if (!target) fail(cmd.kind, `连线的终点不存在：${e.target}`)
        const check = canConnect(source, target, virtual, {
          sourcePort: e.sourcePort,
          targetPort: e.targetPort,
        })
        if (!check.ok) fail(cmd.kind, `连线 ${e.source}→${e.target} 不合法：${check.reason}`)
        const key = edgeKey(e.source, e.target, e.sourcePort, e.targetPort)
        if (seen.has(key)) continue
        if (graph.edges.some((x) => edgeKey(x.source, x.target, x.sourcePort, x.targetPort) === key)) {
          continue
        }
        seen.add(key)
        patches.push({
          op: 'upsert',
          table: 'edges',
          row: {
            id: createId('edge'),
            projectId: graph.projectId,
            source: e.source,
            target: e.target,
            ...(e.sourcePort && e.sourcePort !== DEFAULT_SOURCE_PORT ? { sourcePort: e.sourcePort } : {}),
            ...(e.targetPort && e.targetPort !== DEFAULT_TARGET_PORT ? { targetPort: e.targetPort } : {}),
          } as unknown as Row,
        })
      }

      return {
        patches,
        transaction: { mode: 'standalone', label: `Agent 落地 ${cmd.nodes.length} 个节点` },
      }
    }

    /**
     * 删除节点（§6.20 Delete / Backspace、§4.1 右键「删除」）。
     *
     * 一次 dispatch 处理全部级联：待删节点的后代、相连连线、结果组引用。
     * 用 standalone 事务 —— 整组删除是一步操作，一步撤销应整组恢复。
     */
    case 'node.delete': {
      const doomed = new Set<string>()
      const walk = (id: string) => {
        if (doomed.has(id)) return
        doomed.add(id)
        for (const n of graph.nodes) if (n.parentId === id) walk(n.id)
      }
      for (const id of cmd.ids) {
        if (!findNode(graph, id)) fail(cmd.kind, `节点不存在：${id}`)
        walk(id)
      }

      const patches: Patch[] = []
      for (const id of doomed) patches.push({ op: 'delete', table: 'nodes', id })

      for (const e of graph.edges) {
        if (doomed.has(e.source) || doomed.has(e.target)) {
          patches.push({ op: 'delete', table: 'edges', id: e.id })
        }
      }

      /*
       * 少了子节点的容器要**重新贴合内容**（自适应是两个方向，同 `node.reparent`）：
       * 顺手把 `data.childIds` 里的死引用清掉——留着它虽不致命（渲染按图为准），
       * 但会让"子清单"越攒越长，将来按它做批量操作就会读到幽灵 id。
       */
      for (const c of graph.nodes) {
        if (doomed.has(c.id) || !CONTAINER_TYPES.has(c.type)) continue
        const goneKids = graph.nodes.filter((n) => n.parentId === c.id && doomed.has(n.id))
        if (goneKids.length === 0) continue
        const changes: Record<string, unknown> = {
          data: { ...c.data, childIds: ((c.data as Partial<GroupData>).childIds ?? []).filter((id) => !doomed.has(id)) },
        }
        patches.push({ op: 'patch', table: 'nodes', id: c.id, changes })
        const left = graph.nodes.filter((n) => n.parentId === c.id && !doomed.has(n.id))
        if (c.type === 'group') {
          /** 组：按剩下的孩子重新收紧（可能连原点一起挪），与 `node.reparent` 同一份实现 */
          refitGroupPatches(patches, c, left)
        } else {
          batchFitPatches(patches, c, left.length + goneKids.length, left.length)
        }
      }

      return {
        patches,
        transaction: {
          mode: 'standalone',
          label: doomed.size > 1 ? `删除 ${doomed.size} 个节点` : '删除节点',
        },
      }
    }

    case 'node.resize': {
      const n = findNode(graph, cmd.id)
      if (!n) fail(cmd.kind, `节点不存在：${cmd.id}`)
      const r: Rect = cmd.rect
      return {
        patches: [
          { op: 'patch', table: 'nodes', id: cmd.id, changes: { x: r.x, y: r.y, w: r.w, h: r.h } },
        ],
        transaction: { mode: 'coalesce', groupId: `resize:${cmd.id}`, label: '调整尺寸' },
      }
    }

    case 'node.rename': {
      const n = findNode(graph, cmd.id)
      if (!n) fail(cmd.kind, `节点不存在：${cmd.id}`)
      return {
        patches: [{ op: 'patch', table: 'nodes', id: cmd.id, changes: { title: cmd.title } }],
        transaction: { mode: 'standalone', label: '重命名节点' },
      }
    }

    case 'node.setDisabled': {
      const patches: Patch[] = []
      for (const id of cmd.ids) {
        const n = findNode(graph, id)
        if (!n) fail(cmd.kind, `节点不存在：${id}`)
        /* 同值不写：一次多选里已经禁用的那些不该制造无意义的补丁 */
        if (n.disabled === cmd.disabled) continue
        patches.push({ op: 'patch', table: 'nodes', id, changes: { disabled: cmd.disabled } })
      }
      return {
        patches,
        transaction: { mode: 'standalone', label: cmd.disabled ? '禁用节点' : '启用节点' },
      }
    }

    case 'node.updateData': {
      const n = findNode(graph, cmd.id)
      if (!n) fail(cmd.kind, `节点不存在：${cmd.id}`)
      const data = { ...n.data, ...cmd.patch } as NodeData
      const changes: Record<string, unknown> = { data }
      if (cmd.size) {
        changes.w = cmd.size.w
        changes.h = cmd.size.h
      }
      return {
        patches: [{ op: 'patch', table: 'nodes', id: cmd.id, changes }],
        transaction: cmd.transient
          ? { mode: 'silent' }
          : { mode: 'standalone', label: '修改参数' },
      }
    }

    case 'node.refitContainer': {
      const c = findNode(graph, cmd.id)
      if (!c) fail(cmd.kind, `容器不存在：${cmd.id}`)
      if (!CONTAINER_TYPES.has(c.type)) fail(cmd.kind, `${c.type} 不是容器`)
      const kids = graph.nodes.filter((n) => n.parentId === c.id)
      const patches: Patch[] = []
      if (c.type === 'group') {
        refitGroupPatches(patches, c, kids, cmd.mode ?? 'hug')
      } else {
        /**
         * 批量：单元是固定网格 ⇒ 尺寸只有两档含义 ——
         * `hug`（自动路径）**只长不缩**（手工放大的框不许被按回去），
         * `tight`（手动「整理节点」）才回到网格尺寸。
         */
        const fit = containerMinSize('batch', kids.length)
        const next =
          cmd.mode === 'tight'
            ? fit
            : { w: Math.max(c.w, fit.w), h: Math.max(c.h, fit.h) }
        if (c.w !== next.w || c.h !== next.h) {
          patches.push({ op: 'patch', table: 'nodes', id: c.id, changes: { w: next.w, h: next.h } })
        }
      }
      /**
       * 本来就已经贴合 ⇒ 一条补丁都不发，并且**别往撤销栈里压一条空记录**
       * （自动路径每次拖动松手都会调它）。
       */
      return {
        patches,
        transaction: patches.length === 0
          ? { mode: 'silent' }
          : { mode: 'standalone', label: cmd.mode === 'tight' ? '整理节点' : '贴合容器' },
      }
    }

    case 'node.reparent': {
      const node = findNode(graph, cmd.id)
      if (!node) fail(cmd.kind, `节点不存在：${cmd.id}`)
      const toParent = cmd.toParent ? findNode(graph, cmd.toParent) ?? null : null
      const check = canReparent(node, toParent, graph)
      if (!check.ok) fail(cmd.kind, check.reason)
      const converted = applyReparent(node, cmd.toParent, graph)
      /**
       * `at`：**容器给的落位**（只有批量用得上）。
       *
       * 批量的位置语义是"格位"（3×3 网格，行优先），不是"画布上的位置" ——
       * 世界位置不变那条口径对它没意义：拖进批量就该**吸到空位**。
       * 用户第 15 批 #335-③ 的"拖动看不见"根因也在这：只有把格位写进子节点坐标，
       * 视图才能用"坐标 − 格位"算出拖动位移。分组不吃这一套（它要保持画布位置）。
       */
      const moved =
        cmd.at && toParent?.type === 'batch'
          ? { ...converted, x: cmd.at.x, y: cmd.at.y }
          : converted
      /**
       * 结果组下线后，`parentId` 只剩**容器节点**（分组 / 批量）一种含义，
       * 而容器是**真节点**，`applyReparent` 在节点表里查得到它、会自己换算坐标。
       * 昔日「结果组不是节点、要手工补世界偏移」那一段随之删除——
       * 留着它会拿着 `undefined` 的组原点去加，把一个不存在的偏移算进坐标。
       */
      const patches: Patch[] = [
        {
          op: 'upsert',
          table: 'nodes',
          row: {
            ...node,
            x: moved.x,
            y: moved.y,
            parentId: moved.parentId,
          } as unknown as Row,
        },
      ]
      // 容器的子节点清单维护到 data.childIds（§6.11 / §6.12 的 3×3 排序依据）
      const containerOf = (id: string | null) => {
        if (!id) return null
        const n = findNode(graph, id)
        return n && CONTAINER_TYPES.has(n.type) ? n : null
      }
      /** 容器子清单：缺失时按空处理 */
      const childIdsOf = (n: NodeSnapshot): string[] =>
        (n.data as Partial<GroupData>).childIds ?? []
      /** 容器当前的子节点（图为准；`exclude` 用来排除正在移动的那个） */
      const kidsOf = (containerId: string, exclude?: string) =>
        graph.nodes.filter((n) => n.parentId === containerId && n.id !== exclude)
      const from = containerOf(node.parentId)
      const to = containerOf(moved.parentId)
      if (from && from.id !== moved.parentId) {
        const remaining = childIdsOf(from).filter((cid) => cid !== cmd.id)
        const changes: Record<string, unknown> = { data: { ...from.data, childIds: remaining } }
        /*
         * 容器随内容**收缩**（自适应是两个方向，用户 2026-10-06 第 13 批第 7 条）。
         *
         * 只收**自动尺寸**的框：手里这个尺寸等于"上一个子节点数对应的贴内容尺寸"⇒ 它是自动长出来的，
         * 少一个子节点就该收回去。手工拖过（打组那个"包住内容"的包装框、用户自己拖大的框）
         * 一律不动 —— 否则"打组"刚算好的包装框会在第一个子节点 reparent 时被压成 240×200。
         */
        patches.push({
          op: 'patch',
          table: 'nodes',
          id: from.id,
          changes,
        })
        if (from.type === 'group') {
          /** 组：把框收紧（可能连原点一起挪）—— 位置与尺寸都由孩子们的包围盒算 */
          refitGroupPatches(patches, from, kidsOf(from.id, cmd.id))
        } else {
          batchFitPatches(patches, from, kidsOf(from.id, cmd.id).length + 1, kidsOf(from.id, cmd.id).length)
        }
      }
      if (to) {
        const current = childIdsOf(to)
        if (!current.includes(cmd.id)) {
          // 批量节点：子清单变化时同步 contentType（§6.12「二选一」，由 canReparent 已保证同类）
          const nextData: Record<string, unknown> = { ...to.data, childIds: [...current, cmd.id] }
          if (to.type === 'batch' && (node.type === 'prompt' || node.type === 'generation')) {
            nextData.contentType = node.type === 'prompt' ? 'prompt' : 'media'
          }
          patches.push({
            op: 'patch',
            table: 'nodes',
            id: to.id,
            changes: { data: nextData },
          })
        }
        /*
         * 容器**贴住内容**（§6.11 / §6.12「有内容时按当前网格动态算尺寸」）：
         * 尺寸 = 内容 + 四边等距 20px（`containerMinSize`）。
         *
         * ⚠️ **每次都贴**（2026-10-06 第 14 批第 2 条改）：原来只"放大不缩小"，
         * 于是"打组/收进批量时那个包住内容的包装框"会一直留着 —— 用户实测：
         * 两个节点进批量（其中一个还是 944×1655 的长图），框按包装框算成很高，
         * 网格内容却只有 456×200 ⇒ **下方空一大片**。
         * 现在子节点增删一律把框收到贴合尺寸；手工拖大的框会在下次增删时收回
         *（这是"自适应"的定义，功能栏的「排列与整理」也能随时手动贴回）。
         */
        if (to.type === 'group') {
          /**
           * 组：框＝孩子们的包围盒 + 四边等距。被拖进来的那个用**它换算后的 local 坐标**
           * （`moved`）参与计算 —— 于是"拖进去落在哪就是哪"，不会被吸附或网格挪走。
           */
          refitGroupPatches(patches, to, [
            ...kidsOf(to.id, cmd.id),
            { id: cmd.id, x: moved.x, y: moved.y, w: node.w, h: node.h },
          ])
        } else {
          batchFitPatches(patches, to, kidsOf(to.id, cmd.id).length, kidsOf(to.id, cmd.id).length + 1)
        }
      }
      /**
       * 连线：**打组不动连线**（用户 2026-10-06 第 14 批第 1 条：
       * 「原本在画布中是什么位置，什么连线就是什么连线」）——
       * 进组 / 出组之后，原来连的那条边还在原处，只是端点跟着节点走。
       *
       * 批量仍按旧口径清连线：它是"集合"，成员带着自己的边进去会让"集合项"的语义含糊
       *（§6.12 的口径是集合本体打包成一项，成员的边另有出处）。
       */
      const touchesGroup = from?.type === 'group' || to?.type === 'group'
      for (const eid of touchesGroup ? [] : edgesToDropOnReparent(cmd.id, graph.edges)) {
        patches.push({ op: 'delete', table: 'edges', id: eid })
      }
      return { patches, transaction: { mode: 'standalone', label: '移动归属' } }
    }

    case 'edge.connect': {
      const source = findNode(graph, cmd.source)
      const target = findNode(graph, cmd.target)
      if (!source) fail(cmd.kind, `源节点不存在：${cmd.source}`)
      if (!target) fail(cmd.kind, `目标节点不存在：${cmd.target}`)
      const check = canConnect(source, target, graph, {
        sourcePort: cmd.sourcePort,
        targetPort: cmd.targetPort,
      })
      if (!check.ok) fail(cmd.kind, check.reason)
      const edge = {
        id: createId('edge'),
        projectId: graph.projectId,
        source: cmd.source,
        target: cmd.target,
        // 缺省口不写字段：老数据与绝大多数新边因此长得完全一样（少一份要维护的形状）
        ...(cmd.sourcePort && cmd.sourcePort !== DEFAULT_SOURCE_PORT ? { sourcePort: cmd.sourcePort } : {}),
        ...(cmd.targetPort && cmd.targetPort !== DEFAULT_TARGET_PORT ? { targetPort: cmd.targetPort } : {}),
      }
      return {
        patches: [{ op: 'upsert', table: 'edges', row: edge }],
        transaction: { mode: 'standalone', label: '连接节点' },
      }
    }

    case 'edge.remove': {
      return {
        patches: [{ op: 'delete', table: 'edges', id: cmd.id }],
        transaction: { mode: 'standalone', label: '删除连线' },
      }
    }

    case 'container.reorder': {
      const c = findNode(graph, cmd.containerId)
      if (!c) fail(cmd.kind, `容器不存在：${cmd.containerId}`)
      return {
        patches: [
          {
            op: 'patch',
            table: 'nodes',
            id: cmd.containerId,
            changes: { data: { ...c.data, childIds: cmd.orderedChildIds } },
          },
        ],
        transaction: { mode: 'standalone', label: '调整顺序' },
      }
    }

    case 'asset.put': {
      /**
       * 媒体本体写 assets 表（content-addressable，hash 主键）；不进撤销栈
       * （派生媒体，删除版本历史时由结果组级联）。
       * assets 表的 Dexie 主键是 `id`，这里把 hash 同时落到 id 上（产品文档 §8：id 即内容哈希）。
       *
       * `createdAt` / `projectId` 透传（素材库的排序与来源靠它们）。
       * **两者都允许缺**：老素材没有这两个字段，由 `toLibraryAssets` 回落 ——
       * 这里不补默认值，因为命令层没有「现在几点」之外的真相
       * （缺就是缺，补一个假时间比不补更糟）。
       */
      const row = { ...cmd.asset, id: cmd.asset.hash } as unknown as Row
      return {
        patches: [{ op: 'upsert', table: 'assets', row }],
        transaction: { mode: 'silent' },
      }
    }

    case 'node.runRecord.append': {
      // 版本历史「从不删除」（产品文档 §6.21）→ 不进撤销栈：撤销一次生成不该删掉它的历史
      // 只落 runRecords 表，图快照本身不变（applyGraphPatches 不路由非图表）
      // record.nodeId 以命令层的 nodeId 为准（落位改到承载节点时两者可能不同），
      // 否则历史会挂在源节点名下、而真正收图的节点查不到这条记录。
      const row = { ...(cmd.record as unknown as Record<string, unknown>), nodeId: cmd.nodeId }
      return {
        patches: [{ op: 'upsert', table: 'runRecords', row: row as unknown as Row }],
        transaction: { mode: 'silent' },
      }
    }


    case 'runPlan.execute': {
      // 执行计划的图数据化形态：落 tasks 表，供中断恢复与日志查询（架构 §4.3）
      const row = {
        id: cmd.planId,
        projectId: graph.projectId,
        scope: cmd.scope,
        mode: cmd.mode,
        originNodeId: cmd.originNodeId ?? null,
        state: 'running',
        createdAt: cmd.createdAt ?? Date.now(),
      }
      return {
        patches: [{ op: 'upsert', table: 'tasks', row: row as unknown as Row }],
        transaction: { mode: 'silent' },
      }
    }

    case 'runPlan.cancel': {
      // M0 简化：tasks 表尚未纳入 store，reducer 拿不到原行，取消只能整行覆盖写。
      // 等 tasks 表进 store 后改为合并写（见交接本第 4 组偏差记录）。
      return {
        patches: [
          {
            op: 'upsert',
            table: 'tasks',
            row: {
              id: cmd.runPlanId,
              state: 'canceled',
              canceledAt: cmd.at ?? Date.now(),
            } as unknown as Row,
          },
        ],
        transaction: { mode: 'silent' },
      }
    }

    default:
      fail((cmd as Command).kind, 'M0 阶段未实现')
  }
}

/** 纯函数命令处理器：返回正向补丁、逆向补丁、事务边界、持久化计划与变更后的图 */
export function reduce(cmd: Command, graph: GraphSnapshot): ReduceOutput {
  const { patches, transaction } = handle(cmd, graph)
  const next = applyGraphPatches(graph, patches)
  const inverse = invertGraphPatches(graph, patches)
  const persist = toPersistPlan(patches, next)
  return { result: { patches, inverse, transaction, persist }, next }
}
