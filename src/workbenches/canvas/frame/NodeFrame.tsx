import { useEffect, useRef, useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useSyncExternalStore } from 'react'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { ResizeLock } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { freeResize, lockedResize, type ResizeCorner } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { useCanvasStore } from '../storeContext'
import { assetPixelsOf, formatPixels } from './assetPixels'
import styles from './NodeFrame.module.css'

export type ResizePhase = 'begin' | 'move' | 'end'

/**
 * 四角手柄各自的定位类（CSS 里一只角一条：位置 + 光标方向 + 同心圆角）。
 *
 * 写成查表而不是拼字符串：CSS Modules 的类名只在构建时存在，
 * 拼出来的 `styles['corner' + x]` 拿不到（也就没有编译期检查）。
 */
const CORNER_CLASS: Record<ResizeCorner, string> = {
  se: styles.cornerSe,
  sw: styles.cornerSw,
  ne: styles.cornerNe,
  nw: styles.cornerNw,
}

export interface NodeFrameProps {
  node: NodeSnapshot
  selected: boolean
  /** 当前视口缩放，缩放手柄的屏幕位移需折算回世界单位 */
  scale: number
  minSize: { w: number; h: number }
  /**
   * 缩放锁比（§6.16），由装配层经 `resizeLockOf` 注入（视图层不算比例）：
   * `'free'` 自由；`'current'` 锁按下时比例；数字 = 锁定该 w/h 比例
   * （有内容的图片 / 视频节点 = `naturalSize`，分组 / 批量 = 5:4）。
   */
  resizeLock?: ResizeLock
  /**
   * 高度由内容决定（参数卡，见 `heightFromContentOf`）：缩放**只取横向位移**。
   *
   * 少了这一条，拖拽每帧写的 h 会与内容同步写的 h 互相覆盖 —— 用户看到的就是
   * 「拖到某个高度、松手跳到另一个高度」（2026-09-30 实测：332 → 380）。
   */
  heightFromContent?: boolean
  /**
   * 渲染哪几角的缩放手柄（缺省 `['se']` = 只有右下那只，与历史行为一致）。
   *
   * 用户 2026-10-06 第 13 批第 5 条：「组给…**四角可缩放**」⇒ 容器传 `RESIZE_CORNERS`。
   * 比例锁 / 高度归内容的节点**强制只有右下**（等比锚点与"高度不吃纵向位移"两条
   * 都只按右下角推导，多给几只角会给出没被验证过的矩形）。
   */
  resizeCorners?: readonly ResizeCorner[]
  /** 在节点任意位置按下：选中 + 发起拖动（由父层接线） */
  onFramePointerDown: (e: ReactPointerEvent) => void
  /**
   * 位置由**宿主**决定（React Flow 已把节点摆在 `position` 上；容器子节点由网格单元摆位）。
   *
   * 此时本组件不再写 `left/top`（写了就是二次偏移），但 `node.x / node.y` **仍按真实值使用** ——
   * 缩放矩形必须落在宿主的坐标系里。
   *
   * ⚠️ 以前靠调用方把 `x / y` **归零**来达到"不二次偏移"，代价是缩放手柄算出的矩形成了
   * `(0, 0, w, h)` ⇒ `node.resize` 把节点**写回世界原点**。用户 2026-10-06 第 13 批第 7 条
   * 报的「点击批量节点右下角的缩放的时候会位移」就是它：实测一次 +60/+48 的拖拽，
   * 节点从 (40,150) 被搬到 (64,15)（= 世界原点在屏幕上的位置），而尺寸是对的 ——
   * 所以只看尺寸的断言全都绿着。
   */
  selfPositioned?: boolean
  /** 缩放手柄提交绝对矩形（命令层 coalesce 合并） */
  onResize: (rect: Rect, phase: ResizePhase) => void
  onRename: (title: string) => void
  children?: ReactNode
  /**
   * 画在**框上**（`.body` 之外、`overflow: visible`）的额外内容。
   *
   * 存在的理由：React Flow 的 `Handle` 有一半伸在节点框外，放进 `.body`（`overflow: clip`）
   * 会被裁掉那半边、可点区域只剩一条缝；但手柄又必须待在 `[data-node-type]` **内部** ——
   * 冒烟与探针都按 `[data-node-type] [data-port]` 这种后代选择器找端点。
   * 这个插槽同时满足两条：在框内、不被裁。
   */
  overlay?: ReactNode
}

