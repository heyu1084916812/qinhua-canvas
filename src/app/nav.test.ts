import { describe, expect, it } from 'vitest'
import { navTargetFor } from './nav'

describe('一级工作台导航保留当前项目', () => {
  it('画布 / 电商 / 漫剧在已打开项目时都指向同一项目 id', () => {
    expect(navTargetFor('/canvas', 'proj_1')).toBe('/canvas/proj_1')
    expect(navTargetFor('/ecommerce', 'proj_1')).toBe('/ecommerce/proj_1')
    expect(navTargetFor('/storyboard', 'proj_1')).toBe('/storyboard/proj_1')
  })

  it('没有当前项目时回落到原有入口；非工作台导航不附加项目 id', () => {
    expect(navTargetFor('/canvas', null)).toBe('/canvas')
    expect(navTargetFor('/projects', 'proj_1')).toBe('/projects')
    expect(navTargetFor('/settings', 'proj_1')).toBe('/settings')
  })
})
