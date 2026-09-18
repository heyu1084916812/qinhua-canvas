import { useEffect, useRef, useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useSyncExternalStore } from 'react'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { ResizeLock } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { lockedResize } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { useCanvasStore } from '../storeContext'
import { assetPixelsOf, formatPixels } from './assetPixels'
import styles from './NodeFrame.module.css'

export type ResizePhase = 'begin' | 'move' | 'end'

export interface NodeFrameProps {
  node: NodeSnapshot
  selected: boolean
  /** 当前视口缩放，缩放手柄的屏幕位移需折算回世界单位 */
  scale: number
  ports: { input: boolean; output: boolean }
  minSize: { w: number; h: number }
  /**
   * 缩放锁比（§6.16），由装配层经 `resizeLockOf` 注入（视图层不算比例）：
   * `'free'` 自由；`'current'` 锁按下时比例；数字 = 锁定该 w/h 比例
   * （有内容的图片 / 视频节点 = `naturalSize`，分组 / 批量 = 5:4）。
   */
  resizeLock?: ResizeLock
  /** 在节点任意位置按下：选中 + 发起拖动（由父层接线） */
  onFramePointerDown: (e: ReactPointerEvent) => void
  /** 缩放手柄提交绝对矩形（命令层 coalesce 合并） */
  onResize: (rect: Rect, phase: ResizePhase) => void
  onRename: (title: string) => void
  /** 从端点按下开始拖线建连（§6.14）；不传则端点不可拖 */
  onPortPointerDown?: (e: ReactPointerEvent, side: 'input' | 'output') => void
  /** 隐藏端点（分组 / 批量子节点不显示端点；画板子节点显示以构成子图连线，§6.13） */
  portsHidden?: boolean
  children?: ReactNode
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
  const { node, selected, scale, ports, minSize } = props
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

  // 容器（分组 / 批量 / 画板）的子节点：缩放手柄不渲染（尺寸由容器布局决定）。
  // 端点：分组 / 批量子节点隐藏（§6.11「组内节点端点隐藏」）；
  // 画板子节点保留端点以便内部连线构成子图（§6.13 运行整个画板）。
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
    const ratio = typeof lock === 'number' ? lock : lock === 'current' ? base.w / base.h : null
    const move = (ev: PointerEvent) => {
      if (ratio !== null) {
        latest = lockedResize(
          base,
          (ev.clientX - startX) / scale,
          (ev.clientY - startY) / scale,
          minSize,
          ratio,
        )
      } else {
        latest = {
          x: base.x,
          y: base.y,
          w: Math.max(minSize.w, base.w + (ev.clientX - startX) / scale),
          h: Math.max(minSize.h, base.h + (ev.clientY - startY) / scale),
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

      {ports.input && !props.portsHidden && (
        <span
          className={`${styles.port} ${styles.portLeft}`}
          data-port="input"
          onPointerDown={(e) => {
            if (!props.onPortPointerDown) return
            e.stopPropagation()
            props.onPortPointerDown(e, 'input')
          }}
        />
      )}
      {ports.output && !props.portsHidden && (
        <span
          className={`${styles.port} ${styles.portRight}`}
          data-port="output"
          onPointerDown={(e) => {
            if (!props.onPortPointerDown) return
            e.stopPropagation()
            props.onPortPointerDown(e, 'output')
          }}
        />
      )}

      <div className={styles.body}>{props.children}</div>

      {!inContainer && (
        <span className={styles.resizeHandle} onPointerDown={onResizePointerDown} />
      )}
    </div>
  )
}
