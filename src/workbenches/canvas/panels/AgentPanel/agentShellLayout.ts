export interface AgentWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface AgentOrbPoint {
  x: number
  y: number
}

export interface AgentShellState {
  orb: AgentOrbPoint
  width: number
}

export const AGENT_ORB_SIZE = 64
/** 与 AppShell 的 `--shell-gap` 保持一致；面板是壳层 slot 的绝对定位子项。 */
export const AGENT_SHELL_GAP = 15
export const AGENT_SHELL_WIDTH_DEFAULT = 420
export const AGENT_SHELL_WIDTH_MIN = 360
export const AGENT_SHELL_WIDTH_MAX = 720
export const AGENT_SHELL_STORAGE_KEY = 'qinghua.canvas.agentShell.v2'
export const AGENT_DOCK_LEGACY_STORAGE_KEY = 'qinghua.canvas.agentDock.v1'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampAgentOrb(
  point: AgentOrbPoint,
  area: AgentWorkArea,
  size = AGENT_ORB_SIZE,
): AgentOrbPoint {
  const maxX = Math.max(area.x + AGENT_SHELL_GAP, area.x + area.width - size - AGENT_SHELL_GAP)
  const maxY = Math.max(area.y + AGENT_SHELL_GAP, area.y + area.height - size - AGENT_SHELL_GAP)
  return {
    x: Math.round(clamp(point.x, area.x + AGENT_SHELL_GAP, maxX)),
    y: Math.round(clamp(point.y, area.y + AGENT_SHELL_GAP, maxY)),
  }
}

export function agentShellWidth(
  requested = AGENT_SHELL_WIDTH_DEFAULT,
  availableWidth = typeof window === 'undefined' ? 1440 : window.innerWidth,
): number {
  const maximum = Math.min(
    AGENT_SHELL_WIDTH_MAX,
    Math.max(AGENT_SHELL_WIDTH_MIN, availableWidth - AGENT_SHELL_GAP * 2),
  )
  return Math.round(clamp(requested, AGENT_SHELL_WIDTH_MIN, maximum))
}

export function defaultAgentShellState(area: AgentWorkArea): AgentShellState {
  return {
    orb: {
      x: Math.round(area.x + area.width - AGENT_ORB_SIZE - 24),
      y: Math.round(area.y + area.height - AGENT_ORB_SIZE - 24),
    },
    width: agentShellWidth(AGENT_SHELL_WIDTH_DEFAULT),
  }
}

export function clampAgentShellState(
  state: AgentShellState,
  area: AgentWorkArea,
  availableWidth = typeof window === 'undefined' ? 1440 : window.innerWidth,
): AgentShellState {
  return {
    orb: clampAgentOrb(state.orb, area),
    width: agentShellWidth(state.width, availableWidth),
  }
}

export function resizedAgentShellWidth(
  originWidth: number,
  startX: number,
  clientX: number,
  availableWidth = typeof window === 'undefined' ? 1440 : window.innerWidth,
): number {
  return agentShellWidth(originWidth - (clientX - startX), availableWidth)
}

export function parseAgentShellState(raw: string | null): AgentShellState | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AgentShellState> | null
    const orb = value?.orb
    if (!orb || !finite(orb.x) || !finite(orb.y) || !finite(value.width) || value.width <= 0) {
      return null
    }
    return {
      orb: { x: orb.x, y: orb.y },
      width: value.width,
    }
  } catch {
    return null
  }
}

/**
 * 旧版把浮球和可移动面板存在同一条布局里。迁移时只保留用户拖过的球位，
 * 面板宽度取旧值但立即夹进新的 360–720 范围，面板坐标不再恢复。
 */
export function parseLegacyAgentShellState(raw: string | null): AgentShellState | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as {
      orb?: Partial<AgentOrbPoint>
      panel?: { width?: unknown }
    } | null
    const orb = value?.orb
    if (!orb || !finite(orb.x) || !finite(orb.y)) return null
    return {
      orb: { x: orb.x, y: orb.y },
      width: finite(value.panel?.width) ? value.panel.width : AGENT_SHELL_WIDTH_DEFAULT,
    }
  } catch {
    return null
  }
}
