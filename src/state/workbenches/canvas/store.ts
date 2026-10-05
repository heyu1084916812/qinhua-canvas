import { createStore as createVanilla } from 'zustand/vanilla'
import type { AppStore, CommandResult, TransactionBoundary } from '../../shared/types'

/**
 * zustand 5 的 createStore 类型（Mutate / StoreMutators 条件类型）与本项目装好的
 * TypeScript 6 泛型推断冲突，直接调用会报「Expected 2 arguments」类错误。
 * 这里把它收敛成一个等价的极简工厂签名（运行时仍是 zustand，行为一致）。
 */
type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}
type StoreFactory = <T>(init: () => T) => MiniStore<T>
const createVanillaStore = createVanilla as unknown as StoreFactory
import type { Command } from '../../commands'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Patch, PersistPlan, TableName } from '../../../domain/patch/types'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { LinkSide } from '../../../domain/canvas/menu/linkMenu'
import { createId } from '../../../shared/id'
import { reduce } from '../../commands/reducer'
import { clampZoom } from '../../../domain/canvas/geometry/transform'
import { applyGraphPatches, toPersistPlan } from './persist'
import type { PlatformKit, Row } from '../../../platform/ports'
import { mirrorAssetsToFolder } from '../../../platform/assetMirror'
import { ensureAssetThumb, needsThumb, rowBytesBlob } from '../../../platform/assetThumb'

export interface CanvasStoreOptions {
  platform: PlatformKit
  projectId: string
  initial?: GraphSnapshot
  debounceMs?: number
}

interface UndoGroup {
  key: string
  label: string
  forward: Patch[] // 正向补丁（redo 用）
  inverse: Patch[] // 逆向补丁（undo 用，应用前需逆序）
}

