import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
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
import { CanvasToolbar } from '../../workbenches/canvas/toolbar/CanvasToolbar'
import { LightboxLayer } from '../../workbenches/canvas/lightbox/LightboxLayer'
import { TextEditorLayer } from '../../workbenches/canvas/text/TextEditorLayer'
import { CanvasTopBar } from './CanvasTopBar'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import { NODE_MINIMUMS } from '../../domain/canvas/layout/constants'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { newGeneratingNodeData } from '../../domain/canvas/nodeSpecs/newNodePreset'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { createAssetNode, importAssetFile, isImportableMedia } from '../../features/canvas/importAsset'
import { seedTemplate, type TemplateId } from '../../state/project/templates'
import type { NodeSnapshot, NodeType } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import styles from './CanvasPage.module.css'

/**
 * 顶栏「已打开项目」标签的会话态（用户 2026-09-19）。
 *
 * 顶栏要能**在项目之间切换**，也要能关掉某个标签。这个集合既不是「磁盘上有哪些项目」
 * （那是首页的职责），也不该刷新一次就丢，故存在 `sessionStorage` ——
 * 它天然表达「这次会话打开了哪些」，关掉即走；关掉标签**不删项目**。
 *
 * 读写都容错：隐私模式下 `sessionStorage` 可能抛异常，那时退化成「只有当前项目」，
 * 不让顶栏整条挂掉。
 */
const OPEN_TABS_KEY = 'qinghua:openProjects'

function readOpenTabs(): string[] {
  try {
    const raw = sessionStorage.getItem(OPEN_TABS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeOpenTabs(ids: string[]): void {
  try {
    sessionStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids))
  } catch {
    // 存不下就算了：标签集合是会话态，不是业务数据
  }
}

/**
 * 画布页面容器（架构 §4.7：只接线，不放规则）。
 * 路由参数 projectId 决定打开哪个项目：
 * - 'demo'：空白临时画布，不读库（便于 SSR 冒烟与即时打开）
 * - 其它：挂载时从 IndexedDB 把 nodes/edges 读回 store
 *   图数据变更仍只走 dispatch(command)；读回是 hydrate，不进撤销栈。
 */
export function CanvasPage() {
  const { projectId = 'demo' } = useParams<{ projectId?: string }>()
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
  /**
   * 顶栏标签集合（用户 2026-09-19：**切换项目不要改变顺序**）。
   *
   * 只在挂载时算一次：项目已在列表里就**保持原位**，新项目才追加到末尾。
   * 早先写成「把当前项提到最前」，于是每次切换项目整棵子树重新挂载
   * （`key={projectId}`）都会重排一次——标签在顶栏上跳来跳去，用户找不到刚看的那个。
   * 顺序只由「首次打开的先后」决定，与当前选中谁无关。
   */
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    const saved = readOpenTabs()
    const next = saved.includes(projectId) ? saved : [...saved, projectId]
    writeOpenTabs(next)
    return next
  })
  if (!storeRef.current) {
    storeRef.current = createStore({
      workbench: 'canvas',
      platform,
      projectId,
    })
  }
  const store = storeRef.current
  const channels = useChannels()

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
    if (type === 'prompt') {
      const recipe = await channels.defaultForNewNode({}, 'chat')
      const promptData = recipe
        ? { channelId: recipe.channelId, model: recipe.model }
        : {}
      const res = store.dispatch({
        kind: 'node.create',
        projectId,
        type,
        at: { x: c.x - min.w / 2, y: c.y - min.h / 2 },
        data: { text: '', upstreamPromptLinked: false, ...promptData },
      })
      const created = res.patches.find(
        (p) => p.op === 'upsert' && p.table === 'nodes',
      ) as unknown as { row: { id: string } } | undefined
      if (created) store.setSelection([created.row.id])
      return
    }

    const recipe = await channels.defaultForNewNode({})
    const data = newGeneratingNodeData(type, recipe)
    const res = store.dispatch({
      kind: 'node.create',
      projectId,
      type,
      at: { x: c.x - min.w / 2, y: c.y - min.h / 2 },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    })
    const created = res.patches.find(
      (p) => p.op === 'upsert' && p.table === 'nodes',
    ) as unknown as { row: { id: string } } | undefined
    if (created) store.setSelection([created.row.id])
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
        <div className={styles.page}>
          <CanvasTopBar
            onToggleLog={() => setLogOpen((v) => !v)}
            onBack={() => navigate('/')}
            onOpenSettings={openSettings}
            onSwitchProject={(id) => navigate(`/canvas/${id}`)}
            openProjectIds={openTabs}
            onCloseProject={(id) => {
              const rest = openTabs.filter((x) => x !== id)
              setOpenTabs(rest)
              writeOpenTabs(rest)
              /**
               * 关掉的是**当前正在编辑的项目** → 跳到相邻标签；一个都不剩就回首页。
               * 关掉别的标签不影响当前编辑，只更新列表。
               */
              if (id !== projectId) return
              const next = rest[0]
              navigate(next ? `/canvas/${next}` : '/')
            }}
          />
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
          <CanvasSurface onOpenSettings={openSettings} />
          <CanvasToolbar
            onCreateNode={addNodeAtCenter}
            onImportAsset={() => void importAssetAtCenter()}
          />
            {logOpen && <LogPanel onClose={() => setLogOpen(false)} />}
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
