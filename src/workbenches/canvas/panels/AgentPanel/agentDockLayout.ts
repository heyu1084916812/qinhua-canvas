export interface AgentWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface AgentDockPoint {
  x: number
  y: number
}

export interface AgentPanelBox extends AgentDockPoint {
  width: number
  height: number
}

export interface AgentDockLayout {
  orb: AgentDockPoint
  panel: AgentPanelBox
}

export const AGENT_ORB_SIZE = 64
export const AGENT_PANEL_MAX_WIDTH = 420
export const AGENT_PANEL_MIN_HEIGHT = 320
export const AGENT_DOCK_GAP = 12
export const AGENT_PANEL_TOP_INSET = 56
export const AGENT_PANEL_HEIGHT_RATIO = 0.52
export const AGENT_DOCK_STORAGE_KEY = 'qinghua.canvas.agentDock.v1'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function agentPanelWidth(area: AgentWorkArea): number {
  const max = Math.max(240, area.width - AGENT_DOCK_GAP * 2)
  return Math.min(max, AGENT_PANEL_MAX_WIDTH)
}

export function agentPanelHeight(area: AgentWorkArea, requested = area.height * AGENT_PANEL_HEIGHT_RATIO): number {
  const max = Math.max(240, area.height - AGENT_DOCK_GAP * 2)
  return Math.round(clamp(Math.max(requested, Math.min(AGENT_PANEL_MIN_HEIGHT, max)), 240, max))
}

export function clampAgentPoint(point: AgentDockPoint, area: AgentWorkArea, size = AGENT_ORB_SIZE): AgentDockPoint {
  const maxX = Math.max(area.x + AGENT_DOCK_GAP, area.x + area.width - size - AGENT_DOCK_GAP)
  const maxY = Math.max(area.y + AGENT_DOCK_GAP, area.y + area.height - size - AGENT_DOCK_GAP)
  return {
    x: Math.round(clamp(point.x, area.x + AGENT_DOCK_GAP, maxX)),
    y: Math.round(clamp(point.y, area.y + AGENT_DOCK_GAP, maxY)),
  }
}

export function clampAgentPanel(box: AgentPanelBox, area: AgentWorkArea): AgentPanelBox {
  const width = Math.min(Math.max(240, box.width), Math.max(240, area.width - AGENT_DOCK_GAP * 2))
  const height = agentPanelHeight(area, box.height)
  const maxX = Math.max(area.x + AGENT_DOCK_GAP, area.x + area.width - width - AGENT_DOCK_GAP)
  const maxY = Math.max(area.y + AGENT_DOCK_GAP, area.y + area.height - height - AGENT_DOCK_GAP)
  return {
    x: Math.round(clamp(box.x, area.x + AGENT_DOCK_GAP, maxX)),
    y: Math.round(clamp(box.y, area.y + AGENT_DOCK_GAP, maxY)),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function clampAgentDockLayout(layout: AgentDockLayout, area: AgentWorkArea): AgentDockLayout {
  return {
    orb: clampAgentPoint(layout.orb, area),
    panel: clampAgentPanel(layout.panel, area),
  }
}

export function defaultAgentDockLayout(area: AgentWorkArea): AgentDockLayout {
  const width = agentPanelWidth(area)
  const height = agentPanelHeight(area)
  return {
    orb: {
      x: Math.round(area.x + area.width - AGENT_ORB_SIZE - 24),
      y: Math.round(area.y + area.height - AGENT_ORB_SIZE - 24),
    },
    panel: {
      x: Math.round(area.x + area.width - width - 24),
      y: Math.round(area.y + AGENT_PANEL_TOP_INSET),
      width,
      height,
    },
  }
}

/**
 * 展开时以浮球为锚点：优先放在球右侧，右边空间不足就翻到左侧；
 * 纵向以球心对齐，贴边时再 clamp 回画布工作区。
 */
export function openAgentPanel(layout: AgentDockLayout, area: AgentWorkArea): AgentDockLayout {
  const width = agentPanelWidth(area)
  const height = agentPanelHeight(area, layout.panel.height)
  const rightX = layout.orb.x + AGENT_ORB_SIZE + AGENT_DOCK_GAP
  const leftX = layout.orb.x - width - AGENT_DOCK_GAP
  const rightFits =
    rightX + width <= area.x + area.width - AGENT_DOCK_GAP
  const anchoredX = rightFits ? rightX : leftX
  const anchoredY = layout.orb.y + AGENT_ORB_SIZE / 2 - height / 2
  return {
    ...layout,
    panel: clampAgentPanel(
      {
        x: anchoredX,
        y: anchoredY,
        width,
        height,
      },
      area,
    ),
  }
}

/** 收起时把浮球放到面板右下角，视觉上像窗口重新收成一颗球。 */
export function collapseAgentDockToPanel(layout: AgentDockLayout, area: AgentWorkArea): AgentDockLayout {
  return {
    ...layout,
    orb: clampAgentPoint(
      {
        x: layout.panel.x + layout.panel.width - AGENT_ORB_SIZE,
        y: layout.panel.y + layout.panel.height - AGENT_ORB_SIZE,
      },
      area,
    ),
  }
}

export function parseAgentDockLayout(raw: string | null): AgentDockLayout | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AgentDockLayout> | null
    const orb = value?.orb
    const panel = value?.panel
    if (
      !orb ||
      !panel ||
      !finite(orb.x) ||
      !finite(orb.y) ||
      !finite(panel.x) ||
      !finite(panel.y) ||
      !finite(panel.width) ||
      !finite(panel.height) ||
      panel.width <= 0 ||
      panel.height <= 0
    ) {
      return null
    }
    return {
      orb: { x: orb.x, y: orb.y },
      panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height },
    }
  } catch {
    return null
  }
}