interface CanvasState {
  graph: GraphSnapshot
  undoStack: UndoGroup[]
  redoStack: UndoGroup[]
  selection: string[]
  /** 被单击选中的连线（产品文档 §6.14：进入可删除状态）；与节点选择互斥 */
  selectedEdgeIds: string[]
  viewport: Viewport
  /**
   * 画布级瞬时提示（§6.12「另一种类型拖入被拒绝并给出弱提示」/ §6.10 对比超 2 张）。
   * 纯展示态：不进撤销栈、不落库，由 UI 侧计时自动清除。
   */
  notice: { id: string; text: string } | null
  /**
   * 是否正在拖动节点（§6.15「拖动期间…创作参数面板立即隐藏」）。
   * 纯展示态：不进撤销栈、不落库。
   */
  dragging: boolean
  /**
   * 面板是否因**真实拖动**被收起（§6.15）。
   *
   * 与 `dragging` 的分工：`dragging` 只管「进行中」；这个标记管「拖过之后的后遗症」——
   * 发生过位移的拖动，松手后面板**保持隐藏**，直到下一次显式选中（`setSelection`）
   * 才复位。没有它，松手瞬间 `dragging` 归 false 面板就会弹回来，而节点还停在
   * 拖后的位置上，视觉上面板「追着人跑」。
   * 纯展示态：不进撤销栈、不落库。
   */
  panelDismissed: boolean
  /**
   * 右键菜单（§4.1）。纯展示态：不进撤销栈、不落库。
   * 坐标是**屏幕坐标**（菜单浮层不随画布变换，与创作面板 §6.8 同理）。
   * `target` 决定菜单项：node = 节点菜单，canvas = 画布空白菜单。
   */
  menu: { x: number; y: number; target: { kind: 'node'; nodeId: string } | { kind: 'canvas' } } | null
  /**
   * 端点拖线在**空白处松手**弹出的可连接菜单（§6.14「空白松手菜单」）。
   *
   * 与右键菜单 `menu` 刻意分成两个字段：两者长得像，但**生命周期完全不同**——
   * 右键菜单要点外部 / Esc / 滚动才关，这个是指针一离开就关（§6.14），
   * 且锚点是「指针右侧 12px」而不是指针本身。合成一个字段就得分岔出
   * `kind` 两套关闭条件，读起来是省了、改起来必错。
   *
   * 坐标与 `menu` 同口径：**surface 局部屏幕坐标**（浮层不随画布变换）。
   * 纯展示态：不进撤销栈、不落库。
   */
  /**
   * 空白处松手后的「可连接菜单」。
   *
   * `also` = 这次拖拽**还要连的其它源**（多选「共有端点」拖出来的那些）。
   * 用户 2026-10-05 第 4 批：「框选多个节点新建节点然后连接，新建的节点只连接了一个上游」——
   * 根因就是 `setLinkMenu` 只记住了被拖的那一个，`also` 在这一步被丢掉。
   */
  linkMenu: {
    x: number
    y: number
    nodeId: string
    side: LinkSide
    portId?: string
    also?: string[]
  } | null
  /** 正在重命名标题的节点（§4.1 右键「重命名」/ §4.3 单击标题） */
  renamingId: string | null
  /**
   * 撤销条（§6.12「底部撤销条保留 6 秒」）：删除等可撤销操作后弹出，
   * 提供「撤销 / 重做」入口。纯展示态：不进撤销栈、不落库，由 UI 侧计时自动清除。
   */
  undoBar: { id: string; text: string } | null
  /**
   * 素材灯箱（§6.17）。纯展示态：不进撤销栈、不落库。
   *
   * 放在 store 而不是组件本地 state：触发它的两处（节点双击、日志缩略图）在
   * **不同的子树**里（画布表面 / 页面级日志面板），塞本地 state 就得把回调一路
   * 透传。它是瞬时态——关掉即忘，与 menu / notice 同口径。
   */
  /**
   * 灯箱的两种「框选模式」（值 = 发起它的那个节点 id；都不在 = 纯看图）：
   *
   * - `cropFor` = **提取选区**（§6.23）：框选 + 选比例 + 确认，确认后在原图**右侧**
   *   生成带上下文的局部图。
   * - `faceFor` = **给情绪调节框脸**（用户 2026-10-06）：框一块人脸 → 确认写进该节点的
   *   `data.faceBox`（不建任何节点）。自动识别认不出来时由面板开它。
   *
   * 两者共用同一套框选交互（拖框 / 八向手柄 / 比例吸附），只有**确认之后干什么**不同 ——
   * 所以是同一个模式的两种意图，而不是两套 UI。
   */
  lightbox: { assetHash: string; cropFor?: string; faceFor?: string } | null
  /**
   * **旋转与镜像编辑**（用户 2026-10-05 第 10 条）：作用在**刚复制出来的那个节点**上。
   *
   * 与灯箱同类瞬时态，只存 nodeId（图片本体按它的 `assetHash` 读）：关掉即忘，
   * 不落库、不进撤销栈 —— 「保存」那一下才写数据（并作为一步撤销）。
   */
  rotate: { nodeId: string } | null
  /**
   * **标注（画笔）编辑**（用户 2026-10-05 第 10 条）：画在节点的素材上，
   * 「保存」时把标注**合成进一张新图**并落到原图右侧的新节点（原图不动）。
   *
   * 同样是瞬时态：工具选择 / 笔画历史都在编辑层自己手里，关掉即忘。
   */
  annotate: { nodeId: string } | null
  /**
   * 文本编辑灯箱（产品文档 §6.7，用户 2026-09-21）：提示词正文的**大编辑框**。
   *
   * 与素材灯箱 `lightbox` 分开存，而不是合成一个联合类型：两者的**内容形态
   * 完全不同**（一个是图片 + 缩放平移，一个是文本框），共用字段只会让两边
   * 都多出一堆 `if`。但它们**互斥**——打开一个就关掉另一个，见 `openTextEditor`。
   *
   * 只存 nodeId：正文本身在 `graph` 里（编辑要走命令，进撤销栈），
   * 这里存一份副本就会出现「两份真相」。
   */
  textEditor: { nodeId: string } | null
}

