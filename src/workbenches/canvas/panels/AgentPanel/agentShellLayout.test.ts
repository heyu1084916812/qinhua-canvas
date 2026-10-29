import { describe, expect, it } from 'vitest'
import {
  AGENT_ORB_SIZE,
  AGENT_SHELL_GAP,
  AGENT_SHELL_WIDTH_DEFAULT,
  AGENT_SHELL_WIDTH_MIN,
  agentShellMaxWidth,
  agentShellWidth,
  clampAgentOrb,
  clampAgentShellState,
  defaultAgentShellState,
  parseAgentShellState,
  parseLegacyAgentShellState,
  resizedAgentShellWidth,
  type AgentWorkArea,
} from './agentShellLayout'

const AREA: AgentWorkArea = { x: 64, y: 48, width: 1200, height: 800 }

describe('Agent shell layout', () => {
  it('keeps the orb inside the canvas and uses the shell default width', () => {
    const state = defaultAgentShellState(AREA)
    expect(state.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_SHELL_GAP)
    expect(state.width).toBe(AGENT_SHELL_WIDTH_DEFAULT)
  })

  it('clamps the orb without moving it when already inside the work area', () => {
    const point = { x: AREA.x + 120, y: AREA.y + 240 }
    expect(clampAgentOrb(point, AREA)).toEqual(point)
  })

  it('keeps panel width between the minimum and the current viewport width', () => {
    expect(agentShellWidth(100, 1440)).toBe(AGENT_SHELL_WIDTH_MIN)
    expect(agentShellMaxWidth(1920)).toBe(1890)
    expect(agentShellWidth(5000, 1920)).toBe(1890)
    expect(resizedAgentShellWidth(420, 800, 700, 1440)).toBe(520)
  })

  it('clamps persisted state against the current viewport', () => {
    const state = clampAgentShellState(
      { orb: { x: 99999, y: -99999 }, width: 99999 },
      AREA,
      1024,
    )
    expect(state.orb.x + AGENT_ORB_SIZE).toBeLessThanOrEqual(AREA.x + AREA.width - AGENT_SHELL_GAP)
    expect(state.orb.y).toBe(AREA.y + AGENT_SHELL_GAP)
    expect(state.width).toBe(994)
  })

  it('restores v2 state and migrates only the orb from v1', () => {
    expect(
      parseAgentShellState(JSON.stringify({ orb: { x: 640, y: 420 }, width: 480 })),
    ).toEqual({
      orb: { x: 640, y: 420 },
      width: 480,
    })
    expect(
      parseLegacyAgentShellState(
        JSON.stringify({
          orb: { x: 300, y: 260 },
          panel: { x: 10, y: 20, width: 380, height: 500 },
        }),
      ),
    ).toEqual({
      orb: { x: 300, y: 260 },
      width: 380,
    })
  })

  it('ignores corrupt persisted state', () => {
    expect(parseAgentShellState('{')).toBeNull()
    expect(parseAgentShellState(JSON.stringify({ orb: { x: 1, y: 2 } }))).toBeNull()
    expect(parseLegacyAgentShellState(JSON.stringify({ panel: { width: 380 } }))).toBeNull()
  })
})
