import { describe, expect, it } from 'vitest'
import { navProjectContextFor, navTargetFor } from './nav'

describe('一级工作台导航按项目类型隔离', () => {
  it('类型一致时保留项目 id', () => {
    expect(navTargetFor('/canvas', { id: 'proj_1', workbench: 'canvas' })).toBe(
      '/canvas/proj_1',
    )
    expect(navTargetFor('/ecommerce', { id: 'proj_2', workbench: 'ecommerce' })).toBe(
      '/ecommerce/proj_2',
    )
    expect(navTargetFor('/storyboard', { id: 'proj_3', workbench: 'storyboard' })).toBe(
      '/storyboard/proj_3',
    )
  })

  it('类型不一致时不串项目 id，而是进目标工作台入口页', () => {
    const ecommerce = { id: 'proj_ecommerce', workbench: 'ecommerce' as const }
    expect(navTargetFor('/canvas', ecommerce)).toBe('/canvas')
    expect(navTargetFor('/storyboard', ecommerce)).toBe('/storyboard')

    const canvas = { id: 'proj_canvas', workbench: 'canvas' as const }
    expect(navTargetFor('/ecommerce', canvas)).toBe('/ecommerce')
    expect(navTargetFor('/storyboard', canvas)).toBe('/storyboard')
  })

  it('没有当前项目时回落到入口；非工作台导航不附加项目 id', () => {
    expect(navTargetFor('/canvas', null)).toBe('/canvas')
    expect(
      navTargetFor('/projects', { id: 'proj_1', workbench: 'canvas' }),
    ).toBe('/projects')
    expect(
      navTargetFor('/settings', { id: 'proj_1', workbench: 'canvas' }),
    ).toBe('/settings')
  })

  it('跨工作台导航使用目标工作台自己的最近项目，而不是当前项目或入口页', () => {
    const active = { id: 'proj_canvas', workbench: 'canvas' as const }
    const recentIds = {
      canvas: 'canvas-recent',
      ecommerce: 'ecommerce-recent',
      storyboard: 'storyboard-recent',
    }
    expect(navProjectContextFor('/canvas', active, recentIds)).toEqual(active)
    expect(navProjectContextFor('/ecommerce', active, recentIds)).toEqual({
      id: 'ecommerce-recent',
      workbench: 'ecommerce',
    })
    expect(navTargetFor('/ecommerce', navProjectContextFor('/ecommerce', active, recentIds))).toBe(
      '/ecommerce/ecommerce-recent',
    )
    expect(navProjectContextFor('/projects', active, recentIds)).toBeNull()
  })
})