export interface CanvasStore extends AppStore<GraphSnapshot, Command> {
  setSelection(ids: string[]): void
  getSelection(): string[]
  /** 选中连线（清空节点选择，二者互斥，§6.14） */
  setEdgeSelection(ids: string[]): void
  getEdgeSelection(): string[]
  setViewport(vp: Partial<Viewport>): void
  getViewport(): Viewport
  /** 测试与卸载时手动冲刷防抖持久化 */
  flush(): Promise<void>
  /**
   * 从持久化读回后整体替换图（非用户操作：不进撤销栈、不触发持久化）。
   * 由 CanvasPage 在挂载时按 projectId 从 IndexedDB 调用。
   */
  hydrate(snapshot: GraphSnapshot): void
  /** 弹出瞬时提示（弱提示）；不落库、不进撤销栈 */
  notify(text: string): void
  getNotice(): { id: string; text: string } | null
  /** 关闭提示（当前条不是预期的 id 时忽略，避免竞态误关新提示） */
  clearNotice(id?: string): void
  /** 弹出撤销条（§6.12：删除等可撤销操作后提供「撤销 / 重做」入口） */
  showUndoBar(text: string): void
  getUndoBar(): { id: string; text: string } | null
  /** 关闭撤销条（当前条不是预期的 id 时忽略，避免竞态误关新条） */
  clearUndoBar(id?: string): void
  /** 拖动进行中（§6.15：拖动期间隐藏创作参数面板） */
  setDragging(on: boolean): void
  isDragging(): boolean
  /**
   * 拖动收尾（§6.15）：发生过位移的拖动，松手后面板保持隐藏，直到下一次显式选中。
   * 由 useNodeDrag 在 pointerup 时调用；普通单击（未移动）不调用，面板照常出现。
   */
  setPanelDismissed(on: boolean): void
  isPanelDismissed(): boolean
  /** 打开右键菜单（§4.1）；坐标是屏幕坐标 */
  setMenu(
    x: number,
    y: number,
    target: { kind: 'node'; nodeId: string } | { kind: 'canvas' },
  ): void
  /** 关闭右键菜单（§4.1：Esc / 空白单击 / 滚动 / 平移时） */
  closeMenu(): void
  getMenu(): CanvasState['menu']
  /**
   * 打开连线菜单（§6.14「空白松手菜单」）：端点拖线在空白处松手时，
   * 于指针右侧 12px 打开。`side` 是被拖的那一端（output → 找下游）。
   */
  setLinkMenu(
    x: number,
    y: number,
    nodeId: string,
    side: LinkSide,
    portId?: string,
    also?: readonly string[],
  ): void
  closeLinkMenu(): void
  getLinkMenu(): CanvasState['linkMenu']
  /** 进入重命名态（§4.1 右键「重命名」/ §4.3 单击标题） */
  beginRename(nodeId: string): void
  endRename(): void
    getRenamingId(): string | null
    /** 打开 / 关闭素材灯箱（§6.17）；只存 hash，本体由灯箱自己按 hash 读回 */
  openLightbox: (assetHash: string) => void
  /** 以「提取选区」模式打开灯箱（用户口径：在素材灯箱里框选局部图） */
  openCropLightbox: (nodeId: string) => void
  openFaceLightbox: (nodeId: string) => void
  closeLightbox: () => void
  getLightbox: () => { assetHash: string; cropFor?: string; faceFor?: string } | null
  /** 打开 / 关闭「旋转与镜像」编辑（第 10 条）：打开时关闭灯箱与文本编辑框（三者互斥） */
  openRotateEditor: (nodeId: string) => void
  closeRotateEditor: () => void
  getRotate: () => { nodeId: string } | null
  /** 打开 / 关闭「标注」编辑（与灯箱、文本编辑、旋转编辑互斥） */
  openAnnotateEditor: (nodeId: string) => void
  closeAnnotateEditor: () => void
  getAnnotate: () => { nodeId: string } | null
  /** 打开 / 关闭文本编辑灯箱（§6.7）。与素材灯箱互斥 */
  openTextEditor: (nodeId: string) => void
  closeTextEditor: () => void
  getTextEditor: () => { nodeId: string } | null
  /**
   * 开启一次多步事务（架构 §5.5）：开启后到 endPlan() 之间的所有命令
   * 合并进同一个撤销单元——整次拓扑生成只占一步撤销。
   */
  beginPlan(planId: string, label: string): void
  endPlan(): void
  dispose(): void
}

/**
 * 这几张表的写入**不等防抖**，合并完立即冲刷。
 *
 * 只有 `assets`：节点拿到 `assetHash` 的那一刻 UI 就要按 hash 去读素材画出来，
 * 而 `useAsset` 只认 IndexedDB（内存里没有第二份）。素材若跟着 800ms 防抖走，
 * 就有一段**固定空窗**——用户上传完先看到空白节点；批量连传时每张的 SHA-1 /
 * 解码还会占住主线程，把防抖计时器一并推迟，空窗会长到「看起来没传上去」。
 *
 * 素材是**内容寻址的幂等 upsert**（id = 内容哈希），提前写没有副作用，
 * 故让它插队是安全的。其余表（nodes/edges/…）仍走防抖——它们写得很频繁
 * （拖动每一次指针移动都是一次 `node.move`），逐次落库才是真的卡。
 */
