import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AgentPanel } from './AgentPanel'
import {
  AGENT_DOCK_STORAGE_KEY,
  agentPanelHeight,
  clampAgentDockLayout,
  clampAgentPanel,
  clampAgentPoint,
  closeAgentPanel,
  defaultAgentDockLayout,
  openAgentPanel,
  parseAgentDockLayout,
  type AgentDockLayout,
  type AgentWorkArea,
} from './agentDockLayout'
import styles from './AgentDock.module.css'

type DragState =
  | {
      kind: 'orb'
      startX: number
      startY: number
      originX: number
      originY: number
      moved: boolean
    }
  | {
      kind: 'panel'
      startX: number
      startY: number
      originX: number
      originY: number
      moved: boolean
    }
  | {
      kind: 'resize'
      startY: number
      originHeight: number
      moved: boolean
    }

function measureCanvasWorkArea(): AgentWorkArea {
  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  const rect = surface?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) {
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  }
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
}

function readStoredLayout(): AgentDockLayout | null {
  try {
    return parseAgentDockLayout(window.localStorage.getItem(AGENT_DOCK_STORAGE_KEY))
  } catch {
    return null
  }
}

function storeLayout(layout: AgentDockLayout): void {
  try {
    window.localStorage.setItem(AGENT_DOCK_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // A blocked localStorage must not stop the Agent from opening.
  }
}

export function AgentDock({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [mounted, setMounted] = useState(open)
  const [layout, setLayout] = useState<AgentDockLayout | null>(null)
  const [dragging, setDragging] = useState<DragState['kind'] | null>(null)
  const layoutRef = useRef<AgentDockLayout | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressOrbClickRef = useRef(false)

  const applyLayout = useCallback((next: AgentDockLayout) => {
    layoutRef.current = next
    setLayout(next)
  }, [])

  useLayoutEffect(() => {
    const area = measureCanvasWorkArea()
    const stored = readStoredLayout()
    applyLayout(stored ? clampAgentDockLayout(stored, area) : defaultAgentDockLayout(area))

    const onAreaChange = () => {
      const nextArea = measureCanvasWorkArea()
      const current = layoutRef.current
      applyLayout(current ? clampAgentDockLayout(current, nextArea) : defaultAgentDockLayout(nextArea))
    }
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
    const observer = typeof ResizeObserver === 'function' && surface ? new ResizeObserver(onAreaChange) : null
    if (surface && observer) observer.observe(surface)
    window.addEventListener('resize', onAreaChange)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onAreaChange)
    }
  }, [applyLayout])

  useLayoutEffect(() => {
    if (!open) return
    setMounted(true)
    const current = layoutRef.current
    if (current) applyLayout(openAgentPanel(current, measureCanvasWorkArea()))
  }, [open, applyLayout])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, next: DragState) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (next.kind === 'orb') {
      suppressOrbClickRef.current = false
      event.currentTarget.focus()
    }
    dragRef.current = next
    setDragging(next.kind)

    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current
      const base = layoutRef.current
      if (!current || !base) return
      const dy = moveEvent.clientY - current.startY
      const dx = current.kind === 'resize' ? 0 : moveEvent.clientX - current.startX
      if (current.kind === 'resize' ? Math.abs(dy) > 4 : Math.hypot(dx, dy) > 4) current.moved = true
      const area = measureCanvasWorkArea()

      if (current.kind === 'orb') {
        const orb = clampAgentPoint({ x: current.originX + dx, y: current.originY + dy }, area)
        const next = {
          ...base,
          orb,
        }
        applyLayout(open ? openAgentPanel(next, area) : next)
        return
      }
      if (current.kind === 'panel') {
        applyLayout({
          ...base,
          panel: clampAgentPanel(
            {
              x: current.originX + dx,
              y: current.originY + dy,
              width: base.panel.width,
              height: base.panel.height,
            },
            area,
          ),
        })
        return
      }
      applyLayout({
        ...base,
        panel: clampAgentPanel(
          {
            ...base.panel,
            height: agentPanelHeight(area, current.originHeight + dy),
          },
          area,
        ),
      })
    }

    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      const current = dragRef.current
      setDragging(null)
      if (current?.kind === 'orb') {
        suppressOrbClickRef.current = current.moved
        window.setTimeout(() => {
          suppressOrbClickRef.current = false
        }, 0)
      }
      if (layoutRef.current) storeLayout(layoutRef.current)
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const onOrbPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = layoutRef.current
    if (!current) return
    beginDrag(event, {
      kind: 'orb',
      startX: event.clientX,
      startY: event.clientY,
      originX: current.orb.x,
      originY: current.orb.y,
      moved: false,
    })
  }

  const onPanelPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[data-agent-drag-handle]')) return
    if (
      target.closest(
        'button, input, textarea, select, a, [contenteditable="true"], [role="button"], [data-agent-no-drag]',
      )
    ) {
      return
    }
    const current = layoutRef.current
    if (!current) return
    beginDrag(event, {
      kind: 'panel',
      startX: event.clientX,
      startY: event.clientY,
      originX: current.panel.x,
      originY: current.panel.y,
      moved: false,
    })
  }

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = layoutRef.current
    if (!current) return
    beginDrag(event, {
      kind: 'resize',
      startY: event.clientY,
      originHeight: current.panel.height,
      moved: false,
    })
  }

  const collapse = () => {
    const current = layoutRef.current
    if (current) {
      const next = closeAgentPanel(current, measureCanvasWorkArea())
      applyLayout(next)
      storeLayout(next)
    }
    onOpenChange(false)
  }

  return (
    <>
      <button
        type="button"
        className={styles.orb}
        style={layout ? { left: layout.orb.x, top: layout.orb.y } : undefined}
        data-canvas-agent
        data-agent-orb
        data-agent-expanded={open ? 'true' : 'false'}
        aria-label={open ? '收起 Agent' : '打开 Agent'}
        aria-controls="canvas-agent-panel"
        aria-expanded={open}
        title={open ? '收起 Agent' : 'Agent'}
        onPointerDown={onOrbPointerDown}
        onClick={() => {
          if (suppressOrbClickRef.current) {
            suppressOrbClickRef.current = false
            return
          }
          if (open) {
            collapse()
            return
          }
          const current = layoutRef.current
          if (current) {
            applyLayout(openAgentPanel(current, measureCanvasWorkArea()))
          }
          onOpenChange(true)
        }}
      >
        <span className={styles.orbSwirl} aria-hidden="true" />
        <span className={styles.orbGlint} aria-hidden="true" />
        <span className={styles.orbLabel} aria-hidden="true">
          {open ? '收起 Agent' : 'Agent'}
        </span>
      </button>

      {mounted ? (
        <div
          id="canvas-agent-panel"
          className={styles.panelFrame}
          style={
            layout
              ? {
                  left: layout.panel.x,
                  top: layout.panel.y,
                  width: layout.panel.width,
                  height: layout.panel.height,
                }
              : undefined
          }
          data-agent-floating-panel
          data-agent-dragging={dragging ?? undefined}
          role="dialog"
          aria-label="Agent 浮窗"
          hidden={!open}
          onPointerDown={onPanelPointerDown}
        >
          <AgentPanel projectId={projectId} onClose={collapse} />
          <button
            type="button"
            className={styles.resizeHandle}
            data-agent-resize
            aria-label="调整 Agent 浮窗高度"
            title="上下拖动调整高度"
            onPointerDown={onResizePointerDown}
          />
        </div>
      ) : null}
    </>
  )
}
