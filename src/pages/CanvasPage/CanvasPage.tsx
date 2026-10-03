import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  flushOnPageHide,
  broadcastWrite,
  subscribeExternalWrites,
} from '../../app/session'
import { createStore } from '../../state/createStore'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../../workbenches/canvas/storeContext'
import { CanvasSurface } from '../../workbenches/canvas/surface/CanvasSurface'
import { fitCanvasView } from '../../workbenches/canvas/surface/fitView'
import { CanvasExecutionProvider } from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { LogPanel } from '../../workbenches/canvas/panels/LogPanel'
import { AgentPanel } from '../../workbenches/canvas/panels/AgentPanel/AgentPanel'
import { CanvasToolbar } from '../../workbenches/canvas/toolbar/CanvasToolbar'
import { LightboxLayer } from '../../workbenches/canvas/lightbox/LightboxLayer'
import { TextEditorLayer } from '../../workbenches/canvas/text/TextEditorLayer'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import { NODE_MINIMUMS } from '../../domain/canvas/layout/constants'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { createNodeWithDefaults } from '../../features/canvas/createNodeWithDefaults'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
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
  const storeRef = useRef<CanvasStore | null>(null)
  const [externalEdit, setExternalEdit] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  /*
   * 原来的「顶栏标签集合」（`openTabs`）随顶栏一并移除（产品文档 §6.2）：
   * 「已打开项目」这个能力整体迁到应用壳侧栏的「最近项目」列表，
   * 由 `AppSidebar` 自己从项目仓储读最近编辑的几个。
   *
   * 刻意**不**在这里继续维护一份打开列表：两份列表会有各自的顺序、
   * 各自的增删时机，很快就对不上。
   */
  if (!storeRef.current) {
    storeRef.current = createStore({
      workbench: 'canvas',
      platform,
      projectId,
    })
  }
  const store = storeRef.current
  const channels = useChannels()

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
    let cancelled = false
    void (async () => {
      await platform.storage.open()
      const [n, e] = await Promise.all([
        platform.storage.query('nodes', { projectId }),
        platform.storage.query('edges', { projectId }),
      ])
      if (cancelled) return
      store.hydrate({
        projectId,
        nodes: n as unknown as NodeSnapshot[],
        edges: e as unknown as Edge[],
      })
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
        requestAnimationFrame(() => requestAnimationFrame(() => fitCanvasView(store)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId, store, template])

  useEffect(() => () => store.dispose(), [store])

  // 会话与启动（产品文档 §2.4 / §4.4）：离开前台 / 关闭前强制 flush，并广播写入
  useEffect(() => {
    if (projectId === 'demo') return
    return flushOnPageHide(() => {
      void store.flush()
      broadcastWrite(projectId)
    })
  }, [store, projectId])

  // 多标签写入检测：其他标签改了本项目时提示用户刷新
  useEffect(() => {
    if (projectId === 'demo') return
    return subscribeExternalWrites(projectId, () => setExternalEdit(true))
  }, [projectId])

  // DEV-only 性能基准钩子（§1.6 画布性能）：window.__seedPerfGraph() 注入 300/500 拓扑。
  // 动态 import 使生产构建完全不含该模块。
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let alive = true
    void import('../../dev/seedPerf').then((m) => {
      if (!alive) return
      ;(window as unknown as Record<string, unknown>).__seedPerfGraph = () => m.seedPerfGraph(store)
    })
    return () => {
      alive = false
      delete (window as unknown as Record<string, unknown>).__seedPerfGraph
    }
  }, [store])

  // 落库后即广播（不只页面隐藏时）：两个窗口并排时也能收到提示
  useEffect(() => {
    if (projectId === 'demo') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastGraph = store.getSnapshot()
    const unsub = store.subscribe(() => {
      const g = store.getSnapshot()
      if (g === lastGraph) return
      lastGraph = g
      if (timer) clearTimeout(timer)
      // 略晚于 800ms 的持久化防抖，确保广播时数据已落库
      timer = setTimeout(() => broadcastWrite(projectId), 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [store, projectId])

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
      store.notify('只支持图片 / 视频素材')
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

  /** 去后台设置：带上来来源路径，设置页据此把返回按钮指回本项目（而不是丢回首页） */
  // useCallback：NodeLayer 是 memo 组件，回调引用不稳会让它在每次父级重渲时白跑一轮
  const openSettings = useCallback(
    () => navigate('/settings', { state: { from: location.pathname } }),
    [navigate, location.pathname],
  )

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
          <button
            type="button"
            className={styles.logBtn}
            data-canvas-log
            aria-pressed={logOpen}
            aria-label="日志"
            title="日志"
            onClick={() => setLogOpen((v) => !v)}
          >
            日志
          </button>
          {/*
            助手入口（设计文档 §8）：与日志同排、在它左边。
            面板本身贴右侧、可收起 —— 收起后画布吃满，不长期占用画布宽度。
          */}
          <button
            type="button"
            className={styles.agentBtn}
            data-canvas-agent
            aria-pressed={agentOpen}
            aria-label="助手"
            title="助手"
            onClick={() => setAgentOpen((v) => !v)}
          >
            助手
          </button>
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
          <CanvasSurface onOpenSettings={openSettings} onOpenSkills={() => navigate('/skills')} />
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
        </div>
      </CanvasExecutionProvider>
    </CanvasStoreProvider>
  )
}
