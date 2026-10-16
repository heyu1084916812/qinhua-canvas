import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { openGlobalSettings } from '../../state/ui/globalSettings'
import { subscribeExternalWrites } from '../../app/session'
import { useProjectWriteSafety } from '../../app/useProjectWriteSafety'
import { createStore } from '../../state/createStore'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
import { CanvasStoreProvider } from '../../workbenches/canvas/storeContext'
import { FlowSurface } from '../../workbenches/canvas/flow/FlowSurface'
import { fitCanvasView, focusCanvasNode } from '../../workbenches/canvas/surface/fitView'
import { CanvasExecutionProvider } from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { LogPanel } from '../../workbenches/canvas/panels/LogPanel'
import { AgentPanel } from '../../workbenches/canvas/panels/AgentPanel/AgentPanel'
import { CanvasToolbar } from '../../workbenches/canvas/toolbar/CanvasToolbar'
import { LightboxLayer } from '../../workbenches/canvas/lightbox/LightboxLayer'
import { TextEditorLayer } from '../../workbenches/canvas/text/TextEditorLayer'
import { AnnotateLayer } from '../../workbenches/canvas/annotate/AnnotateLayer'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import { NODE_MINIMUMS } from '../../domain/canvas/layout/constants'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { createNodeWithDefaults } from '../../features/canvas/createNodeWithDefaults'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { useCanvasStyle } from '../../app/providers/CanvasStyleProvider'
import { nodeDensityFactor } from '../../domain/project/canvasStyle'
import { createAssetNode, importAssetFile, isImportableMedia } from '../../features/canvas/importAsset'
import { subscribeAgentHandoff } from '../../features/canvas/agentHandoff'
import { seedTemplate, type TemplateId } from '../../state/project/templates'
import type { NodeSnapshot, NodeType } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import styles from './CanvasPage.module.css'

/**
 * 画布页面容器（架构 §4.7：只接线，不放规则）。
 * 路由参数 projectId 决定打开哪个项目：
 * - 'demo'：空白临时画布，不读库（便于 SSR 冒烟与即时打开）
 * - 其它：挂载时从 IndexedDB 把 nodes/edges 读回 store
 *   图数据变更仍只走 dispatch(command)；读回是 hydrate，不进撤销栈。
 *
 * ## 无 id 的 `/canvas`（2026-09-27 应用壳新增）
 *
 * 侧栏的「画布」导航项指向 `/canvas`（用户没选项目时也点得动）。
 * 这里**不能**沿用原来的 `projectId = 'demo'` 兜底 —— 那会新建一个
 * 名叫 `demo` 的项目、并把用户真正的工作留在别处，是个很难解释的状态。
 * 正确行为是**没有可打开的项目就回项目页去挑一个**。
 */
export function CanvasPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <Navigate to="/projects" replace />
  // 用 projectId 作 key，确保切换项目时整棵画布子树重新挂载（store 重建）
  return <CanvasProject key={projectId} projectId={projectId} />
}

function CanvasProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const location = useLocation()
  const navigate = useNavigate()
  const template = (location.state as { template?: TemplateId } | null)?.template
  const seededRef = useRef(false)
  const [externalEdit, setExternalEdit] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  /**
   * 水合完成的计数（只用来**触发重跑**，值本身没意义）。
   *
   * 聚焦那支 effect 要在"节点已经在 store 里"之后才做得了事，而水合是异步的、
   * 完成时并不会让 React 重渲染 —— 没有这个计数，冷启动带 `?focus=` 进来时
   * 那支 effect 会在节点还没读回来时跑一次，然后**再也不会跑**。
   */
  const [hydratedAt, setHydratedAt] = useState(0)
  /** 要聚焦的节点（对账 #424）：`?focus=<nodeId>`，没有就是普通打开 */
  const focusId = new URLSearchParams(location.search).get('focus')
  /** 落地后是否直接打开裁剪灯箱（电商结果卡的「裁剪这一张」） */
  const cropId = new URLSearchParams(location.search).get('crop')
  /** 落地后是否直接打开标注 / 旋转编辑器（与 crop 同一套深链口径） */
  const annotateId = new URLSearchParams(location.search).get('annotate')
  const rotateId = new URLSearchParams(location.search).get('rotate')
  /*
   * 原来的「顶栏标签集合」（`openTabs`）随顶栏一并移除（产品文档 §6.2）：
   * 「已打开项目」这个能力整体迁到应用壳侧栏的「最近项目」列表，
   * 由 `AppSidebar` 自己从项目仓储读最近编辑的几个。
   *
   * 刻意**不**在这里继续维护一份打开列表：两份列表会有各自的顺序、
   * 各自的增删时机，很快就对不上。
   */
  /**
   * 同一个项目复用同一个 store 实例 —— 缓存与理由收在
   * `state/workbenches/canvas/storeCache.ts`（电商页共用同一份，见对账 #411）。
   */
  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store
  const channels = useChannels()
  const { style: canvasStyle } = useCanvasStyle()

  /**
   * 新节点默认尺寸（项目偏好 #379 C5）：把档位换算成系数交给 store，
   * 由它在 `node.create`（且调用方没给尺寸）时统一乘上去 ——
   * 建节点的入口有十来个，收在命令层才不会每加一个入口就漏一次。
   */
  useEffect(() => {
    store.setNodeScale(nodeDensityFactor(canvasStyle.density))
  }, [store, canvasStyle.density])

  /**
   * 「画布多选 → 添加到 agent 作为素材」（用户 2026-10-05 第 11 条第六个动作）。
   *
   * 这一层只负责**把对话窗打开**；ids 由对话窗自己取走（见 `agentHandoff` 的说明）——
   * 两件事分开，用户点按钮时面板一定会弹出来，而收素材那一步不会因为面板没挂载而丢。
   */
  useEffect(() => subscribeAgentHandoff(() => setAgentOpen(true)), [])

  // 从 IndexedDB 读回图数据（demo 不需要）；读回后若是模板新建的项目，套用模板预置节点
  useEffect(() => {
    if (projectId === 'demo') return
    /** 已经 hydrate 过（切走又回来）：**不要**再灌一次，那会把内存里正在跑的改动盖回去 */
    if (cached.hydrated) return
    let cancelled = false
    void (async () => {
      await platform.storage.open()
      const [n, e] = await Promise.all([
        platform.storage.query('nodes', { projectId }),
        platform.storage.query('edges', { projectId }),
      ])
      if (cancelled) return
      cached.hydrated = true
      store.hydrate({
        projectId,
        nodes: n as unknown as NodeSnapshot[],
        edges: e as unknown as Edge[],
      })
      /* 让"聚焦"那支 effect 重跑一次（水合完成不会自己触发渲染） */
      setHydratedAt((k) => k + 1)
      // 模板预置仅在「新建的空项目」首次挂载时执行一次（hydrate 之后，避免被空库覆盖）。
      //
      // 两重守卫，缺一不可：
      // - `seededRef`：挡 StrictMode 双挂载 / 同一会话内的重复 effect；
      // - **hydrate 结果为空**：挡「刷新页面」。`location.state` 由浏览器 history 保管，
      //   刷新后 `template` 依然在（history.state.usr.template 跨 reload 存活），
      //   而 seededRef 已随页面重建归零 —— 只靠 ref 会让每次刷新都把整套模板再套一遍，
      //   节点成倍增长且全部落库。以「库里已有节点」为准才是持久化的判据。
      if (template && !seededRef.current && n.length === 0 && e.length === 0) {
        seededRef.current = true
        seedTemplate(store, template)
        // 模板节点落在世界原点，而顶栏 / 左工具栏是**悬浮**浮层——不适配视图的话
        // 第一排节点会连同它浮在节点外的标题一起被浮层压住。等一帧（画布挂载 + 节点落位）再适配。
        // 带 `?focus=` 时不适配"全部"：两件事会互相盖掉，而聚焦是用户明确要的那件。
        if (!focusId) requestAnimationFrame(() => requestAnimationFrame(() => fitCanvasView(store)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId, store, template, cached])

  /**
   * 聚焦到某个节点（对账 #424）：电商某张结果 / 漫剧某一镜点「在画布里改这一张」跳过来时
   * 带的就是 `?focus=<nodeId>`。
   *
   * ⚠️ **不能塞进水合那支 effect 里**：它开头有一句"已经 hydrate 过就直接 return"，
   * 而从别的工作台**回到**画布时缓存多半已经是 hydrated（同一个 store 实例，见 #411）——
   * 那样正好走不到聚焦那一段（把它写在水合分支里就会漏）。所以单独一支：
   * 水合还没完成时先什么都不做，`hydratedAt` 一变就再跑。
   *
   * 命中就**选中**它（选中即打开创作面板）：用户跳过来要的就是"落地就能改这一张"，
   * 而不是在图里再自己找一遍。找不到（节点已删 / id 写错）时**什么都不做** —— 不甩视口。
   */
  useEffect(() => {
    if (!focusId || projectId === 'demo' || !cached.hydrated) return
    if (focusCanvasNode(store, focusId)) {
      store.setSelection([focusId])
      if (cropId === '1') store.openCropLightbox(focusId)
      else if (annotateId === '1') store.openAnnotateEditor(focusId)
      else if (rotateId === '1') store.openRotateEditor(focusId)
    }
  }, [focusId, cropId, annotateId, rotateId, projectId, store, cached, hydratedAt])

  useEffect(() => () => store.dispose(), [store])

  /**
   * 会话与启动（产品文档 §2.4 / §4.4）：离开前台 / 关闭前强制 flush + 落库后广播。
   * **与电商页共用同一份**（`useProjectWriteSafety`）—— 那两个页面共用同一个 store。
   */
  useProjectWriteSafety(projectId, store)

  // 多标签写入检测：其他标签改了本项目时提示用户刷新
  useEffect(() => {
    if (projectId === 'demo') return
    return subscribeExternalWrites(projectId, () => setExternalEdit(true))
  }, [projectId])

  /**
   * DEV-only 诊断钩子（2026-10-12）：把**内存里的真相**读出来 —— 节点坐标 + 撤销 / 重做栈。
   *
   * 为什么单独要这个：库里的行走 **800ms 防抖**，而 React Flow 又在自己内部存了一份位置。
   * 追「键盘微移 1px 到底有没有落盘」时，只看 DOM 或只看库都会误判（两边各说一个数）。
   * 这个钩子只在开发构建里挂，生产构建**一行都不含**（与 `__seedPerfGraph` 同一种写法）。
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__canvasDebug = () => ({
      nodes: store
        .getSnapshot()
        .nodes.map((n) => ({ id: n.id, type: n.type, parentId: n.parentId, x: n.x, y: n.y, w: n.w, h: n.h })),
      selection: store.getSelection(),
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
    })
    return () => {
      delete (window as unknown as Record<string, unknown>).__canvasDebug
    }
  }, [store])

  // DEV-only 性能基准钩子（§1.6 画布性能）：window.__seedPerfGraph() 注入 300/500 拓扑。
  // 可带参：__seedPerfGraph(150, 250) —— 用来量**真实规模**（项目里的节点数）下的帧率，
  // 只跑 300 那一档回答不了"我自己的项目会不会卡"。
  // 动态 import 使生产构建完全不含该模块。
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let alive = true
    void import('../../dev/seedPerf').then((m) => {
      if (!alive) return
      ;(window as unknown as Record<string, unknown>).__seedPerfGraph = (nodes?: number, edges?: number) =>
        m.seedPerfGraph(store, nodes, edges)
    })
    return () => {
      alive = false
      delete (window as unknown as Record<string, unknown>).__seedPerfGraph
    }
  }, [store])

  /** 在当前视口中心放置一个节点并选中（顶栏「＋ X」按钮共用） */
  const addNodeAtCenter = async (type: NodeType) => {
    const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (!el) return
    const r = el.getBoundingClientRect()
    const c = screenToWorld(
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      store.getViewport(),
      { x: r.left, y: r.top, w: r.width, h: r.height },
    )
    const min = NODE_MINIMUMS[type]
    /**
     * 默认带**这个项目的配方**（用户 2026-09-18）：
     * 项目生成过 → 最后一次生成用的渠道 + 模型 + 参数；
     * 项目从没生成过 → 后台设置的第一个渠道的第一个模型。
     *
     * 每次新建都**现取**（内部有按项目的内存缓存，不会多读库）：
     * 早先缓存一份在页面里的写法有个真缺陷——生成后配方更新了，那份缓存不更新，
     * 于是「刚生成完，新建节点还是空的」，非得刷新页面才生效（实测确认）。
     */
    /**
     * 提示词节点也要默认值（用户 2026-09-18：「提示词节点也一样」），
     * 但它要的是**文本模型**而不是生成用的图片模型。
     *
     * 新节点自身还没有渠道 / 模型，传空对象即可——解析链会走
     * 「该渠道记录 → 第一个可用渠道的首模型」那两档。
     */
    /**
     * 三个新建入口收敛到同一个实现（用户 2026-09-23）。
     *
     * 此前这里（左栏「＋」菜单）是唯一带默认配方与配方回写的入口；
     * 右键菜单与拖线新建各写一份裸 `node.create` ⇒ 从那两个入口建出来的
     * 生成节点没有渠道 / 模型，用户在它上面改参数也记不进配方。
     * 现在统一走 `createNodeWithDefaults`，新增入口只需调它。
     */
    await createNodeWithDefaults({
      store,
      channels,
      projectId,
      type,
      at: { x: c.x - min.w / 2, y: c.y - min.h / 2 },
      // 提示词节点要多带两个字段（正文空、未连上游）
      extraData: type === 'prompt' ? { text: '', upstreamPromptLinked: false } : undefined,
    })
  }

  /**
   * 顶栏「导入素材」：选文件 → 落库 → 在视口中心落成节点。
   * 与「拖到画布空白处」共用 `importAssetFile` / `createAssetNode`，只有落点不同
   * （这里没有鼠标位置，用视口中心；拖放用光标落点）。
   */
  const importAssetAtCenter = async () => {
    const asset = await importAssetFile({ platform, store, projectId })
    if (!asset) return
    if (!isImportableMedia(asset.mime)) {
      store.notify('只支持图片 / 视频素材', 'error')
      return
    }
    const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (!el) return
    const r = el.getBoundingClientRect()
    const c = screenToWorld(
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      store.getViewport(),
      { x: r.left, y: r.top, w: r.width, h: r.height },
    )
    const size = assetNodeSize({ width: asset.width, height: asset.height })
    const id = createAssetNode(
      { platform, store, projectId },
      asset,
      { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) },
    )
    if (id) {
      store.setSelection([id])
      store.showUndoBar('已导入 1 个素材')
    }
  }

  /**
   * 去后台设置（用户 2026-10-06 改，对账 #259）：现在是**打开全局设置浮层并直接落到
   * 「渠道配置」**，而不是跳页 —— 用户明确「不单单是打开浮层」。
   *
   * 顺带清掉一处**死参数**：旧实现带 `state.from` 说"设置页据此把返回指回来"，
   * 但设置页的返回按钮早在 2026-09-27 就去掉了（导航归侧栏）—— 那个参数没有任何地方读。
   * 改成浮层之后，"从哪来的"这个问题本身消失了：关掉浮层就回到画布，无需记来源。
   */
  const openSettings = useCallback(() => openGlobalSettings('channels'), [])

  return (
    <CanvasStoreProvider store={store}>
      {/* 执行宿主上提一层包住整页：顶栏的「仅刷新陈旧 / 全图重跑」需要与画布共用同一份
          执行状态（原先只包住 Surface，顶栏拿不到 useCanvasExecution）。 */}
      <CanvasExecutionProvider>
        <div className={agentOpen ? `${styles.page} ${styles.pageAgentOpen}` : styles.page}>
          {/*
            ⛔ 顶部悬浮栏已整体去除（产品文档 §6.2 / 2026-09-27 应用壳改版）。

            它原来的五件事都有了新家，**一件都不该留在这里**：
              - 品牌 / 返回首页  → 应用壳侧栏
              - 已打开项目标签    → 应用壳侧栏「最近项目」
              - 后台设置          → 一级导航「渠道配置」
              - 主题切换          → 应用壳侧栏底部
              - 日志              → 本页右上角（见下）
            缩放读数由小地图附近承担（`Minimap` 一侧）。

            留着它就会与侧栏形成**两套导航**，用户不知道该看哪个。
          */}
          {/*
            日志入口（§6.2：「日志按钮移到画布工作区右上角」）。
            刻意做成一个朴素的小按钮而不是重做一套顶栏：
            顶栏被去掉要解决的是「它挡住画布内容」，不是「按钮本身不该存在」。
          */}
          {/*
            右上角那排入口（用户 2026-10-06 第 6 条改过三处）：
            ① **顺序换过来**：现在是「日志 → Agent」（原来「助手 → 日志」）；
            ② **间距减半**：`--space-4`(16) → `--space-2`(8) —— 用户原话「目前助手和日志之间的距离太远」；
            ③ **面板打开时只隐藏 Agent 那一个按钮**，日志始终在（用户原话：
               「整排隐藏的是 agent 那个按钮，不是日志」）—— 所以下面 Agent 按钮是条件渲染，
               而 `.pageAgentOpen` 那条"整排左移"的规则保留：剩下的日志仍要躲开面板。

            名字也改了：**助手 → Agent**（用户第 6 条：「助手改个名称叫 Agent」）。
            锚点 `data-canvas-agent` 不变（冒烟与样式都靠它定位，名字是给人看的）。
          */}
          <div className={styles.topRightActions}>
            <button
              type="button"
              className={styles.topBtn}
              data-canvas-log
              aria-pressed={logOpen}
              aria-label="日志"
              title="日志"
              onClick={() => setLogOpen((v) => !v)}
            >
              日志
            </button>
            {!agentOpen && (
              <button
                type="button"
                className={`${styles.topBtn} ${styles.agentBtn}`}
                data-canvas-agent
                aria-pressed={agentOpen}
                aria-label="Agent"
                title="Agent"
                onClick={() => setAgentOpen((v) => !v)}
              >
                Agent
              </button>
            )}
          </div>
          {externalEdit && (
            <div className={styles.externalBanner} role="status">
              <span>项目已在其他标签页修改</span>
              <button
                type="button"
                className={styles.externalBtn}
                onClick={() => window.location.reload()}
              >
                刷新
              </button>
            </div>
          )}
          {/*
           * 引擎替换（2026-10-05）：画布就是 React Flow 面 —— **老画布已按 P5 收口删掉**
           * （`CanvasSurface` / `画布表面` / `EdgeLayer` / `OverlayLayer` 与其 `?engine=legacy` 分支，
           * 见《轻画-画布引擎替换方案.md》§8.11）。这里不再有第二条渲染路径。
           */}
          <FlowSurface
            projectId={projectId}
            onOpenSettings={openSettings}
            onOpenSkills={() => navigate('/skills')}
          />
          <CanvasToolbar
            onCreateNode={addNodeAtCenter}
            onImportAsset={() => void importAssetAtCenter()}
          />
            {logOpen && <LogPanel onClose={() => setLogOpen(false)} />}
            {agentOpen && <AgentPanel projectId={projectId} onClose={() => setAgentOpen(false)} />}
          {/* 素材灯箱（§6.17）挂在页面级：它的触发方有画布表面与日志面板两处，
              挂在任一子树里另一处都够不着；状态在 store，故放哪都能读 */}
          <LightboxLayer />
          {/* 文本编辑灯箱（§6.7）：与素材灯箱同级、互斥。同样挂页面级——
              入口有「右键菜单」与「节点跟随栏的全屏按钮」两处 */}
          <TextEditorLayer />
          {/* 旋转与镜像 / 标注（用户 2026-10-05 第 10 条）：都在节点跟随栏里点开，
              与上面两个浮层互斥；保存才写数据（一步撤销），关掉即忘 */}
          <AnnotateLayer />
        </div>
      </CanvasExecutionProvider>
    </CanvasStoreProvider>
  )
}
