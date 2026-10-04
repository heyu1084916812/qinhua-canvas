/**
 * 节点跟随功能栏（用户 2026-09-16 需求）。
 *
 * 形态与定位口径**照抄创作面板**（`panels/PanelLayer.tsx`）：
 * - 挂在 `[data-world]` 之外，用**屏幕坐标**绝对定位 ⇒ 缩放 / 平移只重算锚点，
 *   栏目自身尺寸不随画布缩放（§6.8「缩放独立性」同源）；
 * - world → screen 用同一个换算：屏幕 = (世界 − 视口平移) × zoom；
 * - 显示/隐藏规则与面板**完全一致**（用户 2026-09-17：跟随栏要跟创作面板一个样）：
 *   §6.15「拖动期间立即隐藏；发生真实位移的拖动，松手后保持隐藏，
 *   直到下一次显式选中」。两个标记都从 store 读（`dragging` / `panelDismissed`），
 *   与 PanelLayer 同源，因此两者永远同时出现、同时消失。
 *
 * 差别只有纵向位置：面板在节点**下方**，本栏在节点**上方**（标题之上），
 * 即纵向锚点 = 节点顶边再上移「栏高 + 间距」（用户 2026-09-17 起不再翻转到下方）。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../storeContext'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import type { NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'
import { createId } from '../../../shared/id'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { GRID_CUSTOM_MAX, GRID_PRESETS, splitNodeToGrid } from '../../../features/canvas/splitToGrid'
import { followBarAnchor } from './followBarAnchor'
import styles from './NodeFollowBar.module.css'
import { FormatToolbar, type FormatAction } from '../text/FormatToolbar'
import { applyInlineFormat, applyLineFormat, insertDivider, linePrefixOf } from '../../../domain/canvas/text/markdownFormat'
import { toPlainText } from '../../../domain/canvas/text/markdownRender'
import {
  IconChevronDown,
  IconGridArrange,
  IconRotate,
  IconExpand,
  IconAnnotate,
  IconDelete,
  IconDownload,
  IconDuplicate,
  IconPlay,
  IconRename,
  IconScan,
  IconSettings,
  IconStop,
} from './icons'

/**
 * 出现跟随栏的节点类型。
 *
 * 与创作面板同一批（§6.1）。
 */
const FOLLOW_TYPES = new Set<NodeType>(['prompt', 'generation', 'group', 'batch', 'compare', 'fusion'])

/** 鼠标按下时阻止默认聚焦：按钮点击后不滞留焦点，否则空格会被按钮吃掉（§6.3） */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

export interface NodeFollowBarProps {
  /** 关闭（= 取消选中，与创作面板「点面板外关闭」同一语义） */
  onClose?: () => void
  /** 宿主导航：去后台设置配渠道 */
  onOpenSettings?: () => void
  /**
   * 下载节点自身素材（用户 2026-09-18）。
   *
   * 与 `onOpenSettings` 同类：**宿主注入**。取字节（AssetPort）与落盘（FilePort）
   * 都在宿主侧，跟随栏不认识存储（架构 §4.7「视图只 emit / 调用注入回调」）。
   */
  onDownload?: (nodeId: string) => void
}

