import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardData, Stroke, TextItem, NodeType } from '../../../../domain/canvas/model/node'
import type { NodeViewProps } from '../registry'
import { clientToLogical, strokePath, makeStroke, makeText } from '../../../../domain/canvas/board/boardCanvas'
import styles from './BoardNodeView.module.css'

type Tool = 'select' | 'brush' | 'text'

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2, 10)
}

/** 画板内可新建的子节点类型（与工具栏新建菜单保持一致） */
const ADDABLE: { type: NodeType; label: string }[] = [
  { type: 'prompt', label: '提示词' },
  { type: 'generation', label: '图像生成' },
  { type: 'compare', label: '对比' },
]

/**
 * 画板节点视图（M4-1 绘制 + M4-2 容器）。
 * 层级（z）：背景(0) < 子节点层(1) < 绘制层(2) < 工具条(3)。
 * - 选择态：绘制层 pointer-events:none，点击穿透到子节点 / 画板本身（选中）。
 * - 画笔 / 文字态：绘制层接管指针，进行绘制。
 * 子节点层铺满内容区（标题已移出节点框，内容区即节点框），child local 坐标对齐画板 top-left。
 */
export function BoardNodeView(props: NodeViewProps) {
  const { node, size, selected, emit } = props
  const data = node.data as BoardData

  const surfaceRef = useRef<SVGSVGElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const drawingRef = useRef<Stroke | null>(null)
  const textPosRef = useRef<{ x: number; y: number } | null>(null)

  const [hovered, setHovered] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [brush, setBrush] = useState({ color: '#1a1a1a', width: 4, feather: 0 })
  const [textOpt, setTextOpt] = useState({ color: '#1a1a1a', size: 24, weight: 600 })
  const [draft, setDraft] = useState<Stroke | null>(null)
  const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const showBar = selected || hovered
  const children = props.childNodes ?? []
  const renderChild = props.renderChild

  // ── 画笔：按下起笔，window 监听移动 / 抬起，抬起提交一笔 ──
  const onSurfacePointerDown = (e: ReactPointerEvent) => {
    if (tool === 'select') return // 选择态：事件上浮给 NodeFrame（选中 / 拖动节点）
    e.stopPropagation()
    // 阻止本次 pointerdown 的默认焦点复位（非聚焦元素 → body），
    // 否则会将刚 autoFocus 的文字输入框立刻 blur 掉（§6.13 画板文字落位）。
    e.preventDefault()
    const surface = surfaceRef.current
    if (!surface) return

    if (tool === 'brush') {
      const rect = surface.getBoundingClientRect()
      const p = clientToLogical(rect, e.clientX, e.clientY, size.w, size.h)
      const s = makeStroke({ id: genId(), color: brush.color, width: brush.width, feather: brush.feather, points: [p] })
      drawingRef.current = s
      setDraft(s)
      const move = (ev: PointerEvent) => {
        const r = surfaceRef.current?.getBoundingClientRect()
        if (!r) return
        const np = clientToLogical(r, ev.clientX, ev.clientY, size.w, size.h)
        const cur = drawingRef.current
        if (!cur) return
        const next = { ...cur, points: [...cur.points, np] }
        drawingRef.current = next
        setDraft(next)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        const final = drawingRef.current
        drawingRef.current = null
        setDraft(null)
        if (final && final.points.length > 0) {
          emit({ type: 'updateData', patch: { strokes: [...data.strokes, final] }, transient: false })
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    } else if (tool === 'text') {
      const rect = surface.getBoundingClientRect()
      const p = clientToLogical(rect, e.clientX, e.clientY, size.w, size.h)
      textPosRef.current = p
      setTextDraft(p)
      setTextValue('')
    }
  }

  const commitText = () => {
    const pos = textPosRef.current
    if (pos && textValue.trim()) {
      const t = makeText({
        id: genId(),
        x: pos.x,
        y: pos.y,
        text: textValue.trim(),
        size: textOpt.size,
        color: textOpt.color,
        weight: textOpt.weight,
      })
      emit({ type: 'updateData', patch: { texts: [...data.texts, t] }, transient: false })
    }
    textPosRef.current = null
    setTextDraft(null)
    setTextValue('')
  }

  const setBg = (patch: Partial<BoardData['bg']>) =>
    emit({ type: 'updateData', patch: { bg: { ...data.bg, ...patch } }, transient: true })

  // 工具切换时若正在编辑文字则放弃
  const pickTool = (t: Tool) => {
    if (textDraft) {
      textPosRef.current = null
      setTextDraft(null)
      setTextValue('')
    }
    setTool(t)
  }

  const runBoard = () => emit({ type: 'requestRunBoard' })
  const createChild = (type: NodeType) => {
    emit({ type: 'createChild', nodeType: type })
    setAddOpen(false)
  }

  const surfaceClass = `${styles.surface} ${
    tool === 'select' ? styles.toolSelect : tool === 'brush' ? styles.toolBrush : styles.toolText
  }`

  return (
    <div
      className={styles.root}
      data-board-node
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        className={styles.bg}
        data-board-bg
        style={{ backgroundColor: data.bg.color, opacity: data.bg.opacity }}
      />

      {/* 子节点层（容器）：铺满内容区，子节点 local 坐标即对齐画板 top-left */}
      {renderChild && children.length > 0 && (
        <div className={styles.childLayer} data-board-children>
          {children.map((c) => renderChild(c, { preserveCoords: true }))}
        </div>
      )}

      <svg
        ref={surfaceRef}
        className={surfaceClass}
        data-board-surface
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
        onPointerDown={onSurfacePointerDown}
      >
        {data.strokes.map((s) => (
          <path
            key={s.id}
            d={strokePath(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={s.feather ? { filter: `blur(${s.feather}px)` } : undefined}
          />
        ))}
        {data.texts.map((t: TextItem) => (
          <text key={t.id} x={t.x} y={t.y} fontSize={t.size} fill={t.color} fontWeight={t.weight}>
            {t.text}
          </text>
        ))}
        {draft && (
          <path
            d={strokePath(draft.points)}
            fill="none"
            stroke={draft.color}
            strokeWidth={draft.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={draft.feather ? { filter: `blur(${draft.feather}px)` } : undefined}
          />
        )}
      </svg>

      {textDraft && (
        <input
          ref={inputRef}
          className={styles.textInput}
          data-board-text-input
          autoFocus
          style={{
            left: `${(textDraft.x / Math.max(1, size.w)) * 100}%`,
            top: `${(textDraft.y / Math.max(1, size.h)) * 100}%`,
            fontSize: textOpt.size,
            color: textOpt.color,
            fontWeight: textOpt.weight,
          }}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitText()
            } else if (e.key === 'Escape') {
              textPosRef.current = null
              setTextDraft(null)
              setTextValue('')
            }
          }}
        />
      )}

      {showBar && (
        <div className={styles.toolbar} data-board-toolbar onPointerDown={(e) => e.stopPropagation()}>
          <div className={styles.toolGroup}>
            <button
              type="button"
              className={`${styles.toolBtn} ${tool === 'select' ? styles.active : ''}`}
              data-board-tool="select"
              onClick={() => pickTool('select')}
            >
              选择
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${tool === 'brush' ? styles.active : ''}`}
              data-board-tool="brush"
              onClick={() => pickTool('brush')}
            >
              画笔
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${tool === 'text' ? styles.active : ''}`}
              data-board-tool="text"
              onClick={() => pickTool('text')}
            >
              文字
            </button>
          </div>

          <div className={styles.toolGroup}>
            <button
              type="button"
              className={styles.runBtn}
              data-board-run
              onClick={runBoard}
              title="运行整个画板（拓扑重跑画板内节点）"
            >
              ▶ 运行画板
            </button>
            <div className={styles.addWrap}>
              <button
                type="button"
                className={styles.toolBtn}
                data-board-create
                onClick={() => setAddOpen((v) => !v)}
              >
                ＋ 新建
              </button>
              {addOpen && (
                <div className={styles.addMenu} data-board-create-menu>
                  {ADDABLE.map((a) => (
                    <button
                      key={a.type}
                      type="button"
                      className={styles.addItem}
                      data-board-create-item={a.type}
                      onClick={() => createChild(a.type)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {tool === 'brush' && (
            <div className={styles.toolGroup}>
              <label className={styles.field}>
                <input
                  type="color"
                  value={brush.color}
                  onChange={(e) => setBrush((b) => ({ ...b, color: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                粗细
                <input
                  type="number"
                  min={1}
                  max={80}
                  value={brush.width}
                  onChange={(e) => setBrush((b) => ({ ...b, width: Number(e.target.value) || 1 }))}
                />
              </label>
              <label className={styles.field}>
                羽化
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={brush.feather}
                  onChange={(e) => setBrush((b) => ({ ...b, feather: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>
          )}

          {tool === 'text' && (
            <div className={styles.toolGroup}>
              <label className={styles.field}>
                <input
                  type="color"
                  value={textOpt.color}
                  onChange={(e) => setTextOpt((t) => ({ ...t, color: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                字号
                <input
                  type="number"
                  min={8}
                  max={200}
                  value={textOpt.size}
                  onChange={(e) => setTextOpt((t) => ({ ...t, size: Number(e.target.value) || 8 }))}
                />
              </label>
              <label className={styles.field}>
                字重
                <select
                  value={textOpt.weight}
                  onChange={(e) => setTextOpt((t) => ({ ...t, weight: Number(e.target.value) }))}
                >
                  <option value={400}>常规</option>
                  <option value={600}>中粗</option>
                  <option value={700}>粗体</option>
                </select>
              </label>
            </div>
          )}

          <div className={styles.toolGroup}>
            <label className={styles.field}>
              背景
              <input
                type="color"
                data-board-bg-color
                value={data.bg.color}
                onChange={(e) => setBg({ color: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              透明
              <input
                type="range"
                data-board-bg-opacity
                min={0}
                max={1}
                step={0.05}
                value={data.bg.opacity}
                onChange={(e) => setBg({ opacity: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
