import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCanvasStore, useGraph } from '../storeContext'
import { useAssetMeta } from '../hooks/useAsset'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { fingerprintBytes } from '../../../domain/shared/hash'
import { createId } from '../../../shared/id'
import {
  IconAnnotate,
  IconCheck,
  IconClose,
  IconRedo,
  IconRect,
  IconText,
  IconUndo,
} from '../toolbar/icons'
import type { GenerationData } from '../../../domain/canvas/model/node'
import styles from './AnnotateLayer.module.css'

// 「标注」编辑（用户 2026-10-05 第 10 条）：
// 「第一个功能是标注功能，相当于画笔，能在节点素材上进行画布的标注，有关闭标注功能的按钮、
//  画笔的按钮、矩形的按钮、文字的按钮、颜色的选择，画笔/矩形描边的大小，撤销按钮，
//  重做按钮，还有一个保存按钮」。
//
// 工具条按用户列的顺序排，一个不少：✕ / 画笔 / 矩形 / 文字 / 颜色 / 粗细 / 撤销 / 重做 / 保存。
//
// 两个工程决定：
// 1. 画布 = 图片的**原始像素尺寸**，显示时用 CSS 缩到屏幕上 —— 于是标注坐标天然是图片坐标，
//    保存时不用做任何换算（换算一次就多一处「屏幕上看着对、存下来偏了」的可能）。
// 2. 数据结构是**操作列表**而不是点阵：撤销 / 重做就是把列表切一刀，重放即得画面
//    （不需要保存 N 张快照）。

type Tool = 'brush' | 'rect' | 'text'

interface Point {
  x: number
  y: number
}

interface Op {
  tool: Tool
  color: string
  size: number
  points: Point[]
  text?: string
}

// 画笔颜色只用**固定色板**：画在图上要跟任何照片都分得开，也让撤销 / 重做可预期。
const COLORS = ['#e5484d', '#f5a524', '#f2e600', '#30a46c', '#0091ff', '#ffffff'] as const