export function NodeFollowBar({ onClose, onOpenSettings, onDownload }: NodeFollowBarProps = {}) {
  const store = useCanvasStore()
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  const exec = useCanvasExecution()

  // §6.15：拖动期间立即隐藏；**真实位移**的拖动松手后保持隐藏，直到下一次显式选中
  // （`setSelection` 会复位 panelDismissed）。普通单击（无位移）不算拖动，照常出现。
  const dragging = useSyncExternalStore(store.subscribe, store.isDragging, store.isDragging)
  const dismissed = useSyncExternalStore(
    store.subscribe,
    store.isPanelDismissed,
    store.isPanelDismissed,
  )

  /**
   * Esc：跟随栏可见时**先收起它**（取消选中），而不是等画布那层去兜。
   *
   * 少了这一条，用户按 Esc 时画布的 keydown 处理会因为「焦点不在画布 /
   * 事件被别的浮层吃掉」等原因没落到取消选中上，Esc 看起来时灵时不灵。
   * 本层自己监听 window，只认「当前有单选」这一种情况，不与别的浮层抢 Esc。
   */
  useEffect(() => {
    if (selection.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      /**
       * 已经被别的层消费掉的 Esc，这里不再抢。
       *
       * 为什么需要这一条：创作面板的参数浮层开着时按 Esc，语义是「收起这个下拉」，
       * 不应连带清空选中（那会让整个面板一起消失）。浮层那一侧会 `preventDefault()`
       * 声明「这次 Esc 我吃了」，本层据此让行。
       *
       * 用 `defaultPrevented` 而不是 `stopPropagation`：本层挂在 window 上，
       * 与 React 的合成事件不在同一条传播链上，靠「谁标记谁消费」协商才稳——
       * 否则就得依赖「React 把监听器挂在 root container」这个实现细节。
       */
      if (e.defaultPrevented) return
      const t = e.target as { tagName?: string; isContentEditable?: boolean } | null
      // 正在改名 / 输入文本时 Esc 属于编辑器，不抢
      if (t?.isContentEditable) return
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      store.setSelection([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, selection.length])

  // 与创作面板同款：拖动中 / 刚拖完（未重新选中）/ 多选（归属有歧义）都不显示
  if (dragging || dismissed) return null
  if (selection.length !== 1) return null
  const node = graph.nodes.find((n) => n.id === selection[0])
  if (!node || !FOLLOW_TYPES.has(node.type)) return null

  // 结果组子节点的父不在 nodes 表，必须走「图内」世界矩形（否则锚点飞到左上角）
  const rect = toWorldRectInGraph(node, graph)
  // 锚点几何（含「上方装不下就翻到下方」）由纯函数给出，组件只负责用它
  const anchor = followBarAnchor(rect, viewport)

  const close = onClose ?? (() => store.setSelection([]))

  return (
    <div
      className={styles.bar}
      style={{ left: anchor.centerX, top: anchor.top, transform: 'translateX(-50%)' }}
      data-node-follow-bar={node.id}
      // 栏上的点击/拖动不该被画布当成「点空白取消选中」或发起平移
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <NodeActions
        node={node}
        running={exec.isRunning}
        onClose={close}
        onOpenSettings={onOpenSettings}
        onDownload={onDownload}
      />
    </div>
  )
}

/**
 * 按节点类型注入动作（视图层不发命令，交给 store / 执行宿主）。
 *
 * 第一版只挂**确定有效**的四个：生成/取消、重命名、复制、删除 ——
 * 与右键菜单同源（§4.1），不新增任何「点了没反应」的入口。
 */
function NodeActions({
  node,
  running,
  onClose,
  onOpenSettings,
  onDownload,
}: {
  node: NodeSnapshot
  running: boolean
  onClose: () => void
  onOpenSettings?: () => void
  onDownload?: (nodeId: string) => void
}) {
  const store = useCanvasStore()
  const exec = useCanvasExecution()
  const platform = usePlatform()
  /**
   * 宫格切分的两级菜单（用户 2026-10-05 第 9 条）：
   * `presets` = 4 / 9 / 16 / 25 宫格 + 「自定义 ›」；`custom` = 点选行列的网格
   * （参考截图里那块 4×4 的小方格；这里放宽到 6×6）。
   */
  const [splitMenu, setSplitMenu] = useState<'none' | 'presets' | 'custom'>('none')
  const [customR, setCustomR] = useState(2)
  const [customC, setCustomC] = useState(2)

  /**
   * 提示词节点走**正文格式工具栏**（用户 2026-09-21），而不是下面那套
   * 「生成 / 重命名 / 复制 / 删除」。
   *
   * 为什么不并把两套都塞进一条：提示词节点的常用操作是「给正文加格式」，
   * 而它那套通用动作（重命名 / 删除）已在**右键菜单**里各有一份；
   * 一条栏里堆十来个按钮会把常用操作挤到看不见。
   *
   * 工具栏本体与全屏灯箱**共用同一个组件**（`text/FormatToolbar`），
   * 所以两处的按钮顺序、选中态、禁用逻辑永远一致。
   */
  if (node.type === 'prompt') {
    return <PromptFormatActions node={node} onClose={onClose} />
  }

  const state = exec.nodeStateOf(node.id)
  const busy = state?.kind === 'queued' || state?.kind === 'running'
  /**
   * 「生成」按钮出现的类型。
   *
   * 融合节点也在内（§6.23）：它的运行入口不止节点内那个按钮 —— 右键菜单、
   * 快捷键 R 都会走到同一处，跟随栏少一个按钮只是少一个入口，不是少一条语义。
   */
  const canRun =
    node.type === 'generation' ||
    node.type === 'batch' ||
    node.type === 'group' ||
    node.type === 'fusion'
  /**
   * 「有可下载的素材」= 节点**自身**持有 `assetHash`。
   *
   * 刻意不含「容器内某个子节点的素材」：那种情况下「下载」到底该下哪一张没有唯一答案，
   * 猜一个必然有人不满意。要下容器里的某张，选中那张子节点再下即可。
   */
  const hasAsset = !!(node.data as { assetHash?: string }).assetHash
  const assetHash = (node.data as { assetHash?: string }).assetHash

  /**
   * **有素材时，功能栏只留「跟这张素材有关」的动作**（用户 2026-10-05 第 13 条：
   * 「生成节点的功能栏有素材的时候……把目前的生成、重命名、复制、删除、关闭、渠道设置
   * 的功能删掉」）。
   *
   * 那一栏在那张图出来之后就该围着图服务：生成 / 重命名 / 渠道设置与它无关，
   * 删除 / 关闭又紧挨着容易误触。素材相关的（提取选区 / 下载）照旧保留；
   * **正在生成时的「取消生成」例外**：那是这一栏唯一能中止它的入口，撤了就没处停。
   */
  const assetMode = hasAsset

  const onRun = () => {
    if (busy) exec.cancel()
    else if (node.type === 'generation') void exec.runNode(node.id)
    else void exec.runNode(node.id)
  }

  /** 切分：切完把新节点选中（`splitNodeToGrid` 内部已经 setSelection），失败就把原因说清楚 */
  const runSplit = (rows: number, cols: number) => {
    setSplitMenu('none')
    void splitNodeToGrid({ platform, store }, { nodeId: node.id, rows, cols }).then((r) => {
      if (!r.ok) store.notify(r.reason)
    })
  }

  /**
   * 旋转与镜像（用户 2026-10-05 第 10 条）：「点击后右边复制一个新的节点并且连接，
   * 上方出现功能栏……最右边还有一个保存按钮」。
   *
   * 复制 + 连线走**一个 plan**（一步撤销）；复制的 `rewire: false` —— 旋转副本是
   * 「这张图的又一版」，不该把原图的整条上游也复制一份。
   */
  const onRotate = () => {
    if (!assetHash) return
    const id = createId('node')
    store.beginPlan(`rotate:${id}`, '旋转与镜像')
    store.dispatch({
      kind: 'node.duplicate',
      ids: [node.id],
      newIds: [id],
      dx: node.w + 40,
      dy: 0,
      rewire: false,
    })
    store.dispatch({
      kind: 'edge.connect',
      source: node.id,
      target: id,
      sourcePort: 'output',
      targetPort: 'input',
    })
    store.endPlan()
    store.openRotateEditor(id)
  }

  return (
    <div className={styles.actions}>
      {canRun && (!assetMode || busy) && (
        <FollowButton
          action="run"
          icon={busy ? <IconStop /> : <IconPlay />}
          label={busy ? '取消生成' : '生成'}
          onClick={onRun}
        />
      )}
      {!assetMode && (
        <FollowButton
          action="rename"
          icon={<IconRename />}
          label="重命名"
          onClick={() => store.beginRename(node.id)}
        />
      )}
      {!assetMode && (
        <FollowButton
          action="duplicate"
          icon={<IconDuplicate />}
          label="复制"
          onClick={() =>
            store.dispatch({
              kind: 'node.duplicate',
              ids: [node.id],
              newIds: [createId('node')],
              dx: 24,
              dy: 24,
              rewire: true,
            })
          }
        />
      )}
      {/*
        「提取选区」（§6.23，用户 2026-09-29）：**图片节点上方的功能栏**是这个入口的
        主位置（右键菜单里也有同一项）。它与「下载」一样属于普通操作，故贴在复制之后、
        危险操作之前；没有素材时不出现 —— 摆一个点了没反应的按钮比不摆更糟。
      */}
      {hasAsset && (
        <FollowButton
          action="extract"
          icon={<IconScan />}
          label="提取选区"
          onClick={() => store.openCropLightbox(node.id)}
        />
      )}
      {/*
        宫格切分（用户 2026-10-05 第 9 条）：切完在**原图右侧**排出一批新节点，
        原图不动（与「提取选区」同一条约定）。只在有素材时出现 —— 没图可切。
      */}
      {hasAsset && (
        <span className={styles.splitAnchor}>
          <FollowButton
            action="split"
            icon={<IconGridArrange />}
            label="宫格切分"
            onClick={() => setSplitMenu((v) => (v === 'none' ? 'presets' : 'none'))}
          />
          {splitMenu === 'presets' && (
            <div className={styles.splitMenu} data-split-menu>
              {GRID_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={styles.splitItem}
                  data-split-preset={p.id}
                  onClick={() => runSplit(p.rows, p.cols)}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={styles.splitItem}
                data-split-custom
                onClick={() => setSplitMenu('custom')}
              >
                自定义 ›
              </button>
            </div>
          )}
          {splitMenu === 'custom' && (
            <div className={styles.splitMenu} data-split-custom-menu>
              <div className={styles.splitHint}>点一格 = 用它的行列</div>
              <div className={styles.splitGrid}>
                {Array.from({ length: GRID_CUSTOM_MAX * GRID_CUSTOM_MAX }, (_, i) => {
                  const r = Math.floor(i / GRID_CUSTOM_MAX) + 1
                  const c = (i % GRID_CUSTOM_MAX) + 1
                  const on = r <= customR && c <= customC
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={on ? `${styles.splitCell} ${styles.splitCellOn}` : styles.splitCell}
                      data-split-cell={`${r}x${c}`}
                      aria-label={`${r} 行 ${c} 列`}
                      onMouseEnter={() => {
                        setCustomR(r)
                        setCustomC(c)
                      }}
                      onClick={() => runSplit(r, c)}
                    />
                  )
                })}
              </div>
              <div className={styles.splitHint} data-split-custom-value>
                {customR} × {customC}
              </div>
            </div>
          )}
        </span>
      )}
      {/*
        下载（用户 2026-09-18：加在跟随栏里）。
        只在**有素材**时出现——空节点没有可下载的内容，摆一个点了没反应的按钮
        比不摆更糟（与「上传只在无上游时出现」同一条口径）。
        放在「复制」与「删除」之间：它是普通操作，不该贴着危险操作。
      */}
      {hasAsset && onDownload && (
        <FollowButton
          action="download"
          icon={<IconDownload />}
          label="下载"
          onClick={() => onDownload(node.id)}
        />
      )}
      {/*
        第 10 条里那四个右边功能，按用户给的顺序排在下载前后：
        标注 / 旋转 / 下载 / 预览。四个都只在**有素材**时出现（空节点没得标没得转）。
      */}
      {hasAsset && (
        <FollowButton
          action="annotate"
          icon={<IconAnnotate />}
          label="标注"
          onClick={() => store.openAnnotateEditor(node.id)}
        />
      )}
      {hasAsset && (
        <FollowButton action="rotate" icon={<IconRotate />} label="旋转" onClick={onRotate} />
      )}
      {hasAsset && (
        <FollowButton
          action="preview"
          icon={<IconExpand />}
          label="预览"
          onClick={() => assetHash && store.openLightbox(assetHash)}
        />
      )}
      {!assetMode && (
        <FollowButton
          action="delete"
          icon={<IconDelete />}
          label="删除"
          onClick={() => {
            store.dispatch({ kind: 'node.delete', ids: [node.id] })
            store.setSelection([])
            store.showUndoBar('已删除节点')
          }}
        />
      )}
      {!assetMode && <span className={styles.divider} />}
      {!assetMode && (
        <FollowButton action="close" icon={<IconChevronDown />} label="关闭" onClick={onClose} />
      )}
      {!assetMode && onOpenSettings && !running && (
        <FollowButton action="settings" icon={<IconSettings />} label="渠道设置" onClick={onOpenSettings} />
      )}
    </div>
  )
}

/**
 * 提示词节点的**正文格式作栏**（用户 2026-09-21）。
 *
 * 节点本体上的正文是只读展示（双击 = 全选），所以这里没有「光标」可用——
 * 格式按钮作用于**整个正文的逐行**：
 * - 点 H2 → 正文每一行都变成 H2（对单行提示词就是「这行变标题」）；
 * - 点粗体 → 若已有选区信息可用就用，否则把整段包成粗体。
 *
 * 真正需要精细光标操作的场合是**全屏编辑灯箱**——那里有真实 textarea，
 * 按钮走的是完整的「按光标 / 选区变换」。两处共用同一份纯函数，
 * 差别只在「作用范围」（整段 vs 光标处）。
 */
function PromptFormatActions({ node, onClose }: { node: NodeSnapshot; onClose: () => void }) {
  const store = useCanvasStore()
  const text = (node.data as { text?: string }).text ?? ''

  const apply = (next: { text: string; start: number; end: number }) => {
    store.dispatch({
      kind: 'node.updateData',
      id: node.id,
      patch: { text: next.text },
      transient: false,
    })
  }

  const onAction = (action: FormatAction) => {
    // 节点栏无光标：整段处理（start=0, end=全文）
    if (action.kind === 'line') apply(applyLineFormat(text, 0, text.length, action.format))
    else if (action.kind === 'inline') apply(applyInlineFormat(text, 0, text.length, action.format))
    else if (action.kind === 'divider') apply(insertDivider(text, text.length, text.length))
    else if (action.kind === 'copy') void navigator.clipboard?.writeText(toPlainText(text))
  }

  return (
    <FormatToolbar
      activeLine={linePrefixOf(text, 0)}
      activeInline={{
        bold: text.startsWith('**') && text.endsWith('**') && text.length > 4,
        italic: text.startsWith('*') && text.endsWith('*') && !text.startsWith('**'),
      }}
      onAction={onAction}
      onToggleFullscreen={() => {
        store.openTextEditor(node.id)
        onClose()
      }}
      keepFocus
    />
  )
}

/**
 * 单个动作按钮：**图标 + 常驻中文**（用户 2026-09-17）。
 *
 * 中文始终显示（不是 hover 才展开），鼠标移到按钮上只把它变成实色块——
 * 与创作面板参数 chip 的 hover 反馈同一条规则（透明 → `--bg-hover`）。
 * `title` 给完整中文，长悬停时与可见文案一致。
 *
 * 图标是**内联 SVG**（`toolbar/icons`），不是文本字形 —— 字形的落点由字体决定，
 * 换台机器就可能偏上偏左（用户 2026-09-30：「节点功能栏的图标我不要符号，
 * 我要真正的矢量图」，与工具栏那个全角「＋」是同一条教训）。
 */
function FollowButton({
  action,
  icon,
  label,
  onClick,
}: {
  action: string
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={styles.btn}
      data-follow-action={action}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...keepCanvasFocus}
    >
      <span className={styles.glyph} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.label} data-follow-label={action}>
        {label}
      </span>
    </button>
  )
}
