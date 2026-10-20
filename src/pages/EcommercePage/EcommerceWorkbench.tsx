import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  EcommerceCanvasItem,
} from '../../domain/ecommerce/canvasItem'
import {
  findFreeWorkbenchPosition,
  snapWorkbenchMove,
} from '../../domain/ecommerce/canvasItem'
import type { EcommerceResultRecord, EcommerceTaskRecord } from '../../domain/ecommerce/tasks'
import {
  screenToWorld as canvasScreenToWorld,
  type Viewport as CanvasViewport,
} from '../../domain/canvas/geometry/coords'
import { fitViewport, panBy, zoomAt } from '../../domain/canvas/geometry/transform'
import { createId } from '../../shared/id'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import styles from './EcommerceWorkbench.module.css'

type WorkbenchTool = 'select' | 'hand'
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface Viewport {
  x: number
  y: number
  scale: number
}

interface Point {
  x: number
  y: number
}

interface Interaction {
  kind: 'move' | 'resize' | 'rotate' | 'pan'
  itemId?: string
  handle?: ResizeHandle
  startClient: Point
  startViewport: Viewport
  startItem?: EcommerceCanvasItem
  startWorld: Point
  center?: Point
  startAngle?: number
  moved: boolean
}

export type EcommerceWorkbenchAction =
  | 'download'
  | 'canvas'
  | 'edit'
  | 'crop'
  | 'extract'
  | 'annotate'
  | 'rotate'
  | 'upscale'
  | 'save'

interface EcommerceWorkbenchProps {
  projectId: string
  items: readonly EcommerceCanvasItem[]
  results: readonly EcommerceResultRecord[]
  tasks: readonly EcommerceTaskRecord[]
  /** 当前活跃批次，用于兼容既有失败卡与结果状态锚点。 */
  activeResults?: readonly EcommerceResultRecord[]
  running?: boolean
  availableActions?: readonly EcommerceWorkbenchAction[]
  onItemsChange: (items: EcommerceCanvasItem[]) => void
  onCanvasUpload?: (file: File) => Promise<{ hash: string; width?: number; height?: number } | null>
  onAction?: (resultId: string, action: EcommerceWorkbenchAction) => void
  onRemoveFailed?: (resultId: string) => void
  channelLabelOf?: (channelId: string) => string
}

const MIN_SCALE = 0.1
const MAX_SCALE = 4
const MIN_ITEM_SIZE = 96

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function toCanvasViewport(viewport: Viewport): CanvasViewport {
  return {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    zoom: viewport.scale,
  }
}

function fromCanvasViewport(viewport: CanvasViewport): Viewport {
  return {
    x: -viewport.x * viewport.zoom,
    y: -viewport.y * viewport.zoom,
    scale: viewport.zoom,
  }
}

function screenToWorkbenchWorld(
  point: Point,
  viewport: Viewport,
  rect: DOMRect,
): Point {
  return canvasScreenToWorld(point, toCanvasViewport(viewport), {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
  })
}

function itemScreenRect(item: EcommerceCanvasItem, viewport: Viewport): {
  left: number
  top: number
  width: number
  height: number
} {
  return {
    left: viewport.x + item.x * viewport.scale,
    top: viewport.y + item.y * viewport.scale,
    width: item.width * viewport.scale,
    height: item.height * viewport.scale,
  }
}