/**
 * 节点外框：标题（浮在节点外左上方，单击重命名）+ 左右端点 + 选中描边 + 右下角缩放手柄。
 * 结构只写一次，供全部节点类型复用（架构 §4.5）。
 *
 * **标题为什么在框外**（§6.6 通用规则「标题统一浮在节点外左上方」）：
 * 标题曾是框内一条 32px 头条，把节点内容区压掉 32px——容器的单元是固定 200×160，
 * 而空容器只有 240×192，减掉 32 后内容区仅 160 高、再减去 20 的内边距就只剩 140，
 * 单元底部会被裁掉 20px。标题移出后节点框整体就是内容区，尺寸与文档表格一致。
 *
 * **容器子节点不渲染标题**：容器内部是 16px 间隙的网格，浮在外面的标题会压到上一行；
 * 且容器内容区 `overflow: hidden` 也会把它裁掉。子节点的身份由内容本身表达。
 *
 * **为什么要吞掉原生 dragstart**：节点框是拖动把手，而框内往往是可选中的文字。
 * 按住文字拖动时浏览器会先起一个**原生文本拖拽**，随即 `pointercancel` 掐断指针流——
 * 后续 pointermove / pointerup 全部丢失，节点只挪起手第一拍就停住、松手也不触发归属判定。
 * `.frame` 的 `user-select: none` 已从源头避免选中，这里再挡一道原生拖拽（防御节点内
 * 将来嵌入选区型内容）。节点内的 `<img>` 本来就都是 `draggable={false}`。
 */
