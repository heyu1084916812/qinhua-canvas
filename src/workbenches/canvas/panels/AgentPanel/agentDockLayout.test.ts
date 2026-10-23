import { describe, expect, it } from 'vitest'
import {
  AGENT_DOCK_GAP,
  AGENT_ORB_SIZE,
  agentPanelHeight,
  clampAgentDockLayout,
  clampAgentPanel,
  collapseAgentDockToPanel,
  defaultAgentDockLayout,
  openAgentPanel,
  parseAgentDockLayout,
  type AgentWorkArea,
} from './agentDockLayout'

const AREA: AgentWorkArea = { x: 200, y: 48, width: 1000, height: 800 }

describe('Agent floating dock layout', () => {
  it('opens at roughly half the canvas work-area height', () => {
    const layout = defaultAgentDockLayout(AREA)
    expect(layout.panel.height).toBe(Math.round(AREA.height * 0.52))
    expect(layout.panel.width).toBe(420)
    expect(layout.panel.x + layout.panel.width).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_DOCK_GAP)
    expect(layout.panel.y).toBeGreaterThanOrEqual(AREA.y + AGENT_DOCK_GAP)
  })

  it('clamps a dragged panel fully inside the canvas work area', () => {
    const panel = clampAgentPanel({ x: -900, y: 99999, width: 420, height: 380 }, AREA)
    expect(panel.x).toBe(AREA.x + AGENT_DOCK_GAP)
    expect(panel.y + panel.height).toBeLessThanOrEqual(AREA.y + AREA.height - AGENT_DOCK_GAP)
  })

  it('clamps the orb inside the same work area', () => {
    const layout = clampAgentDockLayout(
      {
        orb: { x: 99999, y: -99999 },
        panel: { x: 0, y: 0, width: 420, height: 400 },
      },
      AREA,
    )
    expect(layout.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_DOCK_GAP)
    expect(layout.orb.y).toBe(AREA.y + AGENT_DOCK_GAP)
  })

  it('opens toward the inside of the canvas when the orb is near the right edge', () => {
    const base = defaultAgentDockLayout(AREA)
    const next = openAgentPanel(base, AREA)
    expect(next.panel.x + next.panel.width).toBeLessThanOrEqual(base.orb.x - AGENT_DOCK_GAP)
    expect(next.panel.x).toBeGreaterThanOrEqual(AREA.x + AGENT_DOCK_GAP)
  })

  it('opens to the right when the orb has room there', () => {
    const base = defaultAgentDockLayout(AREA)
    const next = openAgentPanel({ ...base, orb: { x: AREA.x + 20, y: AREA.y + 100 } }, AREA)
    expect(next.panel.x).toBe(AREA.x + 20 + AGENT_ORB_SIZE + AGENT_DOCK_GAP)
  })

  it('collapses the panel back to a visible orb', () => {
    const base = defaultAgentDockLayout(AREA)
    const next = collapseAgentDockToPanel(base, AREA)
    expect(next.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_DOCK_GAP)
    expect(next.orb.y + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.y + AREA.height - AGENT_DOCK_GAP)
  })

  it('does not let a stored height exceed the current work area', () => {
    expect(agentPanelHeight(AREA, 5000)).toBe(AREA.height - AGENT_DOCK_GAP * 2)
  })

  it('restores a valid persisted layout', () => {
    expect(
      parseAgentDockLayout(
        JSON.stringify({
          orb: { x: 640, y: 420 },
          panel: { x: 240, y: 90, width: 420, height: 430 },
        }),
      ),
    ).toEqual({
      orb: { x: 640, y: 420 },
      panel: { x: 240, y: 90, width: 420, height: 430 },
    })
  })

  it('ignores corrupt or incomplete persisted layouts', () => {
    expect(parseAgentDockLayout('{')).toBeNull()
    expect(parseAgentDockLayout(JSON.stringify({ orb: { x: 1, y: 2 } }))).toBeNull()
    expect(
      parseAgentDockLayout(
        JSON.stringify({
          orb: { x: 1, y: 2 },
          panel: { x: 3, y: 4, width: 0, height: 5 },
        }),
      ),
    ).toBeNull()
  })
})
