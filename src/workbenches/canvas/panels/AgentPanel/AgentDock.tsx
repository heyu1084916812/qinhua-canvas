import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { openAgentSettings } from '../../../../state/ui/globalSettings'
import { AgentPanel } from './AgentPanel'
import {
  AGENT_DOCK_LEGACY_STORAGE_KEY,
  AGENT_SHELL_STORAGE_KEY,
  AGENT_SHELL_WIDTH_DEFAULT,
  AGENT_SHELL_WIDTH_MIN,
  agentShellAvailableWidth,
  agentShellMaxWidth,
  dampAgentShellWidth,
  agentShellWidth,
  clampAgentOrb,
  clampAgentShellState,
  defaultAgentShellState,
  nearestAgentShellSnap,
  parseAgentShellState,
  parseLegacyAgentShellState,
  resizedAgentShellWidth,
  type AgentShellState,
  type AgentWorkArea,
} from './agentShellLayout'
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
      kind: 'resize'
      startX: number
      originWidth: number
      rawWidth: number
      moved: boolean
    }

function measureCanvasWorkArea(): AgentWorkArea {
  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  const rect = surface?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) {
    const panel = document.querySelector<HTMLElement>('[data-agent-shell-panel]')
    const panelRect = panel?.getBoundingClientRect()
    const right =
      panelRect && panelRect.width > 0 ? Math.max(rect.right, panelRect.right) : rect.right
    return { x: rect.left, y: rect.top, width: right - rect.left, height: rect.height }
  }
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
}

function readStoredShellState(): AgentShellState | null {
  try {
    const current = parseAgentShellState(localStorage.getItem(AGENT_SHELL_STORAGE_KEY))
    if (current) return current
    return parseLegacyAgentShellState(localStorage.getItem(AGENT_DOCK_LEGACY_STORAGE_KEY))
  } catch {
    return null
  }
}

function measureAgentAvailableWidth(): number {
  const rail = document.querySelector<HTMLElement>('[data-rail-slot]')
  const railWidth = rail?.getBoundingClientRect().width ?? 64
  return agentShellAvailableWidth(window.innerWidth, railWidth)
}

