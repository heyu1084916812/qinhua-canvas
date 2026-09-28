import { describe, expect, it } from 'vitest'
import {
  allVisibleProjectsSelected,
  clearVisibleProjects,
  selectVisibleProjects,
  toggleProjectSelection,
} from './selection'

describe('项目选择语义', () => {
  it('toggle 只切换目标项目，不改变其他已选项', () => {
    expect([...toggleProjectSelection(new Set(['a']), 'b')].sort()).toEqual(['a', 'b'])
    expect([...toggleProjectSelection(new Set(['a', 'b']), 'a')]).toEqual(['b'])
  })

  it('全选保留筛选之外已经选中的项目', () => {
    const next = selectVisibleProjects(new Set(['hidden']), ['a', 'b'])
    expect([...next].sort()).toEqual(['a', 'b', 'hidden'])
  })

  it('是否全选只看当前可见集合', () => {
    expect(allVisibleProjectsSelected(new Set(['a']), ['a'])).toBe(true)
    expect(allVisibleProjectsSelected(new Set(['a']), ['a', 'b'])).toBe(false)
    expect(allVisibleProjectsSelected(new Set(['a']), [])).toBe(false)
  })

  it('清除只移除当前可见项目，保留其他筛选项', () => {
    const next = clearVisibleProjects(new Set(['a', 'hidden']), ['a'])
    expect([...next]).toEqual(['hidden'])
  })
})
