import { describe, it, expect } from 'vitest'
import type {
  ComicEpisode,
  ComicPage,
  ComicProject,
  LayoutNode,
} from '../model/comicProject'
import { emptyComicProject } from '../model/comicProject'
import { planExport, sanitizeSegment } from './exportPlan'

/** 满版切割：`n === 1` 单格；`n >= 2` 一次竖切等分（叶子即格子） */
function layoutOf(n: number): LayoutNode[] {
  if (n <= 0) return []
  const leaves: LayoutNode[] = Array.from({ length: n }, (_, i) => ({
    kind: 'panel',
    panelId: `p${i}`,
  }))
  return n === 1 ? leaves : [{ kind: 'cut', direction: 'v', position: 'equal', count: n, children: leaves }]
}

function pageOf(id: string, index: number, panelCount: number): ComicPage {
  return { id, index, title: '', layout: layoutOf(panelCount), panels: [] }
}

function episodeOf(id: string, index: number, title: string, panelCounts: number[]): ComicEpisode {
  return {
    id,
    index,
    title,
    pages: panelCounts.map((n, i) => pageOf(`${id}-pg${i}`, i, n)),
  }
}

function projectOf(episodes: ComicEpisode[]): ComicProject {
  const base = emptyComicProject('proj', '雨夜')
  return { ...base, episodes }
}

describe('sanitizeSegment', () => {
  it('清掉各平台非法字符', () => {
    expect(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('折叠空白并裁剪首尾', () => {
    expect(sanitizeSegment('  第   1   话  ')).toBe('第 1 话')
  })

  it('净化后为空则回落 fallback', () => {
    expect(sanitizeSegment('///', '话')).toBe('___')
    expect(sanitizeSegment('   ', '话')).toBe('话')
  })
})

describe('planExport / 单页布局', () => {
  const project = projectOf([
    episodeOf('ep1', 0, '第 1 话', [1, 2, 1]),
    episodeOf('ep2', 1, '第 2 话', [3]),
  ])

  it('本话：逐页一张，路径前缀为话名', () => {
    const plan = planExport(project, { scope: 'episode', layout: 'page', episodeIndex: 0 })
    expect(plan.sheets.map((s) => s.path)).toEqual([
      '第 1 话/001.png',
      '第 1 话/002.png',
      '第 1 话/003.png',
    ])
    expect(plan.sheets.map((s) => s.episodeIndex)).toEqual([0, 0, 0])
    expect(plan.sheets.map((s) => s.pageIndices)).toEqual([[0], [1], [2]])
    expect(plan.fileName).toBe('雨夜-第 1 话.zip')
    expect(plan.pageTotal).toBe(3)
  })

  it('项目：多一层项目名目录，条目按话顺序展开', () => {
    const plan = planExport(project, { scope: 'project', layout: 'page' })
    expect(plan.sheets.map((s) => s.path)).toEqual([
      '雨夜/第 1 话/001.png',
      '雨夜/第 1 话/002.png',
      '雨夜/第 1 话/003.png',
      '雨夜/第 2 话/001.png',
    ])
    expect(plan.fileName).toBe('雨夜.zip')
    expect(plan.pageTotal).toBe(4)
  })

  it('未排版的页计入 emptyPages', () => {
    const plan = planExport(projectOf([episodeOf('e', 0, '第 1 话', [1, 0, 0])]), {
      scope: 'episode',
      layout: 'page',
    })
    expect(plan.pageTotal).toBe(3)
    expect(plan.emptyPages).toBe(2)
  })

  it('episodeIndex 越界夹回最后一话', () => {
    const plan = planExport(project, { scope: 'episode', layout: 'page', episodeIndex: 9 })
    expect(plan.sheets.every((s) => s.episodeIndex === 1)).toBe(true)
    expect(plan.fileName).toBe('雨夜-第 2 话.zip')
  })
})

describe('planExport / 跨页布局（复用 spreadGroups）', () => {
  it('3 页 → 封面单页 + 「002-003」成组', () => {
    const plan = planExport(projectOf([episodeOf('e', 0, '第 1 话', [1, 2, 3])]), {
      scope: 'episode',
      layout: 'spread',
    })
    expect(plan.sheets.map((s) => s.path)).toEqual(['第 1 话/001.png', '第 1 话/002-003.png'])
    expect(plan.sheets.map((s) => s.pageIndices)).toEqual([[0], [1, 2]])
  })

  it('5 页 → 001 / 002-003 / 004-005', () => {
    const plan = planExport(projectOf([episodeOf('e', 0, '第 1 话', [1, 1, 1, 1, 1])]), {
      scope: 'episode',
      layout: 'spread',
    })
    expect(plan.sheets.map((s) => s.path)).toEqual([
      '第 1 话/001.png',
      '第 1 话/002-003.png',
      '第 1 话/004-005.png',
    ])
  })

  it('无封面惯例（loneFirst=false）：4 页 → 001-002 / 003-004', () => {
    const plan = planExport(projectOf([episodeOf('e', 0, '第 1 话', [1, 1, 1, 1])]), {
      scope: 'episode',
      layout: 'spread',
      loneFirst: false,
    })
    expect(plan.sheets.map((s) => s.path)).toEqual(['第 1 话/001-002.png', '第 1 话/003-004.png'])
  })

  it('页序始终升序（方向不影响图张顺序）', () => {
    const plan = planExport(projectOf([episodeOf('e', 0, '第 1 话', [1, 1, 1, 1])]), {
      scope: 'episode',
      layout: 'spread',
    })
    for (const sheet of plan.sheets) {
      expect([...sheet.pageIndices].sort((a, b) => a - b)).toEqual(sheet.pageIndices)
    }
  })
})

describe('planExport / 边界', () => {
  it('没有话：空计划，但文件名仍可由项目名给出', () => {
    const plan = planExport(projectOf([]), { scope: 'episode', layout: 'page' })
    expect(plan.sheets).toEqual([])
    expect(plan.pageTotal).toBe(0)
    expect(plan.fileName).toBe('雨夜.zip')
  })

  it('话内没有页：不产出图张', () => {
    const plan = planExport(projectOf([episodeOf('e', 0, '第 1 话', [])]), {
      scope: 'episode',
      layout: 'page',
    })
    expect(plan.sheets).toEqual([])
    expect(plan.pageTotal).toBe(0)
  })

  it('项目标题含非法字符时被净化进文件名与目录', () => {
    const base = emptyComicProject('p', '甲/乙:丙')
    const plan = planExport({ ...base, episodes: [episodeOf('e', 0, '第 1 话', [1])] }, {
      scope: 'project',
      layout: 'page',
    })
    expect(plan.fileName).toBe('甲_乙_丙.zip')
    expect(plan.sheets[0]!.path).toBe('甲_乙_丙/第 1 话/001.png')
  })
})