function storeShellState(state: AgentShellState): void {
  try {
    localStorage.setItem(AGENT_SHELL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A blocked localStorage must not stop the Agent from opening.
  }
}

/**
 * 画布 Agent 的空间外壳。
 *
 * 浮球仍属于画布视口，以便用户把它放在顺手的位置；面板则通过 AppShell 提供的
 * portal 插槽固定在应用壳右侧。两者只共享“是否打开”，不共享坐标：
 * 开关面板、拖宽面板都不会回写球位，也不会改变画布尺寸。
 */
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
  const [shellAnimatedOpen, setShellAnimatedOpen] = useState(open)
  const [shell, setShell] = useState<AgentShellState | null>(null)
  const [dragging, setDragging] = useState<DragState['kind'] | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const shellRef = useRef<AgentShellState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressOrbClickRef = useRef(false)

  const applyShell = useCallback((next: AgentShellState) => {
    shellRef.current = next
    setShell(next)
  }, [])

  useLayoutEffect(() => {
    const area = measureCanvasWorkArea()
    const availableWidth = measureAgentAvailableWidth()
    const stored = readStoredShellState()
    applyShell(
      stored
        ? clampAgentShellState(stored, area, availableWidth)
        : {
            ...defaultAgentShellState(area),
            width: agentShellWidth(AGENT_SHELL_WIDTH_DEFAULT, availableWidth),
          },
    )

    const onAreaChange = () => {
      const nextArea = measureCanvasWorkArea()
      const nextAvailableWidth = measureAgentAvailableWidth()
      const current = shellRef.current
      applyShell(
        current
          ? clampAgentShellState(current, nextArea, nextAvailableWidth)
          : {
              ...defaultAgentShellState(nextArea),
              width: agentShellWidth(AGENT_SHELL_WIDTH_DEFAULT, nextAvailableWidth),
            },
      )
    }
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
    const observer =
      typeof ResizeObserver === 'function' && surface
        ? new ResizeObserver(onAreaChange)
        : null
    if (surface && observer) observer.observe(surface)
    window.addEventListener('resize', onAreaChange)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onAreaChange)
    }
  }, [applyShell])

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>('[data-agent-shell-slot]')
    setPortalTarget(target ?? document.body)
  }, [])

  useLayoutEffect(() => {
    if (!portalTarget) return
    if (shellAnimatedOpen) portalTarget.setAttribute('data-agent-shell-active', 'true')
    else portalTarget.removeAttribute('data-agent-shell-active')
    return () => {
      portalTarget.removeAttribute('data-agent-shell-active')
    }
  }, [portalTarget, shellAnimatedOpen])

  useLayoutEffect(() => {
    if (!portalTarget || !shell) return
    portalTarget.style.setProperty('--agent-shell-width', `${shell.width}px`)
  }, [portalTarget, shell])

  useLayoutEffect(() => {
    if (!portalTarget) return
    if (dragging === 'resize') {
      portalTarget.setAttribute('data-agent-shell-resizing', 'true')
    } else {
      portalTarget.removeAttribute('data-agent-shell-resizing')
    }
    return () => {
      portalTarget.removeAttribute('data-agent-shell-resizing')
    }
  }, [dragging, portalTarget])

  useLayoutEffect(() => {
    if (!open) return
    setMounted(true)
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setShellAnimatedOpen(true))
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) return
    setShellAnimatedOpen(false)
    if (!mounted) return
    const timer = window.setTimeout(() => setMounted(false), 260)
    return () => window.clearTimeout(timer)
  }, [mounted, open])

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
      const base = shellRef.current
      if (!current || !base) return
      const area = measureCanvasWorkArea()

      if (current.kind === 'orb') {
        const dx = moveEvent.clientX - current.startX
        const dy = moveEvent.clientY - current.startY
        if (Math.hypot(dx, dy) > 4) current.moved = true
        applyShell({
          ...base,
          orb: clampAgentOrb(
            {
              x: current.originX + dx,
              y: current.originY + dy,
            },
            area,
          ),
        })
        return
      }

      const availableWidth = measureAgentAvailableWidth()
      const rawWidth = resizedAgentShellWidth(
        current.originWidth,
        current.startX,
        moveEvent.clientX,
        availableWidth,
      )
      current.rawWidth = rawWidth
      if (Math.abs(moveEvent.clientX - current.startX) > 4) current.moved = true
      applyShell({
        ...base,
        width: dampAgentShellWidth(rawWidth, availableWidth),
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
      if (current?.kind === 'resize') {
        const availableWidth = measureAgentAvailableWidth()
        const snapped = nearestAgentShellSnap(current.rawWidth, availableWidth)
        if (snapped) {
          const latest = shellRef.current
          if (latest) applyShell({ ...latest, width: snapped })
        }
      }
      if (shellRef.current) storeShellState(shellRef.current)
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const onOrbPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = shellRef.current
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

  const onResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = shellRef.current
    if (!current) return
    beginDrag(event, {
      kind: 'resize',
      startX: event.clientX,
      originWidth: current.width,
      rawWidth: current.width,
      moved: false,
    })
  }

  const saveWidth = (width: number) => {
    const current = shellRef.current
    if (!current) return
    const next = {
      ...current,
      width: agentShellWidth(width, measureAgentAvailableWidth()),
    }
    applyShell(next)
    storeShellState(next)
  }

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = shellRef.current
    if (!current) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      saveWidth(current.width + 16)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      saveWidth(current.width - 16)
    } else if (event.key === 'Home') {
      event.preventDefault()
      saveWidth(AGENT_SHELL_WIDTH_MIN)
    } else if (event.key === 'End') {
      event.preventDefault()
      saveWidth(agentShellMaxWidth(measureAgentAvailableWidth()))
    }
  }

  const panel =
    mounted && portalTarget && shell
      ? createPortal(
          <div
            id="canvas-agent-panel"
            className={styles.panelFrame}
            data-agent-floating-panel
            data-agent-shell-panel
            data-agent-shell-panel-width={shell.width}
            data-agent-shell-open={open ? 'true' : 'false'}
            data-agent-dragging={dragging ?? undefined}
            role="region"
            aria-label="Agent 面板"
          >
            <div className={styles.panelSurface} data-agent-shell-surface>
              <AgentPanel
                projectId={projectId}
                onClose={() => onOpenChange(false)}
                onOpenSettings={() => openAgentSettings('basic')}
              />
            </div>
            <button
              type="button"
              className={styles.resizeHandle}
              data-agent-resize
              role="separator"
              aria-orientation="vertical"
              aria-controls="canvas-agent-panel"
              aria-label="调整 Agent 面板宽度"
              aria-valuemin={AGENT_SHELL_WIDTH_MIN}
              aria-valuemax={agentShellMaxWidth(measureAgentAvailableWidth())}
              aria-valuenow={shell.width}
              title="左右拖动调整宽度；方向键微调"
              onPointerDown={onResizePointerDown}
              onKeyDown={onResizeKeyDown}
            />
          </div>,
          portalTarget,
        )
      : null

  return (
    <>
      <button
        type="button"
        className={styles.orb}
        style={shell ? { left: shell.orb.x, top: shell.orb.y } : undefined}
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
          onOpenChange(!open)
        }}
      >
        <span className={styles.orbSwirl} aria-hidden="true" />
        <span className={styles.orbGlint} aria-hidden="true" />
        <span className={styles.orbLabel} aria-hidden="true">
          {open ? '收起 Agent' : 'Agent'}
        </span>
      </button>
      {panel}
    </>
  )
}