function ToolIcon({ name }: { name: WorkbenchTool | 'upload' | 'text' | 'grid' | 'undo' | 'redo' | 'log' | 'close' | 'download' | 'canvas' | 'edit' | 'crop' | 'extract' | 'annotate' | 'rotate' | 'upscale' | 'save' }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'select') {
    return <svg {...common}><path d="m5 3 11 8-5.2 1.3L8 18Z" /><path d="m12.5 14 3.2 5" /></svg>
  }
  if (name === 'hand') {
    return <svg {...common}><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11" /><path d="M10 10V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M13 10V7a1.5 1.5 0 0 1 3 0v4" /><path d="M16 11V9a1.5 1.5 0 0 1 3 0v5a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.3-1.2L5 15.5a1.6 1.6 0 0 1 2.2-2.3L9 15" /></svg>
  }
  if (name === 'upload') {
    return <svg {...common}><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
  }
  if (name === 'text') {
    return <svg {...common}><path d="M5 5h14" /><path d="M12 5v14" /><path d="M8 19h8" /></svg>
  }
  if (name === 'grid') {
    return <svg {...common}><path d="M4 4h16v16H4z" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></svg>
  }
  if (name === 'undo' || name === 'redo') {
    return <svg {...common}><path d={name === 'undo' ? 'M9 7 4 12l5 5' : 'm15 7 5 5-5 5'} /><path d={name === 'undo' ? 'M4 12h9a6 6 0 0 1 6 6' : 'M20 12h-9a6 6 0 0 0-6 6'} /></svg>
  }
  if (name === 'log') {
    return <svg {...common}><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
  }
  if (name === 'close') {
    return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>
  }
  if (name === 'download') {
    return <svg {...common}><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 19h14" /></svg>
  }
  if (name === 'canvas') {
    return <svg {...common}><path d="M4 5h16v14H4z" /><path d="m7 15 3-3 2.5 2.5L16 11l3 3" /><circle cx="9" cy="8.5" r="1.2" /></svg>
  }
  if (name === 'edit') {
    return <svg {...common}><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8Z" /><path d="m13.8 7 3.2 3.2" /></svg>
  }
  if (name === 'crop') {
    return <svg {...common}><path d="M7 3v14a2 2 0 0 0 2 2h12" /><path d="M3 7h14a2 2 0 0 1 2 2v12" /></svg>
  }
  if (name === 'extract') {
    return <svg {...common}><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><path d="M8 12h8" /></svg>
  }
  if (name === 'annotate') {
    return <svg {...common}><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8Z" /><path d="M4 4h6" /></svg>
  }
  if (name === 'rotate') {
    return <svg {...common}><path d="M20 11a8 8 0 1 0-2.4 5.7" /><path d="M20 5v6h-6" /></svg>
  }
  if (name === 'upscale') {
    return <svg {...common}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="M8 12h8" /></svg>
  }
  return <svg {...common}><path d="M5 4h14v16l-7-3-7 3z" /></svg>
}

function WorkbenchMedia({ item }: { item: EcommerceCanvasItem }) {
  const meta = useAssetMeta(item.assetHash, { preferThumb: true })
  if (!item.assetHash) return <span className={styles.missing}>素材不存在</span>
  if (!meta.url) return <span className={styles.mediaLoading}>载入中…</span>
  if ((item.kind === 'video' || meta.mime?.startsWith('video/'))) {
    return (
      <video
        className={styles.media}
        src={meta.url}
        controls
        playsInline
        preload="metadata"
        onPointerDown={(event) => event.stopPropagation()}
      />
    )
  }
  return <img className={styles.media} src={meta.url} alt="" draggable={false} />
}

function elapsedLabel(task: EcommerceTaskRecord): string {
  const ms = Math.max(0, task.updatedAt - task.createdAt)
  if (ms < 1000) return '<1s'
  return `${Math.round(ms / 1000)}s`
}

function RunningWorkbenchResult({ result }: { result: EcommerceResultRecord }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div
      className={styles.runningItem}
      data-ecommerce-result
      data-ecommerce-result-id={result.nodeId}
      data-status="running"
      data-ecommerce-result-overlay="running"
    >
      <span className={styles.runningOrbit} data-ecommerce-result-orbit aria-hidden />
      <span data-ecommerce-result-elapsed={seconds}>生成中 {seconds}s</span>
    </div>
  )
}