const URGENT_TABLES: ReadonlySet<TableName> = new Set<TableName>(['assets'])

function isUrgent(p: PersistPlan): boolean {
  return (
    p.upserts.some((u) => URGENT_TABLES.has(u.table)) ||
    p.deletes.some((d) => URGENT_TABLES.has(d.table))
  )
}

/** 持久化器：把 PersistPlan 按 800ms 防抖合并后写入 platform.storage */
function createPersister(platform: PlatformKit, debounceMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: PersistPlan = { tables: [], upserts: [], deletes: [] }
  /**
   * 冲刷**串行链**：素材插队会与被合并的其它表并发写同一批表，
   * 串起来保证「后一次看到的 pending 一定包含前一次之后的新改动」，不会交错丢写。
   */
  let chain: Promise<void> = Promise.resolve()

  const merge = (p: PersistPlan) => {
    for (const u of p.upserts) {
      const found = pending.upserts.find((x) => x.table === u.table)
      if (found) found.rows.push(...u.rows)
      else pending.upserts.push({ table: u.table, rows: [...u.rows] })
    }
    for (const d of p.deletes) {
      const found = pending.deletes.find((x) => x.table === d.table)
      if (found) found.ids.push(...d.ids)
      else pending.deletes.push({ table: d.table, ids: [...d.ids] })
    }
    pending.tables = [...new Set([...pending.tables, ...p.tables])]
  }

  /** 真正写一次：取走当前 pending 并落库（失败只记日志，绝不让 dispatch 挂掉） */
  const writeOnce = async () => {
    const plan = pending
    pending = { tables: [], upserts: [], deletes: [] }
    if (!plan.upserts.length && !plan.deletes.length) return
    /** 素材行：**落库成功后**再镜像到素材文件夹（把写盘塞进 DB 事务里是错的语义） */
    const assetRows: Row[] = []
    try {
      await platform.storage.transaction(plan.tables as TableName[], async () => {
        for (const u of plan.upserts) {
          await platform.storage.bulkPut(u.table, u.rows as never)
          if (u.table === 'assets') assetRows.push(...u.rows)
        }
        for (const d of plan.deletes) for (const id of d.ids) await platform.storage.delete(d.table, id)
      })
    } catch (err) {
      // 落库失败是数据问题（配额 / 表损坏），不该让交互链路抛异常
      console.error('[persist] flush failed', err)
      return
    }
    if (assetRows.length > 0) {
      await mirrorAssetsToFolder(platform.assetFolder, assetRows, (message, meta) =>
        platform.logger.log('warn', message, meta),
      )
      /**
       * 落库之后**顺手补一张缩略图**（对账 #232）—— 刻意**不 await**：
       * 这一行的字节刚在手上，而画布节点只显示约 240px；不补的话，每次打开项目都要按原图解码
       * （一张 4K 图 ≈ 33MB，几十张就是 GB 级）。
       *
       * 这里是**所有素材行的唯一落库出口**（用户导入与模型产物都走它），所以在这里补一次就全覆盖；
       * 生成在限流槽里排队（同时最多 2 张），一次导入几百张也不会把前台压垮。
       * 补失败什么都不做 —— 缩略图是优化，不是功能。
       */
      for (const row of assetRows) {
        if (!needsThumb(row)) continue
        const blob = rowBytesBlob(row)
        if (blob) void ensureAssetThumb(platform, row, blob)
      }
    }
  }

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    chain = chain.then(writeOnce)
    return chain
  }

  const schedule = (p: PersistPlan) => {
    merge(p)
    // 素材插队：立刻把已合并的一切（含本条）落库，不再排 800ms
    if (isUrgent(p)) {
      void flush()
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), debounceMs)
  }

  return { schedule, flush }
}

