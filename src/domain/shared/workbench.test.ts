import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKBENCH,
  WORKBENCHES,
  WORKBENCH_ORDER,
  isWorkbenchId,
  projectRoute,
} from './workbench'

/**
 * 工作台骨架（对账 #384 的 D3）。
 *
 * 这几条看着"只是常量"，但它们决定**项目卡点进去落在哪个页面**：
 * 少一条 `WORKBENCHES` 条目，Dexie 里存着 `workbench: 'ecommerce'` 的项目
 * 卡片就会路由到一个不存在的路径（点进去白屏或回首页）。
 */
describe('工作台骨架', () => {
  it('★ 每个 WorkbenchId 都有描述、都在顺序表里、都能路由', () => {
    for (const id of WORKBENCH_ORDER) {
      expect(WORKBENCHES[id]?.id).toBe(id)
      expect(WORKBENCHES[id]?.label.length).toBeGreaterThan(0)
      expect(projectRoute(id, 'p1')).toBe(`${WORKBENCHES[id]?.routePrefix}/p1`)
    }
    // 描述表与顺序表必须一一对应（多一个少一个都是漂移）
    expect([...WORKBENCH_ORDER].sort()).toEqual(Object.keys(WORKBENCHES).sort())
  })

  it('★ 电商 / 漫剧工作台都与画布同级，各有自己的路由前缀', () => {
    expect(WORKBENCH_ORDER).toEqual(['canvas', 'ecommerce', 'storyboard'])
    expect(projectRoute('ecommerce', 'proj_1')).toBe('/ecommerce/proj_1')
    expect(projectRoute('storyboard', 'proj_1')).toBe('/storyboard/proj_1')
    expect(DEFAULT_WORKBENCH).toBe('canvas')
  })

  it('isWorkbenchId 只认已知 id（脏数据不让它路由到不存在的页）', () => {
    expect(isWorkbenchId('canvas')).toBe(true)
    expect(isWorkbenchId('ecommerce')).toBe(true)
    expect(isWorkbenchId('storyboard')).toBe(true)
    expect(isWorkbenchId('comic')).toBe(false)
    expect(isWorkbenchId('')).toBe(false)
  })
})