export function EcommerceWorkbench({
  projectId,
  items,
  results,
  tasks,
  activeResults = [],
  running = false,
  availableActions = ['download', 'canvas'],
  onItemsChange,
  onCanvasUpload,
  onAction,
  onRemoveFailed,
  channelLabelOf,
}: EcommerceWorkbenchProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const actionPanelRef = useRef<HTMLElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const interactionRef = useRef<Interaction | null>(null)
  const undoRef = useRef<EcommerceCanvasItem[][]>([])
  const redoRef = useRef<EcommerceCanvasItem[][]>([])
  const textEditHistoryRef = useRef(new Set<string>())
  const [localItems, setLocalItems] = useState<EcommerceCanvasItem[]>([...items])
  const localItemsRef = useRef<EcommerceCanvasItem[]>([...items])
  const [viewport, setViewport] = useState<Viewport>({ x: 48, y: 48, scale: 0.72 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<WorkbenchTool>('select')
  const [gridSize, setGridSize] = useState<number | null>(16)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [actionPanelHeight, setActionPanelHeight] = useState(420)
  const [historyVersion, setHistoryVersion] = useState(0)
  const lastItemCountRef = useRef(0)

  useEffect(() => {
    if (interactionRef.current) return
    localItemsRef.current = [...items]
    setLocalItems([...items])
  }, [items])

  const updateLocalItems = useCallback(
    (
      updater:
        | EcommerceCanvasItem[]
        | ((current: EcommerceCanvasItem[]) => EcommerceCanvasItem[]),
    ) => {
      const next =
        typeof updater === 'function'
          ? updater(localItemsRef.current)
          : updater
      localItemsRef.current = next
      setLocalItems(next)
      return next
    },
    [],
  )

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      setViewport((current) => {
        const canvasViewport = toCanvasViewport(current)
        if (!event.ctrlKey && !event.metaKey) {
          return fromCanvasViewport(
            panBy(
              canvasViewport,
              event.shiftKey ? -event.deltaY : 0,
              event.shiftKey ? 0 : -event.deltaY,
            ),
          )
        }
        const zoom = clamp(
          current.scale * Math.exp(-event.deltaY * 0.0015),
          MIN_SCALE,
          MAX_SCALE,
        )
        return fromCanvasViewport(
          zoomAt(
            canvasViewport,
            { x: event.clientX, y: event.clientY },
            { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
            zoom,
          ),
        )
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const resultById = useMemo(
    () => new Map(results.map((result) => [result.id, result])),
    [results],
  )
  const selected = localItems.find((item) => item.id === selectedId) ?? null
  const selectedResult = selected?.resultId ? resultById.get(selected.resultId) ?? null : null
  const failedResults = activeResults.filter((result) => result.status === 'failed')
  const runningResults = activeResults.filter(
    (result) => result.status === 'pending' || result.status === 'running',
  )

  const fitAll = useCallback(() => {
    if (!viewportRef.current || localItems.length === 0) {
      setViewport({ x: 48, y: 48, scale: 1 })
      return
    }
    const rect = viewportRef.current.getBoundingClientRect()
    setViewport(fromCanvasViewport(
      fitViewport(
        localItems.map((item) => ({
          x: item.x,
          y: item.y,
          w: item.width,
          h: item.height,
        })),
        { x: 0, y: 0, w: rect.width, h: rect.height },
        72,
      ),
    ))
  }, [localItems])

  useEffect(() => {
    if (lastItemCountRef.current === 0 && localItems.length > 0) fitAll()
    lastItemCountRef.current = localItems.length
  }, [fitAll, localItems.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (event.code === 'Space') {
        event.preventDefault()
        setSpaceHeld(true)
      }
      if (event.key.toLowerCase() === 'v') setTool('select')
      if (event.key.toLowerCase() === 'h') setTool('hand')
      if (event.key === '0') fitAll()
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        commitItems(localItems.filter((item) => item.id !== selectedId))
        setSelectedId(null)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const commitItems = useCallback(
    (next: EcommerceCanvasItem[], remember = true) => {
      if (remember) {
        undoRef.current.push([...localItemsRef.current])
        if (undoRef.current.length > 80) undoRef.current.shift()
        redoRef.current = []
        setHistoryVersion((value) => value + 1)
      }
      localItemsRef.current = next
      setLocalItems(next)
      onItemsChange(next)
    },
    [onItemsChange],
  )

  const undo = () => {
    const previous = undoRef.current.pop()
    if (!previous) return
    redoRef.current.push([...localItemsRef.current])
    localItemsRef.current = previous
    setLocalItems(previous)
    onItemsChange(previous)
    setHistoryVersion((value) => value + 1)
  }

  const redo = () => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push([...localItemsRef.current])
    localItemsRef.current = next
    setLocalItems(next)
    onItemsChange(next)
    setHistoryVersion((value) => value + 1)
  }

  const beginMove = (event: ReactPointerEvent, item: EcommerceCanvasItem) => {
    if (event.button !== 0 || tool === 'hand' || spaceHeld) return
    if ((event.target as HTMLElement).closest('textarea, input, select, [contenteditable="true"]')) {
      return
    }
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setSelectedId(item.id)
    interactionRef.current = {
      kind: 'move',
      itemId: item.id,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
      startItem: item,
      startWorld: screenToWorkbenchWorld({ x: event.clientX, y: event.clientY }, viewport, rect),
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginResize = (
    event: ReactPointerEvent,
    item: EcommerceCanvasItem,
    handle: ResizeHandle,
  ) => {
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    interactionRef.current = {
      kind: 'resize',
      itemId: item.id,
      handle,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
      startItem: item,
      startWorld: screenToWorkbenchWorld({ x: event.clientX, y: event.clientY }, viewport, rect),
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginRotate = (event: ReactPointerEvent, item: EcommerceCanvasItem) => {
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const world = screenToWorkbenchWorld({ x: event.clientX, y: event.clientY }, viewport, rect)
    const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 }
    interactionRef.current = {
      kind: 'rotate',
      itemId: item.id,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
      startItem: item,
      startWorld: world,
      center,
      startAngle: Math.atan2(world.y - center.y, world.x - center.x) - (item.rotation * Math.PI) / 180,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && tool !== 'hand' && !spaceHeld) return
    event.preventDefault()
    interactionRef.current = {
      kind: 'pan',
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
      startWorld: { x: 0, y: 0 },
      moved: false,
    }
  }

  const finishInteraction = useCallback(() => {
    const interaction = interactionRef.current
    if (!interaction) return
    interactionRef.current = null
    setGuides({ x: null, y: null })
    if (interaction.kind !== 'pan' && interaction.moved) {
      undoRef.current.push([...items])
      redoRef.current = []
      setHistoryVersion((value) => value + 1)
      onItemsChange(localItemsRef.current)
    }
  }, [items, onItemsChange])

  const rotateWithPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const interaction = interactionRef.current
    const rect = viewportRef.current?.getBoundingClientRect()
    if (
      !interaction ||
      interaction.kind !== 'rotate' ||
      !interaction.center ||
      !interaction.startItem ||
      !rect
    ) {
      return
    }
    const world = screenToWorkbenchWorld(
      { x: event.clientX, y: event.clientY },
      interaction.startViewport,
      rect,
    )
    const angle =
      (Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x) -
        (interaction.startAngle ?? 0)) *
      (180 / Math.PI)
    interaction.moved = true
    updateLocalItems((current) =>
      current.map((candidate) =>
        candidate.id === interaction.itemId ? { ...candidate, rotation: angle } : candidate,
      ),
    )
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current
      if (!interaction) return
      const dx = event.clientX - interaction.startClient.x
      const dy = event.clientY - interaction.startClient.y
      if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true
      if (interaction.kind === 'pan') {
        setViewport(fromCanvasViewport(
          panBy(toCanvasViewport(interaction.startViewport), dx, dy),
        ))
        return
      }
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect || !interaction.startItem || !interaction.itemId) return
      const item = interaction.startItem
      if (interaction.kind === 'move') {
        const world = screenToWorkbenchWorld({ x: event.clientX, y: event.clientY }, interaction.startViewport, rect)
        const rawX = item.x + world.x - interaction.startWorld.x
        const rawY = item.y + world.y - interaction.startWorld.y
        const snapped = snapWorkbenchMove(
          item,
          rawX,
          rawY,
          localItemsRef.current.filter((candidate) => candidate.id !== item.id),
          interaction.startViewport.scale,
          gridSize ?? 0,
        )
        setGuides(snapped.guides)
        updateLocalItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, x: snapped.x, y: snapped.y } : candidate,
          ),
        )
        return
      }
      if (interaction.kind === 'rotate' && interaction.center) {
        const world = screenToWorkbenchWorld({ x: event.clientX, y: event.clientY }, interaction.startViewport, rect)
        const angle =
          (Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x) -
            (interaction.startAngle ?? 0)) *
          (180 / Math.PI)
        updateLocalItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, rotation: angle } : candidate,
          ),
        )
        return
      }
      if (interaction.kind === 'resize' && interaction.handle) {
        const world = screenToWorkbenchWorld({ x: event.clientX, y: event.clientY }, interaction.startViewport, rect)
        const handle = interaction.handle
        const aspect = item.width / Math.max(1, item.height)
        let width = item.width
        let height = item.height
        let x = item.x
        let y = item.y
        if (handle.includes('e')) width = Math.max(MIN_ITEM_SIZE, item.width + world.x - interaction.startWorld.x)
        if (handle.includes('s')) height = Math.max(MIN_ITEM_SIZE, item.height + world.y - interaction.startWorld.y)
        if (handle.includes('w')) {
          width = Math.max(MIN_ITEM_SIZE, item.width - (world.x - interaction.startWorld.x))
          x = item.x + item.width - width
        }
        if (handle.includes('n')) {
          height = Math.max(MIN_ITEM_SIZE, item.height - (world.y - interaction.startWorld.y))
          y = item.y + item.height - height
        }
        if (handle.length === 2 && item.aspectLocked) {
          const scale = Math.max(width / item.width, height / item.height)
          width = Math.max(MIN_ITEM_SIZE, item.width * scale)
          height = width / aspect
          if (handle.includes('w')) x = item.x + item.width - width
          if (handle.includes('n')) y = item.y + item.height - height
        }
        updateLocalItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, x, y, width, height } : candidate,
          ),
        )
      }
    }
    const up = () => {
      finishInteraction()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  const nextObjectPosition = (width: number, height: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const center = rect
      ? screenToWorkbenchWorld(
          { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          viewport,
          rect,
        )
      : { x: 160, y: 120 }
    return findFreeWorkbenchPosition(
      localItemsRef.current,
      width,
      height,
      { x: center.x - width / 2, y: center.y - height / 2 },
    )
  }

  const addText = () => {
    const position = nextObjectPosition(280, 84)
    const item: EcommerceCanvasItem = {
      id: createId('eci'),
      projectId,
      kind: 'text',
      text: '输入文字',
      x: position.x,
      y: position.y,
      width: 280,
      height: 84,
      rotation: 0,
      zIndex: Math.max(0, ...localItems.map((candidate) => candidate.zIndex)) + 1,
      aspectLocked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    commitItems([...localItems, item])
    setSelectedId(item.id)
    setEditingTextId(item.id)
  }

  const upload = async (file: File | undefined) => {
    if (!file || !onCanvasUpload) return
    const uploaded = await onCanvasUpload(file)
    if (!uploaded) return
    const width = 520
    const aspect = uploaded.width && uploaded.height ? uploaded.width / uploaded.height : 1
    const height = Math.max(120, Math.round(width / aspect))
    const position = nextObjectPosition(width, height)
    const item: EcommerceCanvasItem = {
      id: createId('eci'),
      projectId,
      kind: 'image',
      assetHash: uploaded.hash,
      x: position.x,
      y: position.y,
      width,
      height,
      rotation: 0,
      zIndex: Math.max(0, ...localItems.map((candidate) => candidate.zIndex)) + 1,
      aspectLocked: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    commitItems([...localItems, item])
    setSelectedId(item.id)
  }

  const panel = useMemo(() => {
    if (!selected) return null
    const screen = itemScreenRect(selected, viewport)
    const width = 220
    const left =
      screen.left + screen.width + 16 + width <= size.width
        ? screen.left + screen.width + 16
        : screen.left - width - 16
    const height = Math.min(actionPanelHeight, Math.max(120, size.height - 24))
    return {
      left: clamp(left, 12, Math.max(12, size.width - width - 12)),
      top: clamp(screen.top, 12, Math.max(12, size.height - height - 12)),
    }
  }, [actionPanelHeight, selected, size.height, size.width, viewport])

  useLayoutEffect(() => {
    if (!actionPanelRef.current) return
    const height = actionPanelRef.current.offsetHeight
    setActionPanelHeight((current) => (Math.abs(current - height) > 1 ? height : current))
  }, [selected?.id, selectedResult?.id, localItems.length])

  const selectedActions = selectedResult
    ? ([
        ['download', '下载', Boolean(selectedResult.assetHash)],
        ['save', '收藏到素材库', Boolean(selectedResult.assetHash)],
        ['canvas', '在画布中打开', true],
        ['crop', '裁剪', true],
        ['annotate', '标注', true],
        ['rotate', '旋转 / 镜像', true],
        ['extract', '局部重绘', true],
        ['edit', 'AI 编辑', true],
        ['upscale', 'AI 超清', true],
      ] as const)
    : []

  return (
    <div
      ref={viewportRef}
      className={styles.workbench}
      data-ecommerce-workbench
      data-tool={tool}
      data-zoom={Math.round(viewport.scale * 100)}
      onPointerDown={beginPan}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) fitAll()
      }}
    >
      <div
        className={styles.canvasGlow}
        aria-hidden
        style={
          gridSize
            ? {
                backgroundSize: `${gridSize * viewport.scale}px ${gridSize * viewport.scale}px`,
                backgroundPosition: `${viewport.x}px ${viewport.y}px`,
              }
            : { opacity: 0 }
        }
      />
      <div
        className={styles.world}
        data-ecommerce-workbench-world
        style={
          {
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            '--wb-inv-scale': 1 / viewport.scale,
          } as CSSProperties
        }
      >
        {localItems.map((item) => {
          const result = item.resultId ? resultById.get(item.resultId) : null
          const selectedItem = item.id === selectedId
          return (
            <div
              key={item.id}
              className={[
                styles.item,
                selectedItem ? styles.itemSelected : '',
                item.kind === 'text' ? styles.textItem : '',
              ].filter(Boolean).join(' ')}
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
                zIndex: selectedItem ? 10000 : item.zIndex,
                transform: `rotate(${item.rotation}deg)`,
              }}
              data-ecommerce-workbench-item={item.id}
              data-ecommerce-result={result ? true : undefined}
              data-ecommerce-result-id={result?.nodeId ?? item.resultId ?? item.id}
              data-ecommerce-result-record-id={item.resultId}
              data-status={result ? 'done' : undefined}
              data-item-x={Math.round(item.x)}
              data-item-y={Math.round(item.y)}
              data-item-width={Math.round(item.width)}
              data-item-height={Math.round(item.height)}
              data-item-rotation={Math.round(item.rotation)}
              data-item-kind={item.kind}
              onPointerDown={(event) => beginMove(event, item)}
              onDoubleClick={(event) => {
                event.stopPropagation()
                if (item.kind === 'text') setEditingTextId(item.id)
                else setSelectedId(item.id)
              }}
            >
              {item.kind === 'text' ? (
                editingTextId === item.id ? (
                  <textarea
                    className={styles.textEditor}
                    autoFocus
                    value={item.text ?? ''}
                    onChange={(event) => {
                      const text = event.target.value
                      if (!textEditHistoryRef.current.has(item.id)) {
                        undoRef.current.push([...localItemsRef.current])
                        if (undoRef.current.length > 80) undoRef.current.shift()
                        redoRef.current = []
                        textEditHistoryRef.current.add(item.id)
                        setHistoryVersion((value) => value + 1)
                      }
                      updateLocalItems((current) =>
                        current.map((candidate) =>
                          candidate.id === item.id ? { ...candidate, text } : candidate,
                        ),
                      )
                    }}
                    onBlur={() => {
                      textEditHistoryRef.current.delete(item.id)
                      setEditingTextId(null)
                      onItemsChange(localItemsRef.current)
                    }}
                  />
                ) : (
                  <div className={styles.textContent}>{item.text}</div>
                )
              ) : (
                <WorkbenchMedia item={item} />
              )}
              {selectedItem && (
                <>
                  <span className={styles.sizeLabel} data-ecommerce-item-size>
                    {Math.round(item.width)} × {Math.round(item.height)}
                  </span>
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[]).map(
                    (handle) => (
                      <button
                        key={handle}
                        type="button"
                        className={`${styles.resizeHandle} ${styles[`handle_${handle}`]}`}
                        data-ecommerce-resize-handle={handle}
                        aria-label={`缩放 ${handle}`}
                        onPointerDown={(event) => beginResize(event, item, handle)}
                      />
                    ),
                  )}
                  <button
                    type="button"
                    className={styles.rotateHandle}
                    data-ecommerce-rotate-handle
                    aria-label="旋转图片"
                    title="拖动旋转"
                    onPointerDown={(event) => beginRotate(event, item)}
                    onPointerMove={rotateWithPointer}
                    onPointerUp={(event) => {
                      event.stopPropagation()
                      finishInteraction()
                    }}
                  >
                    <ToolIcon name="rotate" />
                  </button>
                </>
              )}
            </div>
          )
        })}
        {guides.x !== null && (
          <div className={styles.guideX} style={{ left: guides.x }} aria-hidden />
        )}
        {guides.y !== null && (
          <div className={styles.guideY} style={{ top: guides.y }} aria-hidden />
        )}
      </div>

      {selected && panel && (
        <aside
          ref={actionPanelRef}
          className={styles.actionPanel}
          style={{ left: panel.left, top: panel.top }}
          data-ecommerce-action-panel
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className={styles.panelHead}>
            <strong>{selected.kind === 'text' ? '文字对象' : selected.kind === 'video' ? '视频结果' : '图片结果'}</strong>
            <span>{Math.round(selected.rotation)}°</span>
          </header>
          {selectedResult ? (
            <dl className={styles.panelMeta}>
              <div><dt>模型</dt><dd>{selectedResult.model || '—'}</dd></div>
              <div><dt>像素</dt><dd>{selectedResult.width ?? '?'} × {selectedResult.height ?? '?'}</dd></div>
            </dl>
          ) : null}
          <div className={styles.panelActions}>
            {selectedActions.map(([action, label, enabled]) => (
              (() => {
                const active = enabled && availableActions.includes(action) && !!onAction
                return (
              <button
                key={action}
                type="button"
                data-ecommerce-workbench-action={action}
                disabled={!active}
                title={active ? label : `${label}：待接入`}
                onClick={() => selectedResult && onAction?.(selectedResult.id, action)}
              >
                <ToolIcon name={action} />
                <span>{label}</span>
              </button>
                )
              })()
            ))}
            {selected.kind === 'text' ? (
              <button
                type="button"
                onClick={() => setEditingTextId(selected.id)}
              >
                <ToolIcon name="text" />
                <span>编辑文字</span>
              </button>
            ) : null}
          </div>
        </aside>
      )}

      {failedResults.length > 0 && (
        <div className={styles.failureTray} data-ecommerce-failure-tray>
          {failedResults.map((result) => (
            <div
              key={result.id}
              className={styles.failureItem}
              data-ecommerce-result
              data-ecommerce-result-id={result.nodeId}
              data-status="failed"
            >
              <div
                className={styles.failureBody}
                data-ecommerce-result-overlay="failed"
                role="alert"
              >
                <span>生成失败</span>
                <small data-ecommerce-result-error>
                  {result.errorText ?? '没有收到失败原因，请查看电商日志'}
                </small>
              </div>
              <button
                type="button"
                data-ecommerce-remove-failed={result.nodeId}
                onClick={() => onRemoveFailed?.(result.id)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      {runningResults.length > 0 && (
        <div className={styles.runningTray} data-ecommerce-running-tray>
          {runningResults.map((result) => (
            <RunningWorkbenchResult key={result.id} result={result} />
          ))}
        </div>
      )}

      <div className={styles.toolbar} data-ecommerce-workbench-toolbar>
        <button type="button" data-tool-active={tool === 'select'} title="选择 (V)" onClick={() => setTool('select')}>
          <ToolIcon name="select" />
        </button>
        <button type="button" data-tool-active={tool === 'hand'} title="抓手 (H)" onClick={() => setTool('hand')}>
          <ToolIcon name="hand" />
        </button>
        <span className={styles.toolDivider} />
        <button type="button" title="上传图片" onClick={() => fileRef.current?.click()}>
          <ToolIcon name="upload" />
        </button>
        <button type="button" title="添加文字" onClick={addText}>
          <ToolIcon name="text" />
        </button>
        <button
          type="button"
          title={gridSize ? `网格与吸附：${gridSize}px` : '网格与吸附：关闭'}
          data-grid-size={gridSize ?? 'off'}
          data-tool-active={gridSize !== null}
          onClick={() =>
            setGridSize((current) =>
              current === 16 ? 8 : current === 8 ? 32 : current === 32 ? null : 16,
            )
          }
        >
          <ToolIcon name="grid" />
        </button>
        <span className={styles.toolDivider} />
        <button type="button" title="上一步" disabled={undoRef.current.length === 0} onClick={undo} data-history-version={historyVersion}>
          <ToolIcon name="undo" />
        </button>
        <button type="button" title="下一步" disabled={redoRef.current.length === 0} onClick={redo} data-history-version={historyVersion}>
          <ToolIcon name="redo" />
        </button>
      </div>

      <div className={styles.zoomReadout} data-ecommerce-workbench-zoom>
        {Math.round(viewport.scale * 100)}%
        <button type="button" onClick={fitAll}>适配全部</button>
      </div>

      <button
        type="button"
        className={styles.logButton}
        data-ecommerce-workbench-log-toggle
        aria-expanded={logOpen}
        onClick={() => setLogOpen((value) => !value)}
      >
        <ToolIcon name="log" />
        日志
      </button>

      {logOpen && (
        <aside className={styles.logPanel} data-ecommerce-workbench-log>
          <header>
            <strong>电商日志</strong>
            <button type="button" aria-label="关闭日志" onClick={() => setLogOpen(false)}>
              <ToolIcon name="close" />
            </button>
          </header>
          <div className={styles.logRows}>
            {tasks.length === 0 ? (
              <p>还没有电商任务。</p>
            ) : (
              [...tasks]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((task) => {
                  const rows = results.filter((result) => result.taskId === task.id)
                  const failed = rows.filter((result) => result.status === 'failed').length
                  const error = rows.find((result) => result.errorText)?.errorText
                  const model =
                    rows.find((result) => result.model)?.model ??
                    task.request.resolvedModel ??
                    task.request.model ??
                    '—'
                  const channelId = task.request.resolvedChannelId
                  const channel = channelId ? channelLabelOf?.(channelId) ?? channelId : ''
                  return (
                    <article key={task.id}>
                      <span data-status={task.status}>{running && task.status === 'running' ? '生成中' : task.status === 'done' ? '完成' : task.status === 'partial' ? '部分完成' : task.status === 'canceled' ? '取消' : '失败'}</span>
                      <p>{task.request.modeLabel || task.request.usage} · {rows.length} 个结果{failed ? ` · ${failed} 失败` : ''}</p>
                      <small>{model}{channel ? ` · ${channel}` : ''} · {elapsedLabel(task)} · {new Date(task.createdAt).toLocaleTimeString('zh-CN')}</small>
                      {error ? <p className={styles.logError}>{error}</p> : null}
                    </article>
                  )
                })
            )}
          </div>
        </aside>
      )}

      {localItems.length === 0 && failedResults.length === 0 ? (
        <div className={styles.empty} data-ecommerce-workbench-empty>
          <span>生成结果会按任务顺序出现在这里</span>
          <small>滚轮平移，Ctrl/⌘ + 滚轮缩放，空格或抓手拖动</small>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
