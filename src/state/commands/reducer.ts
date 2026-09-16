import type { Command } from './index'
import type { CommandResult, TransactionBoundary } from '../shared/types'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeData, GroupData, GenerationData } from '../../domain/canvas/model/node'
import { CONTAINER_TYPES } from '../../domain/canvas/model/node'
import type { ResultGroup } from '../../domain/canvas/model/resultGroup'
import type { Patch, Row } from '../../domain/patch/types'
import type { Rect } from '../../domain/canvas/geometry/rect'
import { invertPatches } from '../../domain/patch/apply'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import { canConnect } from '../../domain/canvas/graph/canConnect'
import { canReparent, applyReparent, edgesToDropOnReparent } from '../../domain/canvas/graph/reparent'
import { createId } from '../../shared/id'
import { toPersistPlan, applyGraphPatches } from '../workbenches/canvas/persist'
import { layoutResultGroup, resultGroupCells } from '../../domain/canvas/layout/resultGroupLayout'
import { RESULT_CELL } from '../../domain/canvas/layout/constants'
import { naturalNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { worldToLocal } from '../../domain/canvas/geometry/coords'
import { containerMinSize } from '../../domain/canvas/layout/packContainer'

export interface ReduceOutput {
  result: CommandResult
  next: GraphSnapshot
}

function findNode(graph: GraphSnapshot, id: string): NodeSnapshot | undefined {
  return graph.nodes.find((n) => n.id === id)
}

function fail(kind: Command['kind'], reason: string): never {
  throw new Error(`[command ${kind}] ${reason}`)
}

/**
 * 结果组内**剩余**子结果重排（§6.9）。
 *
 * 组内格位是**算出来的**（`resultGroupCells`），不是用户摆出来的。子结果被拖出、被删除后
 * 若不管其余节点，组内就永久留一个洞 —— 看起来像「少了一张」或「随机空了一格」。
 *
 * 容器尺寸**刻意不动**：它由来源节点与当初的张数撑开，收缩会牵动折叠框与既有几何，
 * 留白比跳变安全。因此 N=4 拖走一张后是「3 张紧凑 + 一块留白」，而不是整框缩水。
 */
function reflowResultGroup(
  rg: ResultGroup,
  childIds: readonly string[],
  graph: GraphSnapshot,
): Patch[] {
  const cells = resultGroupCells({
    containerRect: { x: 0, y: 0, w: rg.w, h: rg.h },
    count: childIds.length,
    cell: RESULT_CELL,
  })
  const out: Patch[] = []
  childIds.forEach((cid, i) => {
    const child = findNode(graph, cid)
    const cell = cells[i]
    if (!child || !cell) return
    if (child.x === cell.x && child.y === cell.y) return
    out.push({ op: 'patch', table: 'nodes', id: cid, changes: { x: cell.x, y: cell.y } })
  })
  return out
}

/** 跨表求逆：表之间相互独立，逐表调用 domain 的 invertPatches 后拼接 */
function invertGraphPatches(graph: GraphSnapshot, patches: readonly Patch[]): Patch[] {
  const inv: Patch[] = []
  for (const table of ['nodes', 'edges', 'resultGroups'] as const) {
    const tps = patches.filter((p) => p.table === table)
    if (!tps.length) continue
    const rows =
      table === 'nodes' ? graph.nodes : table === 'edges' ? graph.edges : graph.resultGroups
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
      // 结果组子节点：位置与尺寸由**组内格位**决定（架构 §5.3「相对结果组的 local 坐标」）。
      // 调用方给的 at 不适用（格位是算出来的，写死会与折叠/重排后的版面互相打架）。
      const parentRg = cmd.parentId
        ? graph.resultGroups.find((g) => g.id === cmd.parentId) ?? null
        : null
      const cell = parentRg
        ? resultGroupCells({
            containerRect: { x: 0, y: 0, w: parentRg.w, h: parentRg.h },
            count: parentRg.childIds.length + 1,
            cell: RESULT_CELL,
          })[parentRg.childIds.length]
        : null
      const size = cmd.size ?? cell ?? { w: spec.sizing.min.w, h: spec.sizing.min.h }
      const node: NodeSnapshot = {
        id: cmd.id ?? createId('node'),
        projectId: cmd.projectId,
        type: cmd.type,
        parentId: cmd.parentId ?? null,
        x: cell ? cell.x : cmd.at.x,
        y: cell ? cell.y : cmd.at.y,
        w: size.w,
        h: size.h,
        title: cmd.title ?? spec.label,
        disabled: false,
        stale: false,
        data,
      }
      const patches: Patch[] = [{ op: 'upsert', table: 'nodes', row: node as unknown as Row }]
      // 结果组子节点：以 parentId 归属，把本节点加入结果组的 childIds（架构 §6.9）
      if (parentRg) {
        patches.push({
          op: 'patch',
          table: 'resultGroups',
          id: parentRg.id,
          changes: { childIds: [...parentRg.childIds, node.id] },
        })
      }
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
        const copy: NodeSnapshot = {
          ...src,
          id: cmd.newIds[i],
          x: src.x + dx,
          y: src.y + dy,
          // 数据深拷贝：避免副本与原节点共享同一个 data 对象引用
          data: structuredClone(src.data),
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
          if (!canConnect(sn, tn, graph).ok) continue
          patches.push({
            op: 'upsert',
            table: 'edges',
            row: {
              id: createId('edge'),
              projectId: graph.projectId,
              source,
              target,
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
        const key = `${e.source}->${e.target}`
        if (seen.has(key)) continue
        if (graph.edges.some((x) => x.source === e.source && x.target === e.target)) continue
        seen.add(key)
        patches.push({
          op: 'upsert',
          table: 'edges',
          row: {
            id: createId('edge'),
            projectId: graph.projectId,
            source: e.source,
            target: e.target,
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

      // 结果组：childIds 是派生索引，节点删了必须同步，否则留下空壳组
      for (const rg of graph.resultGroups) {
        if (!rg.childIds.some((cid) => doomed.has(cid))) continue
        const childIds = rg.childIds.filter((cid) => !doomed.has(cid))
        if (childIds.length === 0) {
          patches.push({ op: 'delete', table: 'resultGroups', id: rg.id })
        } else {
          patches.push({ op: 'patch', table: 'resultGroups', id: rg.id, changes: { childIds } })
          // 剩下的往前补齐，不在原处留洞（§6.9「格位是算出来的」）
          patches.push(...reflowResultGroup(rg, childIds, graph))
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

    case 'node.reparent': {
      const node = findNode(graph, cmd.id)
      if (!node) fail(cmd.kind, `节点不存在：${cmd.id}`)
      const toParent = cmd.toParent ? findNode(graph, cmd.toParent) ?? null : null
      const check = canReparent(node, toParent, graph)
      if (!check.ok) fail(cmd.kind, check.reason)
      const moved = applyReparent(node, cmd.toParent, graph)
      /**
       * 离开**结果组**要额外做三件事（§6.16 / 架构 §5.3）。
       *
       * 结果组不是节点，`applyReparent` 在节点表里查不到它，于是既不会补上
       * 组的世界偏移、也不会摘掉 `childIds` —— 拖出来的节点会：① 落在错误坐标
       * （local 被当 world）；② 在组里留一个空格位、且被组与根层**画两遍**。
       */
      const fromRg = node.parentId
        ? graph.resultGroups.find((g) => g.id === node.parentId) ?? null
        : null
      const leavingGroup = !!fromRg && moved.parentId !== fromRg.id
      // local → world：结果组的 x/y 就是组原点（子节点存的是相对它的 local 坐标）。
      // 其余情形 applyReparent 已经换好了，照用即可（再换一次会二次偏移）。
      const placed = leavingGroup
        ? toParent
          ? worldToLocal({ x: node.x + fromRg!.x, y: node.y + fromRg!.y }, toParent)
          : { x: node.x + fromRg!.x, y: node.y + fromRg!.y }
        : { x: moved.x, y: moved.y }
      const patches: Patch[] = [
        {
          op: 'upsert',
          table: 'nodes',
          row: {
            ...node,
            x: placed.x,
            y: placed.y,
            parentId: moved.parentId,
            // 出了容器就恢复产物真实比例（进了容器才让渡比例，§6.16）
            ...(leavingGroup ? naturalNodeSize(node.data as GenerationData, node.type) ?? {} : {}),
          } as unknown as Row,
        },
      ]
      if (leavingGroup) {
        const childIds = fromRg!.childIds.filter((cid) => cid !== cmd.id)
        // 组里空了就一并删掉：与 node.delete 同口径，不留「0 张结果」的空壳
        patches.push(
          childIds.length === 0
            ? { op: 'delete', table: 'resultGroups', id: fromRg!.id }
            : { op: 'patch', table: 'resultGroups', id: fromRg!.id, changes: { childIds } },
        )
        // 被取走的那格由后面的结果补上（§6.9「格位是算出来的」）
        patches.push(...reflowResultGroup(fromRg!, childIds, graph))
      }
      // 容器的子节点清单同时维护到 data.childIds（§6.11 / §6.12 的 3×3 排序依据）。
      // 结果组的子节点清单在 resultGroups 表，不走这里。
      const containerOf = (id: string | null) => {
        if (!id) return null
        const n = findNode(graph, id)
        return n && CONTAINER_TYPES.has(n.type) ? n : null
      }
      /** 容器子清单：画板的 data 里没有 childIds（不需要排序），缺失时按空处理 */
      const childIdsOf = (n: NodeSnapshot): string[] =>
        (n.data as Partial<GroupData>).childIds ?? []
      const from = containerOf(node.parentId)
      const to = containerOf(moved.parentId)
      if (from && from.id !== moved.parentId) {
        const remaining = childIdsOf(from).filter((cid) => cid !== cmd.id)
        patches.push({
          op: 'patch',
          table: 'nodes',
          id: from.id,
          changes: { data: { ...from.data, childIds: remaining } },
        })
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
        // 容器长大到装得下新的子节点（§6.11 / §6.12「有内容时按当前网格动态提高最小尺寸」）。
        // 这里只「放大不缩小」，缩小留给用户拖手柄（否则手柄一拖就被命令层拉回去）。
        if (to.type === 'group' || to.type === 'batch') {
          const childCount = graph.nodes.filter((n) => n.parentId === to.id && n.id !== cmd.id).length + 1
          const min = containerMinSize(to.type, childCount)
          if (to.w < min.w || to.h < min.h) {
            patches.push({
              op: 'patch',
              table: 'nodes',
              id: to.id,
              changes: { w: Math.max(to.w, min.w), h: Math.max(to.h, min.h) },
            })
          }
        }
      }
      for (const eid of edgesToDropOnReparent(cmd.id, graph.edges)) {
        patches.push({ op: 'delete', table: 'edges', id: eid })
      }
      return { patches, transaction: { mode: 'standalone', label: '移动归属' } }
    }

    case 'edge.connect': {
      const source = findNode(graph, cmd.source)
      const target = findNode(graph, cmd.target)
      if (!source) fail(cmd.kind, `源节点不存在：${cmd.source}`)
      if (!target) fail(cmd.kind, `目标节点不存在：${cmd.target}`)
      const check = canConnect(source, target, graph)
      if (!check.ok) fail(cmd.kind, check.reason)
      const edge = {
        id: createId('edge'),
        projectId: graph.projectId,
        source: cmd.source,
        target: cmd.target,
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

    case 'resultGroup.create': {
      const src = findNode(graph, cmd.sourceNodeId)
      if (!src) fail(cmd.kind, `来源节点不存在：${cmd.sourceNodeId}`)
      // 落位由 domain/layout 算好；未显式传 rect 时按默认单元尺寸自算（架构 §5.5「执行器只按坐标提交命令」）
      const layout = layoutResultGroup({
        sourceRect: { x: src.x, y: src.y, w: src.w, h: src.h },
        count: Math.max(1, cmd.count),
        cell: RESULT_CELL,
      })
      const rect = cmd.rect ?? layout.containerRect
      const rg: ResultGroup = {
        id: cmd.id ?? createId('rg'),
        projectId: graph.projectId,
        sourceNodeId: cmd.sourceNodeId,
        taskId: cmd.taskId,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        childIds: [],
        collapsed: false,
        createdAt: cmd.createdAt ?? Date.now(),
        summary: { success: 0, failed: 0 },
      }
      return {
        patches: [{ op: 'upsert', table: 'resultGroups', row: rg as unknown as Row }],
        transaction: { mode: 'standalone', label: '生成结果组' },
      }
    }

    case 'resultGroup.setCollapsed': {
      const rg = graph.resultGroups.find((g) => g.id === cmd.id)
      if (!rg) fail(cmd.kind, `结果组不存在：${cmd.id}`)
      return {
        patches: [
          { op: 'patch', table: 'resultGroups', id: cmd.id, changes: { collapsed: cmd.collapsed } },
        ],
        transaction: { mode: 'standalone', label: cmd.collapsed ? '折叠结果组' : '展开结果组' },
      }
    }

    case 'asset.put': {
      // 媒体本体写 assets 表（content-addressable，hash 主键）；不进撤销栈（派生媒体，删除版本历史时由结果组级联）
      // assets 表的 Dexie 主键是 `id`，这里把 hash 同时落到 id 上（产品文档 §8：id 即内容哈希）
      const row = { ...cmd.asset, id: cmd.asset.hash } as unknown as Row
      return {
        patches: [{ op: 'upsert', table: 'assets', row }],
        transaction: { mode: 'silent' },
      }
    }

    case 'resultGroup.dissolve': {
      const rg = graph.resultGroups.find((g) => g.id === cmd.id)
      if (!rg) fail(cmd.kind, `结果组不存在：${cmd.id}`)
      const patches: Patch[] = [{ op: 'delete', table: 'resultGroups', id: cmd.id }]
      if (cmd.withResults) {
        const edgeIds = new Set(
          graph.edges.filter((e) => rg.childIds.includes(e.source) || rg.childIds.includes(e.target)).map((e) => e.id),
        )
        for (const cid of rg.childIds) patches.push({ op: 'delete', table: 'nodes', id: cid })
        for (const eid of edgeIds) patches.push({ op: 'delete', table: 'edges', id: eid })
      }
      return { patches, transaction: { mode: 'standalone', label: '解散结果组' } }
    }

    case 'stale.mark':
    case 'stale.clear': {
      const value = cmd.kind === 'stale.mark'
      const patches: Patch[] = cmd.nodeIds.map((id) => ({
        op: 'patch',
        table: 'nodes',
        id,
        changes: { stale: value },
      }))
      // 陈旧标记走命令但不进撤销栈（派生视觉状态）；仍随 persist 落库
      return { patches, transaction: { mode: 'silent' } }
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

    case 'node.runRecord.restore': {
      const n = findNode(graph, cmd.nodeId)
      if (!n) fail(cmd.kind, `节点不存在：${cmd.nodeId}`)
      return {
        patches: [
          {
            op: 'patch',
            table: 'nodes',
            id: cmd.nodeId,
            changes: { data: { ...n.data, ...cmd.record.params } },
          },
        ],
        transaction: { mode: 'standalone', label: '恢复历史版本' },
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