export function AnnotateLayer() {
  const store = useCanvasStore()
  const graph = useGraph()
  const annotate = useSyncExternalStore(store.subscribe, store.getAnnotate, store.getAnnotate)
  const node = annotate ? graph.nodes.find((n) => n.id === annotate.nodeId) : undefined
  const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
  const meta = useAssetMeta(hash)

  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState<string>(COLORS[0])
  const [size, setSize] = useState(6)
  const [text, setText] = useState('')
  const [ops, setOps] = useState<Op[]>([])
  const [undone, setUndone] = useState<Op[]>([])
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef<Op | null>(null)

  const editingId = annotate?.nodeId ?? ''
  // 每次打开从空白开始（上一次的标注留着会直接盖在新图上）
  useEffect(() => {
    if (!editingId) return
    setOps([])
    setUndone([])
    setTool('brush')
    setText('')
  }, [editingId])

  // 把「底图 + 已确认的标注 + 正在画的那一笔」重画一遍
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img || !canvas.width) return
    const g2 = canvas.getContext('2d')
    if (!g2) return
    g2.clearRect(0, 0, canvas.width, canvas.height)
    g2.drawImage(img, 0, 0, canvas.width, canvas.height)
    const all = drawingRef.current ? [...ops, drawingRef.current] : ops
    for (const op of all) drawOp(g2, op)
  }, [ops])

  useEffect(() => {
    void redraw()
  }, [redraw, meta.url])

  // Esc 退出（与其它浮层一致）
  useEffect(() => {
    if (!annotate) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      store.closeAnnotateEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [annotate, store])

  if (!annotate || !node || !hash) return null

  // 事件坐标 → 图片像素坐标（画布按 CSS 缩放过，必须按比例换算回去）
  const pointOf = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointOf(e)
    if (tool === 'text') {
      if (!text.trim()) return
      const op: Op = { tool, color, size, points: [p], text: text.trim() }
      setOps((prev) => [...prev, op])
      setUndone([])
      return
    }
    ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
    drawingRef.current = { tool, color, size, points: [p] }
    redraw()
  }

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const draw = drawingRef.current
    if (!draw) return
    const p = pointOf(e)
    if (draw.tool === 'brush') draw.points.push(p)
    else draw.points[1] = p
    redraw()
  }

  const onUp = () => {
    const draw = drawingRef.current
    drawingRef.current = null
    if (!draw) return
    const a = draw.points[0]
    const b = draw.points[1]
    const tooSmall = draw.tool === 'rect' && (!a || !b || (Math.abs(b.x - a.x) < 3 && Math.abs(b.y - a.y) < 3))
    if (tooSmall) {
      redraw()
      return
    }
    setOps((prev) => [...prev, draw])
    setUndone([])
  }

  const undo = () => {
    setOps((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]!
      setUndone((u) => [last, ...u])
      return prev.slice(0, -1)
    })
  }

  const redo = () => {
    setUndone((prev) => {
      if (prev.length === 0) return prev
      const [first, ...rest] = prev
      setOps((o) => [...o, first!])
      return rest
    })
  }

  // 保存：把「底图 + 全部标注」合成一张新图，落到**原图右侧的新节点**上。
  //
  // 为什么另起一个节点而不是覆盖原图（与「提取选区」「宫格切分」同一条约定）：
  // 标注是派生内容，覆盖掉原图就再也回不去了 —— 撤销只能回退数据、回退不了像素。
  const save = async () => {
    if (!meta.url || saving) return
    setSaving(true)
    try {
      const canvas = canvasRef.current
      const img = imageRef.current
      if (!canvas || !img) return
      const g2 = canvas.getContext('2d')
      if (!g2) return
      g2.clearRect(0, 0, canvas.width, canvas.height)
      g2.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const op of ops) drawOp(g2, op)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const newHash = await fingerprintBytes(bytes)
      const width = canvas.width
      const height = canvas.height
      const size = assetNodeSize({ width, height })
      const rect = toWorldRectInGraph(node, graph)
      const id = createId('node')
      store.beginPlan(`annotate:${id}`, '保存标注')
      store.dispatch({
        kind: 'asset.put',
        asset: {
          hash: newHash,
          mime: 'image/png',
          bytes,
          width,
          height,
          createdAt: Date.now(),
          projectId: graph.projectId,
        },
      })
      store.dispatch({
        kind: 'node.create',
        projectId: graph.projectId,
        type: 'generation',
        at: { x: rect.x + rect.w + 48, y: rect.y },
        id,
        size,
        title: `${node.title} · 标注图`,
        data: {
          ...generationSpec.createDefaultData(),
          assetHash: newHash,
          naturalSize: { width, height },
          thumbOrder: [newHash],
        } as GenerationData,
      })
      store.endPlan()
      await store.flush()
      store.closeAnnotateEditor()
      store.setSelection([id])
      store.showUndoBar('已保存标注图')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.layer} data-annotate-layer>
      <div className={styles.toolbar} data-annotate-toolbar>
        <button
          type="button"
          className={styles.close}
          data-annotate-close
          title="关闭标注"
          aria-label="关闭标注"
          onClick={() => store.closeAnnotateEditor()}
        >
          <IconClose size={16} />
          <span className={styles.closeLabel}>标注</span>
        </button>
        <span className={styles.divider} />
        <ToolButton
          on={tool === 'brush'}
          name="brush"
          label="画笔"
          icon={<IconAnnotate size={16} />}
          onClick={() => setTool('brush')}
        />
        <ToolButton
          on={tool === 'rect'}
          name="rect"
          label="矩形"
          icon={<IconRect size={16} />}
          onClick={() => setTool('rect')}
        />
        <ToolButton
          on={tool === 'text'}
          name="text"
          label="文字"
          icon={<IconText size={16} />}
          onClick={() => setTool('text')}
        />
        {tool === 'text' && (
          <input
            className={styles.textInput}
            data-annotate-text-input
            placeholder="输入文字，再点图上放置"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <span className={styles.divider} />
        {/* 颜色：固定色板（圆点即色样，选中放大一圈） */}
        <span className={styles.colors}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === color ? styles.swatch + ' ' + styles.swatchOn : styles.swatch}
              data-annotate-color={c}
              aria-pressed={c === color}
              aria-label={'颜色 ' + c}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </span>
        {/* 粗细：画笔 / 矩形描边共用一条滑杆（用户原话：「画笔/矩形描边的大小」） */}
        <label className={styles.sizeWrap}>
          <span className={styles.sizeLabel}>粗细</span>
          <input
            className={styles.size}
            data-annotate-size
            type="range"
            min={2}
            max={48}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <span className={styles.sizeValue}>{size}</span>
        </label>
        <span className={styles.divider} />
        <ToolButton
          on={false}
          name="undo"
          label="撤销"
          disabled={ops.length === 0}
          icon={<IconUndo size={16} />}
          onClick={undo}
        />
        <ToolButton
          on={false}
          name="redo"
          label="重做"
          disabled={undone.length === 0}
          icon={<IconRedo size={16} />}
          onClick={redo}
        />
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.save}
          data-annotate-save
          disabled={saving}
          onClick={() => void save()}
        >
          <IconCheck size={16} />
          <span>保存</span>
        </button>
      </div>

      <div className={styles.stage}>
        {/* 底图只用来给 canvas 当绘制源 / 量自然尺寸，不直接显示 */}
        <img
          ref={(el) => {
            imageRef.current = el
          }}
          className={styles.hiddenImage}
          data-annotate-base
          src={meta.url ?? ''}
          alt=""
          onLoad={() => {
            const canvas = canvasRef.current
            const img = imageRef.current
            if (canvas && img) {
              canvas.width = img.naturalWidth
              canvas.height = img.naturalHeight
            }
            void redraw()
          }}
        />
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          data-annotate-canvas
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
    </div>
  )
}

// 把一条标注操作画到 2D 上下文上（撤销 / 重做 / 保存都走这同一个函数）
function drawOp(g2: CanvasRenderingContext2D, op: Op): void {
  g2.save()
  g2.strokeStyle = op.color
  g2.fillStyle = op.color
  g2.lineWidth = op.size
  g2.lineCap = 'round'
  g2.lineJoin = 'round'
  if (op.tool === 'brush') {
    g2.beginPath()
    op.points.forEach((p, i) => (i === 0 ? g2.moveTo(p.x, p.y) : g2.lineTo(p.x, p.y)))
    g2.stroke()
  } else if (op.tool === 'rect') {
    const a = op.points[0]
    const b = op.points[1] ?? a
    if (a && b) g2.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
  } else {
    const at = op.points[0]
    if (at && op.text) {
      g2.font = '600 ' + Math.max(14, op.size * 5) + 'px sans-serif'
      g2.textBaseline = 'top'
      g2.fillText(op.text, at.x, at.y)
    }
  }
  g2.restore()
}

function ToolButton({
  on,
  name,
  label,
  icon,
  disabled,
  onClick,
}: {
  on: boolean
  name: string
  label: string
  icon: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={on ? styles.tool + ' ' + styles.toolOn : styles.tool}
      data-annotate-tool={name}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}