export function createCanvasStore(opts: CanvasStoreOptions): CanvasStore {
  const initialGraph: GraphSnapshot =
    opts.initial ?? { projectId: opts.projectId, nodes: [], edges: [] }
  const persister = createPersister(opts.platform, opts.debounceMs ?? 800)

  // zustand vanilla store（不依赖 React，可在 node 下单测）
  const store = createVanillaStore<CanvasState>(() => ({
    graph: initialGraph,
    undoStack: [],
    redoStack: [],
    selection: [],
    selectedEdgeIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notice: null,
    dragging: false,
    panelDismissed: false,
    menu: null,
    linkMenu: null,
    renamingId: null,
    undoBar: null,
    lightbox: null,
    rotate: null,
    annotate: null,
    textEditor: null,
  }))

  // 当前进行中的多步事务（拓扑生成）：非 null 时，所有命令都合并进同一个撤销单元
  let activePlan: { planId: string; label: string } | null = null

  function dispatch(cmd: Command, txOverride?: TransactionBoundary): CommandResult {
    const { result, next } = reduce(cmd, store.getState().graph)
    // 事务边界可由调用方覆盖（runEngine 的 multi-step 计划），缺省用命令自带边界
    const t: TransactionBoundary = txOverride ?? result.transaction
    store.setState({ graph: next })

    if (t.mode !== 'silent') {
      const key =
        t.mode === 'multi-step'
          ? t.planId
          : t.mode === 'coalesce'
            ? t.groupId
            : (activePlan?.planId ?? createId('undo'))
      const label = t.mode === 'standalone' && activePlan ? activePlan.label : t.label
      const mergeable = t.mode === 'coalesce' || t.mode === 'multi-step' || activePlan !== null

      store.setState((s) => {
        const stacks = s.undoStack
        const last = stacks[stacks.length - 1]
        if (mergeable && last && last.key === key) {
          const updated = stacks.slice()
          updated[updated.length - 1] = {
            ...last,
            forward: [...last.forward, ...result.patches],
            inverse: [...last.inverse, ...result.inverse],
          }
          return { undoStack: updated, redoStack: [] }
        }
        const group: UndoGroup = { key, label, forward: result.patches, inverse: result.inverse }
        return { undoStack: [...stacks, group], redoStack: [] }
      })
    }

    persister.schedule(result.persist)
    return { ...result, transaction: t }
  }

  function undo() {
    const s = store.getState()
    if (!s.undoStack.length) return
    store.setState((st) => {
      const stacks = st.undoStack.slice()
      const group = stacks.pop()!
      const nextGraph = applyGraphPatches(st.graph, [...group.inverse].reverse())
      persister.schedule(toPersistPlan(group.inverse, nextGraph))
      return { graph: nextGraph, undoStack: stacks, redoStack: [...st.redoStack, group] }
    })
  }

  function redo() {
    const s = store.getState()
    if (!s.redoStack.length) return
    store.setState((st) => {
      const stacks = st.redoStack.slice()
      const group = stacks.pop()!
      const nextGraph = applyGraphPatches(st.graph, group.forward)
      persister.schedule(toPersistPlan(group.forward, nextGraph))
      return { graph: nextGraph, redoStack: stacks, undoStack: [...st.undoStack, group] }
    })
  }

  return {
    workbench: 'canvas',
    getSnapshot: () => store.getState().graph,
    dispatch,
    undo,
    redo,
    canUndo: () => store.getState().undoStack.length > 0,
    canRedo: () => store.getState().redoStack.length > 0,
    subscribe: (listener) => store.subscribe(listener),
    // 节点选择与连线选择互斥（§6.14 / §6.15）：选节点即清空连线选择，反之亦然
    setSelection: (ids) =>
      store.setState({ selection: ids, selectedEdgeIds: [], panelDismissed: false }),
    getSelection: () => store.getState().selection,
    setEdgeSelection: (ids) => store.setState({ selectedEdgeIds: ids, selection: [] }),
    getEdgeSelection: () => store.getState().selectedEdgeIds,
    setViewport: (vp) =>
      store.setState((s) => ({
        // 缩放统一在此 clamp 到 10% – 500%（产品文档 §6.3），避免任何调用方绕过
        viewport: { ...s.viewport, ...vp, zoom: clampZoom(vp.zoom ?? s.viewport.zoom) },
      })),
    getViewport: () => store.getState().viewport,
    flush: () => persister.flush(),
    hydrate: (snapshot) => {
      store.setState({ graph: snapshot })
    },
    notify: (text) => {
      store.setState({ notice: { id: createId('notice'), text } })
    },
    getNotice: () => store.getState().notice,
    clearNotice: (id) => {
      store.setState((s) => (id && s.notice?.id !== id ? {} : { notice: null }))
    },
    /** 弹出撤销条（§6.12「底部撤销条保留 6 秒」）；不落库、不进撤销栈 */
    showUndoBar: (text) => {
      store.setState({ undoBar: { id: createId('undobar'), text } })
    },
    getUndoBar: () => store.getState().undoBar,
    /** 关闭撤销条（当前条不是预期的 id 时忽略，避免竞态误关新条） */
    clearUndoBar: (id) => {
      store.setState((s) => (id && s.undoBar?.id !== id ? {} : { undoBar: null }))
    },
    setDragging: (on) => store.setState({ dragging: on }),
    isDragging: () => store.getState().dragging,
    setPanelDismissed: (on) => store.setState({ panelDismissed: on }),
    isPanelDismissed: () => store.getState().panelDismissed,
    setMenu: (x, y, target) => store.setState({ menu: { x, y, target } }),
    closeMenu: () => store.setState({ menu: null }),
    getMenu: () => store.getState().menu,
    setLinkMenu: (x, y, nodeId, side, portId, also) =>
      // 拖线期间与拖线结束到菜单关闭期间，创作面板保持隐藏（§6.14「拖线状态」）。
      // 复用 panelDismissed：它本来就表达「这次交互不弹面板，等下一次显式选中」。
      store.setState({
        linkMenu: { x, y, nodeId, side, portId, ...(also?.length ? { also: [...also] } : {}) },
        menu: null,
        panelDismissed: true,
      }),
    closeLinkMenu: () => store.setState({ linkMenu: null }),
    getLinkMenu: () => store.getState().linkMenu,
    beginRename: (nodeId) => store.setState({ renamingId: nodeId }),
    endRename: () => store.setState({ renamingId: null }),
    getRenamingId: () => store.getState().renamingId,
    openLightbox: (assetHash) =>
      store.setState({ lightbox: { assetHash }, textEditor: null, menu: null }),
    openCropLightbox: (nodeId) => {
      const node = store.getState().graph.nodes.find((n) => n.id === nodeId)
      const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
      if (!hash) return
      store.setState({
        lightbox: { assetHash: hash, cropFor: nodeId },
        textEditor: null,
        menu: null,
      })
    },
    /**
     * 「给情绪调节框脸」：自动识别认不出来时由面板开。
     *
     * 与「提取选区」共用同一套框选交互，但**确认后不建任何节点** —— 只把这个框
     * 写进该节点的 `data.faceBox`（见 `LightboxLayer`）。
     */
    openFaceLightbox: (nodeId) => {
      const node = store.getState().graph.nodes.find((n) => n.id === nodeId)
      const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
      if (!hash) return
      store.setState({
        lightbox: { assetHash: hash, faceFor: nodeId },
        textEditor: null,
        menu: null,
      })
    },
    closeLightbox: () => store.setState({ lightbox: null }),
    getLightbox: () => store.getState().lightbox,
    /** 三者互斥（灯箱 / 文本编辑 / 旋转编辑）：同时开着只会互相盖住 */
    openRotateEditor: (nodeId) =>
      store.setState({
        rotate: { nodeId },
        annotate: null,
        lightbox: null,
        textEditor: null,
        menu: null,
      }),
    closeRotateEditor: () => store.setState({ rotate: null }),
    getRotate: () => store.getState().rotate,
    openAnnotateEditor: (nodeId) =>
      store.setState({
        annotate: { nodeId },
        rotate: null,
        lightbox: null,
        textEditor: null,
        menu: null,
      }),
    closeAnnotateEditor: () => store.setState({ annotate: null }),
    getAnnotate: () => store.getState().annotate,
    /* 与素材灯箱互斥：同一个屏幕位置不可能同时看图和改字，两个都开着只会互相盖住 */
    openTextEditor: (nodeId) =>
      store.setState({ textEditor: { nodeId }, lightbox: null, menu: null }),
    closeTextEditor: () => store.setState({ textEditor: null }),
    getTextEditor: () => store.getState().textEditor,
    beginPlan: (planId, label) => {
      activePlan = { planId, label }
    },
    endPlan: () => {
      activePlan = null
    },
    dispose: () => void persister.flush(),
  }
}
