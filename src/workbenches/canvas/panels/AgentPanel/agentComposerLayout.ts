export const AGENT_COMPOSER_HEIGHT_KEY = 'qinghua.canvas.agentComposerHeight.v1'
export const AGENT_COMPOSER_HEIGHT_MIN = 104
export const AGENT_COMPOSER_HEIGHT_MAX = 360
/** 输入框增高后，消息区、对话模型和面板内边距仍需保留的空间。 */
export const AGENT_COMPOSER_PANEL_RESERVE = 176

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function agentComposerMaxHeight(availablePanelHeight: number): number {
  if (!Number.isFinite(availablePanelHeight) || availablePanelHeight <= 0) {
    return AGENT_COMPOSER_HEIGHT_MAX
  }
  return Math.round(
    clamp(
      availablePanelHeight - AGENT_COMPOSER_PANEL_RESERVE,
      AGENT_COMPOSER_HEIGHT_MIN,
      AGENT_COMPOSER_HEIGHT_MAX,
    ),
  )
}

export function clampAgentComposerHeight(
  requestedHeight: number,
  availablePanelHeight = AGENT_COMPOSER_HEIGHT_MAX + AGENT_COMPOSER_PANEL_RESERVE,
): number {
  const maximum = agentComposerMaxHeight(availablePanelHeight)
  const value = Number.isFinite(requestedHeight)
    ? requestedHeight
    : AGENT_COMPOSER_HEIGHT_MIN
  return Math.round(clamp(value, AGENT_COMPOSER_HEIGHT_MIN, maximum))
}

export function parseAgentComposerHeight(
  raw: string | null,
  availablePanelHeight = AGENT_COMPOSER_HEIGHT_MAX + AGENT_COMPOSER_PANEL_RESERVE,
): number {
  if (!raw) return AGENT_COMPOSER_HEIGHT_MIN
  const value = Number(raw)
  return clampAgentComposerHeight(value, availablePanelHeight)
}

export function resizedAgentComposerHeight(
  originHeight: number,
  startY: number,
  clientY: number,
  availablePanelHeight = AGENT_COMPOSER_HEIGHT_MAX + AGENT_COMPOSER_PANEL_RESERVE,
): number {
  return clampAgentComposerHeight(
    originHeight - (clientY - startY),
    availablePanelHeight,
  )
}