export function NodeFrame(props: NodeFrameProps) {
  const { node, selected, scale, minSize } = props
  /**
   * 节点的**最新快照**（每次渲染刷新）。
   *
   * 缩放的 `move` 回调闭包捕获的是**按下那一刻**的 props，读它拿到的是旧高度。
   * 「高度归内容」的节点要把高度原样带回去（不加纵向位移），用旧值就会把视图
   * 刚按内容写回的新高度又按回旧高度 —— 每帧来回一次，用户看到的是抽搐。
   */
  const nodeRef = useRef(props.node)
  nodeRef.current = props.node
  /** 缩放锁的**解析值**（与手柄的 `move` 里保持一致：组件内只解析一次） */
  const resizeLock = props.resizeLock ?? 'free'
  /**
   * 实际渲染哪几只角的手柄。比例锁 / 高度归内容的节点强制只有右下：
   * 等比锚点与"高度不吃纵向位移"两条都只按右下角推导（见 `resizeCorners` 的说明）。
   */
  const resizeCorners: readonly ResizeCorner[] =
    resizeLock !== 'free' || props.heightFromContent === true
      ? ['se']
      : props.resizeCorners ?? ['se']
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const store = useCanvasStore()
  /**
   * 产物像素（用户 2026-09-17）：**挂在节点外**的右上角、与节点名同一排。
   *
   * 为什么在标题排而不是节点内部：标题按 §6.6 浮在节点框之外，
   * 那一排是「描述这个节点」的位置（名字 + 读数），画进节点内部会压住素材本身。
   * 取值规则在 `./assetPixels`（纯函数，可单测），本层只渲染。
   */
  const pixels = assetPixelsOf(node)

  // 容器（分组 / 批量）的子节点：缩放手柄与标题都不渲染（尺寸由容器布局决定）。
  const inContainer = node.parentId !== null

  // 右键菜单「重命名」（§4.1）/ 标题单击进入编辑：store 置 renamingId 时本节点切入编辑态
  const renamingId = useSyncExternalStore(store.subscribe, store.getRenamingId, store.getRenamingId)
  useEffect(() => {
    if (renamingId === node.id) {
      setDraft(node.title)
      setEditing(true)
      store.endRename()
    }
  }, [renamingId, node.id, node.title, store])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    props.onRename(next || node.title)
    setEditing(false)
  }
  const cancel = () => {
    setDraft(node.title)
    setEditing(false)
  }

  const onResizePointerDown = (e: ReactPointerEvent, corner: ResizeCorner) => {
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const base: Rect = { x: node.x, y: node.y, w: node.w, h: node.h }
    /** 最后一帧的矩形——收尾（'end'）必须提交它，见下方 up() 的注释 */
    let latest: Rect = base
    props.onResize(latest, 'begin')
    // 锁比解析：数字 = 固定比例；'current' = 按下瞬间的容器比例；缺省 / 'free' = 自由
    const lock = resizeLock
    /**
     * 高度归内容的节点（`heightFromContent`）：高度**整份交给视图按内容写回**。
     *
     * 这里不只是「忽略纵向位移」，而是**连最小高度也不夹**：循环节点声明的最小高度
     * 380 其实是**开箱默认尺寸**（它由 `NODE_MINIMUMS` 兼任），而内容自适应会把它收到
     * 内容真正需要的高度（实测 320）。若在这一步又按 380 夹一次，用户一碰右下角就
     * 会看到节点「跳」到 380（2026-09-30 用户报的那个跳动就是它）。
     */
    const heightFromContent = props.heightFromContent === true
    const ratio = typeof lock === 'number' ? lock : lock === 'current' ? base.w / base.h : null
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale
      /** 高度归内容的节点：纵向位移**整份丢掉**（不是取一半），高度交给内容同步 */
      const dy = ((ev.clientY - startY) / scale) * (heightFromContent ? 0 : 1)
      if (ratio !== null) {
        latest = lockedResize(base, dx, dy, minSize, ratio)
      } else if (heightFromContent) {
        /** 高度归内容的节点只吃横向位移（纵向由内容写回），且只可能拖右下角 */
        latest = {
          x: base.x,
          y: base.y,
          w: Math.max(minSize.w, base.w + dx),
          h: nodeRef.current.h,
        }
      } else {
        /**
         * 自由缩放走**四角通用**的那只函数（对角固定、被拖的角跟手）——
         * 容器（分组 / 批量）有四只角，锚点不能写死成左上。见 `freeResize`。
         */
        latest = freeResize(base, corner, dx, dy, minSize)
      }
      props.onResize(latest, 'move')
    }
    const up = () => {
      // 收尾提交的是**最后一帧**而不是 base：命令层对 node.resize 一律按 rect 落盘
      // （coalesce 只合并撤销步骤、不看 phase），传 base 等于把整段缩放撤销回起点——
      // 松手即弹回原尺寸。
      props.onResize(latest, 'end')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      /**
       * ⚠️ **容器子节点要带 `nodrag`**：它是容器的 DOM 后代，而 React Flow 的拖动绑在
       * **原生 pointerdown** 上、从事件目标一路往上找（`hasSelector` 走到本节点的根为止）
       * —— 少了它，"拖子节点"会**同时把整个容器拖走**（实测：子节点位移 +440/+394 时
       * 组框也位移了 +440/+394，松手后子节点被弹到 (1019,1033)，组框飞出去）。
       * 子节点自己的拖动由画布表面那套控制器负责（`FlowChildFrame.onFramePointerDown`），
       * 不需要 RF 插手。
       */
      className={`${styles.frame} ${selected ? styles.selected : ''} ${inContainer ? 'nodrag' : ''}`}
      style={{
        left: props.selfPositioned === false ? 0 : node.x,
        top: props.selfPositioned === false ? 0 : node.y,
        width: node.w,
        height: node.h,
      }}
      data-node-id={node.id}
      data-node-type={node.type}
      /**
       * 选中态也落到 data 属性上，供**节点内部**（如生成节点的素材操作入口）
       * 用纯 CSS 判断「这个节点被选中了吗」。
       *
       * 为什么不能靠 class：选中类名是 CSS Module 的哈希（`.frame_xxx_selected`），
       * 节点视图在自己的 module 里选不到它。`data-node-stale` 早先就是同一套做法。
       */
      data-node-selected={selected ? '' : undefined}
      onPointerDown={props.onFramePointerDown}
      onDragStart={(e) => e.preventDefault()}
    >
      {!inContainer && (
        <div className={styles.header} data-node-header>
          {editing ? (
            <input
              ref={inputRef}
              className={styles.titleInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') cancel()
              }}
            />
          ) : (
            <span
              className={styles.title}
              data-node-title
              onDoubleClick={() => {
                setDraft(node.title)
                setEditing(true)
              }}
            >
              {node.title}
            </span>
          )}
          {pixels && (
            <span className={styles.pixels} data-node-pixels>
              {formatPixels(pixels)}
            </span>
          )}
        </div>
      )}


      <div className={styles.body}>{props.children}</div>

      {props.overlay}

      {!inContainer && (
        <>
          {resizeCorners.map((corner) => (
            /*
             * 锚点：`data-node-resize-handle` **只挂在右下那只**上（历史契约：自动化脚本、
             * `audit-doc.mjs`、SSR 守门都按它取"那个手柄"）；四只角都能用
             * `data-node-resize-corner="<se|sw|ne|nw>"` 精确点到某一角。
             */
            <span
              key={corner}
              /**
               * `nodrag` 是 **React Flow 的免拖动类名**（`noDragClassName` 默认值），
               * 必须带上：RF 的拖动是绑在**原生 pointerdown** 上的，而这里 `stopPropagation`
               * 只挡得住 React 合成事件、挡不住它 —— 于是「拖右下角缩放」会顺手发起一次节点拖动：
               * 节点一边缩放一边跟着指针跑，松手时还会被当成一次落点判定
               * （G57 实测：提示词节点缩放到一半被"拖进"了旁边的容器，尺寸读出来只有格位大小）。
               * 老表面没有这个坑（它的拖动是 React 事件，stopPropagation 就够）。
               */
              className={`${styles.resizeHandle} ${CORNER_CLASS[corner]} nodrag`}
              {...(corner === 'se' ? { 'data-node-resize-handle': '' } : {})}
              data-node-resize-corner={corner}
              onPointerDown={(e) => onResizePointerDown(e, corner)}
            />
          ))}
        </>
      )}
    </div>
  )
}
