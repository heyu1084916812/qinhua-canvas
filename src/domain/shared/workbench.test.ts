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

  describe('projectRoute 的 focus（对账 #424：跳到画布并定位某个节点）', () => {
    it('不传 focus 时路径一个字不变（老调用方零影响）', () => {
      expect(projectRoute('canvas', 'p1')).toBe('/canvas/p1')
      expect(projectRoute('canvas', 'p1', {})).toBe('/canvas/p1')
    })

    it('★ 传了 focus 就挂成查询串（不是路由段 —— 它是视图意图，不是资源身份）', () => {
      expect(projectRoute('canvas', 'p1', { focus: 'n1' })).toBe('/canvas/p1?focus=n1')
    })

    it('★★ focus 要转义：nodeId 里出现 & 或 = 时不能把查询串撑坏', () => {
      const url = projectRoute('canvas', 'p1', { focus: 'a&b=c' })
      expect(url).toBe('/canvas/p1?focus=a%26b%3Dc')
      /* 解析回来必须还是原来那个 id —— 转义写错的话这里就露馅 */
      expect(new URLSearchParams(url.split('?')[1]).get('focus')).toBe('a&b=c')
    })

    it('★ extract / crop / annotate / rotate 可以单独用，也可以和 focus 组合', () => {
      expect(projectRoute('canvas', 'p1', { focus: 'n1', extract: true })).toBe(
        '/canvas/p1?focus=n1&extract=1',
      )
      expect(projectRoute('canvas', 'p1', { crop: true })).toBe('/canvas/p1?crop=1')
      expect(projectRoute('canvas', 'p1', { focus: 'n1', crop: true })).toBe(
        '/canvas/p1?focus=n1&crop=1',
      )
      expect(projectRoute('canvas', 'p1', { focus: 'n1', annotate: true })).toBe(
        '/canvas/p1?focus=n1&annotate=1',
      )
      expect(projectRoute('canvas', 'p1', { focus: 'n1', rotate: true })).toBe(
        '/canvas/p1?focus=n1&rotate=1',
      )
    })
  })
})
