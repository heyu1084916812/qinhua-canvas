import { useEffect, useRef, useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useSyncExternalStore } from 'react'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { ResizeLock } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { lockedResize } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { portMagnet } from '../../../domain/canvas/geometry/portMagnet'
import { portDeclsOf, type NodePorts } from '../../../domain/canvas/nodeSpecs/ports'
import { useCanvasStore } from '../storeContext'
import { assetPixelsOf, formatPixels } from './assetPixels'
import styles from './NodeFrame.module.css'

export type ResizePhase = 'begin' | 'move' | 'end'

/**
 * 端点磁吸参数（§6.14，用户 2026-09-19）。
 *
 * `radius`：感应圈半径（视觉像素，从圆心算）。命中区是 15（14 直径 + ::after 扩 8），
 * 首版取 34（命中区再外放一圈），用户实测「太小、要凑很近才浮现」，
 * 故放大到 68——命中区的四倍多，隔一段距离就能感觉得到，不必精确对上去。
 * `maxPull`：最大吸附位移。刻意取小值——端点要**跟手但不出格**，
 * 吸得太远会脱离节点边框，反而看不出它属于哪个节点。
 */
const MAGNET_OPTS = { radius: 68, maxPull: 8 }

export interface NodeFrameProps {
  node: NodeSnapshot
  selected: boolean
  /** 当前视口缩放，缩放手柄的屏幕位移需折算回世界单位 */
  scale: number
  /** 端点声明：默认那对 + 附加口（§6.23 融合节点的 `patch`） */
  ports: NodePorts
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
  /** 在节点任意位置按下：选中 + 发起拖动（由父层接线） */
  onFramePointerDown: (e: ReactPointerEvent) => void
  /** 缩放手柄提交绝对矩形（命令层 coalesce 合并） */
  onResize: (rect: Rect, phase: ResizePhase) => void
  onRename: (title: string) => void
  /** 从端点按下开始拖线建连（§6.14）；不传则端点不可拖。`portId` 是具体口（§6.23） */
  onPortPointerDown?: (e: ReactPointerEvent, portId: string) => void
  /** 隐藏端点（分组 / 批量子节点不显示端点） */
  portsHidden?: boolean
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const store = useCanvasStore()
  /**
   * 端点的「磁吸」状态（用户 2026-09-19）。
   *
   * 语义：指针进入端点附近的**感应圈**时，端点浮现并朝指针方向吸过去（像磁铁），
   * 离开感应圈则弹回原位、淡出。左右两个端点各自独立。
   *
   * 为什么用 JS 算距离、而不是 CSS `:hover` 放大命中区：
   * 端点隐形时 `opacity:0` 但**仍占位、仍可命中**，`:hover` 会让「看不见的东西
   * 已经生效」——用户觉得诡异。按**指针到圆心的距离**判定则完全由几何驱动：
   * 看得见的浮现范围 = 真正生效的范围，二者一致。
   */
  /**
   * 端口元素表：key = 端口 id。
   *
   * 之前是 `inputRef` / `outputRef` 两个具名 ref —— 只够两端口。融合节点有三只
   * （左 `input`、右 `patch`、右 `output`），故改成按声明驱动的一张表，
   * 端口再多也不必改这一段。
   */
  const decls = portDeclsOf(props.ports)
  const portRefs = useRef(new Map<string, HTMLSpanElement | null>())
  const [hotPort, setHotPort] = useState<string | null>(null)
  useEffect(() => {
    /**
     * 端点圆心 = 节点边框左右中点；用 getBoundingClientRect 拿实时位置，
     * 这样画布缩放 / 平移 / 节点拖动都不用重算——每次都问 DOM 要真值。
     */
    /**
     * 端点**未位移时**的圆心。
     *
     * 必须减掉当前挂着的吸附位移：`getBoundingClientRect` 会把 `transform` 算进去，
     * 直接用它会在「已吸过去的位置」上再算一次距离——越吸越偏，是个自我放大的回路。
     * 读 `offsetWidth` / `offsetHeight` 拿的是布局尺寸（不含 transform），正是我们想要的。
     */
    const centerOf = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      const shift = el.dataset.snapShift
      let sx = 0
      let sy = 0
      if (shift) {
        const [tx, ty] = shift.split(',').map(Number)
        sx = Number.isFinite(tx) ? tx : 0
        sy = Number.isFinite(ty) ? ty : 0
      }
      return { x: r.left + r.width / 2 - sx, y: r.top + r.height / 2 - sy }
    }
    const onMove = (e: PointerEvent) => {
      /**
       * 逐个端点问几何层要「吸不吸、吸多少」，取最近的那个生效。
       * 判定与位移量都在 domain（portMagnet，可单测），这里只做 DOM 读写。
       */
      const pointer = { x: e.clientX, y: e.clientY }
      const magnets = [...portRefs.current.entries()].map(([id, el]) => {
        const c = centerOf(el)
        if (!c) return null
        return { id, el: el as HTMLElement, m: portMagnet(c, pointer, MAGNET_OPTS), dist: Math.hypot(pointer.x - c.x, pointer.y - c.y) }
      })
      const hot = magnets
        .filter((x): x is NonNullable<typeof x> => !!x && x.m.hot)
        .sort((a, b) => a.dist - b.dist)[0]
      setHotPort(hot ? hot.id : null)
      /** 位移只作用在「热」的那个端点；另一个必须回到 0，否则会残留偏移 */
      for (const [id, el] of portRefs.current.entries()) {
        if (!el) continue
        const on = !!hot && id === hot.id
        if (on) {
          el.dataset.snapShift = `${hot.m.dx},${hot.m.dy}`
          el.style.transform = `translate(${hot.m.dx}px, ${hot.m.dy}px)`
        } else {
          delete el.dataset.snapShift
          el.style.transform = ''
        }
      }
    }
    const onLeave = () => {
      setHotPort(null)
      for (const el of portRefs.current.values()) {
        if (!el) continue
        delete el.dataset.snapShift
        el.style.transform = ''
      }
    }
    window.addEventListener('pointermove', onMove)
    /** 指针离开窗口（切标签 / 移出视口）也要复位，否则端点停在吸附位置 */
    window.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])
  /**
   * 产物像素（用户 2026-09-17）：**挂在节点外**的右上角、与节点名同一排。
   *
   * 为什么在标题排而不是节点内部：标题按 §6.6 浮在节点框之外，
   * 那一排是「描述这个节点」的位置（名字 + 读数），画进节点内部会压住素材本身。
   * 取值规则在 `./assetPixels`（纯函数，可单测），本层只渲染。
   */
  const pixels = assetPixelsOf(node)

  // 容器（分组 / 批量）的子节点：缩放手柄不渲染（尺寸由容器布局决定）。
  // 端点：分组 / 批量子节点隐藏（§6.11「组内节点端点隐藏」）。
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

  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const base: Rect = { x: node.x, y: node.y, w: node.w, h: node.h }
    /** 最后一帧的矩形——收尾（'end'）必须提交它，见下方 up() 的注释 */
    let latest: Rect = base
    props.onResize(latest, 'begin')
    // 锁比解析：数字 = 固定比例；'current' = 按下瞬间的容器比例；缺省 / 'free' = 自由
    const lock = props.resizeLock ?? 'free'
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
      } else {
        latest = {
          x: base.x,
          y: base.y,
          w: Math.max(minSize.w, base.w + dx),
          /** 高度归内容时带**最新**高度回去（不是按下那一刻的），见 `nodeRef` 的说明 */
          h: heightFromContent ? nodeRef.current.h : Math.max(minSize.h, base.h + dy),
        }
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
      className={`${styles.frame} ${selected ? styles.selected : ''}`}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
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

      {!props.portsHidden &&
        decls.map((decl) => (
          <span
            key={decl.id}
            ref={(el) => {
              portRefs.current.set(decl.id, el)
            }}
            className={`${styles.port} ${
              decl.side === 'left' ? styles.portLeft : styles.portRight
            } ${hotPort === decl.id ? styles.hot : ''}`}
            /**
             * 纵向位置由声明给：默认口是 0.5（中点），融合节点的 `patch` 是 0.22。
             * 用 `top` 而不是 `margin-top`，否则多口之间的距离要靠手算像素。
             */
            style={{ top: `${decl.y * 100}%` }}
            data-port={decl.id}
            data-port-kind={decl.kind}
            {...(decl.label ? { title: decl.label, 'aria-label': decl.label } : {})}
            onPointerDown={(e) => {
              if (!props.onPortPointerDown) return
              e.stopPropagation()
              props.onPortPointerDown(e, decl.id)
            }}
          />
        ))}

      <div className={styles.body}>{props.children}</div>

      {props.overlay}

      {!inContainer && (
        // `data-node-resize-handle`：给自动化一个稳定锚点（别靠「最后一个 span」这种结构巧合）
        <span
          /**
           * `nodrag` 是 **React Flow 的免拖动类名**（`noDragClassName` 默认值），
           * 必须带上：RF 的拖动是绑在**原生 pointerdown** 上的，而这里 `stopPropagation`
           * 只挡得住 React 合成事件、挡不住它 —— 于是「拖右下角缩放」会顺手发起一次节点拖动：
           * 节点一边缩放一边跟着指针跑，松手时还会被当成一次落点判定
           * （G57 实测：提示词节点缩放到一半被"拖进"了旁边的容器，尺寸读出来只有格位大小）。
           * 老表面没有这个坑（它的拖动是 React 事件，stopPropagation 就够）。
           */
          className={`${styles.resizeHandle} nodrag`}
          data-node-resize-handle
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>
  )
}
