import { describe, it, expect } from 'vitest'
import { reduceComic } from './reducer'
import {
  emptyComicProject,
  newComicPanel,
  type BalloonType,
  type ComicPanelRun,
  type ComicProject,
} from '../../../domain/comic/model/comicProject'
import type { LayoutNode } from '../../../domain/comic/model/comicProject'
import { BALLOON_MIN_H, BALLOON_MIN_W } from '../../../domain/comic/panel/balloonLayout'
import { layoutRects } from '../../../domain/comic/layout/layoutEdit'
import { layoutPanelIds, readingOrderOf } from '../../../domain/comic/layout/readingOrder'

const leaf = (panelId: string): LayoutNode => ({ kind: 'panel', panelId })

/** 造一个「有角色 + 有格引用该角色 + 有对白说话人指向该角色」的项目 */
function projectWithRefs(): ComicProject {
  const base = emptyComicProject('p1', 'T')
  const c1 = { id: 'c1', name: '阿花', description: '双马尾', referenceHashes: [] }
  const c2 = { id: 'c2', name: '小北', description: '', referenceHashes: [] }
  const panel = { ...newComicPanel(), id: 'a', characterIds: ['c1', 'c2'] }
  const panelWithBalloon = {
    ...newComicPanel(),
    id: 'b',
    characterIds: [],
    balloons: [
      { id: 'bal1', type: 'speech' as const, text: '你好', speakerId: 'c1', x: 0, y: 0, w: 1, h: 1 },
      { id: 'bal2', type: 'narration' as const, text: '旁白', x: 0, y: 0, w: 1, h: 1 },
    ],
  }
  return {
    ...base,
    characters: [c1, c2],
    episodes: [
      {
        id: 'ep1',
        index: 0,
        title: '第 1 话',
        pages: [
          {
            id: 'pg1',
            index: 0,
            title: '',
            layout: [leaf('a'), leaf('b')],
            panels: [panel, panelWithBalloon],
          },
        ],
      },
    ],
  }
}

describe('reduceComic / episode', () => {
  it('episode.add 追加话，索引与标题自增', () => {
    const p = emptyComicProject('p1')
    const next = reduceComic({ kind: 'episode.add' }, p)
    expect(next.episodes).toHaveLength(1)
    expect(next.episodes[0]!.index).toBe(0)
    expect(next.episodes[0]!.title).toBe('第 1 话')
    expect(p.episodes).toHaveLength(0) // 原对象不可变
  })
})

describe('reduceComic / character.add', () => {
  it('新建角色卡：缺省名「新角色」', () => {
    const next = reduceComic({ kind: 'character.add' }, emptyComicProject('p1'))
    expect(next.characters).toHaveLength(1)
    expect(next.characters[0]!.name).toBe('新角色')
  })

  it('新建角色卡：自定义名（首尾空白裁剪）与描述', () => {
    const next = reduceComic(
      { kind: 'character.add', name: '  阿花  ', description: '双马尾少女' },
      emptyComicProject('p1'),
    )
    expect(next.characters[0]!.name).toBe('阿花')
    expect(next.characters[0]!.description).toBe('双马尾少女')
  })
})

describe('reduceComic / character.update', () => {
  it('改名与改描述（id 不变）', () => {
    const p = projectWithRefs()
    const renamed = reduceComic({ kind: 'character.update', id: 'c1', patch: { name: '花姐' } }, p)
    expect(renamed.characters.find((c) => c.id === 'c1')!.name).toBe('花姐')
    expect(renamed.characters.find((c) => c.id === 'c2')!.name).toBe('小北')

    const described = reduceComic(
      { kind: 'character.update', id: 'c2', patch: { description: '短发' } },
      p,
    )
    expect(described.characters.find((c) => c.id === 'c2')!.description).toBe('短发')
  })

  it('不存在的 id → 返回原引用（无写入）', () => {
    const p = projectWithRefs()
    expect(reduceComic({ kind: 'character.update', id: 'nope', patch: { name: 'x' } }, p)).toBe(p)
  })

  it('patch 与现值相同 → 返回原引用（避免空写库）', () => {
    const p = projectWithRefs()
    expect(
      reduceComic({ kind: 'character.update', id: 'c1', patch: { name: '阿花' } }, p),
    ).toBe(p)
  })
})

describe('reduceComic / character.remove', () => {
  it('移除角色卡，并清除格的 characterIds 引用', () => {
    const next = reduceComic({ kind: 'character.remove', id: 'c1' }, projectWithRefs())
    expect(next.characters.map((c) => c.id)).toEqual(['c2'])
    const panelA = next.episodes[0]!.pages[0]!.panels.find((x) => x.id === 'a')!
    expect(panelA.characterIds).toEqual(['c2'])
  })

  it('移除角色卡，并清除对白的 speakerId（删字段而非置 undefined）', () => {
    const next = reduceComic({ kind: 'character.remove', id: 'c1' }, projectWithRefs())
    const panelB = next.episodes[0]!.pages[0]!.panels.find((x) => x.id === 'b')!
    expect(panelB.balloons[0]!.speakerId).toBeUndefined()
    expect('speakerId' in panelB.balloons[0]!).toBe(false)
    expect(panelB.balloons[1]!.id).toBe('bal2') // 无关对白不动
  })

  it('不存在的 id → 返回原引用', () => {
    const p = projectWithRefs()
    expect(reduceComic({ kind: 'character.remove', id: 'nope' }, p)).toBe(p)
  })
})

describe('reduceComic / project.setReadingDirection', () => {
  it('切换到 rtl', () => {
    const next = reduceComic(
      { kind: 'project.setReadingDirection', direction: 'rtl' },
      emptyComicProject('p1'),
    )
    expect(next.readingDirection).toBe('rtl')
  })

  it('设为同值 → 返回原引用', () => {
    const p = emptyComicProject('p1') // 默认 ltr
    expect(reduceComic({ kind: 'project.setReadingDirection', direction: 'ltr' }, p)).toBe(p)
  })
})

// ─────────────────────────────────────────────────────────────
// 版式（M6-3）
// ─────────────────────────────────────────────────────────────

/** 建一个「一话一页」的项目，返回定位用的 id */
function projectWithPage(): { project: ComicProject; episodeId: string; pageId: string } {
  let p = reduceComic({ kind: 'episode.add' }, emptyComicProject('p1', 'T'))
  const episodeId = p.episodes[0]!.id
  p = reduceComic({ kind: 'page.add', episodeId }, p)
  const pageId = p.episodes[0]!.pages[0]!.id
  return { project: p, episodeId, pageId }
}

const pageOf = (p: ComicProject) => p.episodes[0]!.pages[0]!

describe('reduceComic / page.add', () => {
  it('加页：索引自增、空版式、空池', () => {
    const { project, episodeId } = projectWithPage()
    const next = reduceComic({ kind: 'page.add', episodeId }, project)
    expect(next.episodes[0]!.pages).toHaveLength(2)
    const page = next.episodes[0]!.pages[1]!
    expect(page.index).toBe(1)
    expect(page.layout).toEqual([])
    expect(page.panels).toEqual([])
    expect(project.episodes[0]!.pages).toHaveLength(1) // 原对象不可变
  })

  it('话不存在 → 返回原引用', () => {
    const { project } = projectWithPage()
    expect(reduceComic({ kind: 'page.add', episodeId: 'nope' }, project)).toBe(project)
  })
})

describe('reduceComic / page.instantiate', () => {
  it('空版式 → 满页单格 + 池里新增该格内容', () => {
    const { project, episodeId, pageId } = projectWithPage()
    const next = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const page = pageOf(next)
    expect(page.layout).toEqual([{ kind: 'panel', panelId: page.panels[0]!.id }])
    expect(page.panels).toHaveLength(1)
    expect(layoutRects(page.layout)).toEqual([
      { panelId: page.panels[0]!.id, x: 0, y: 0, w: 1, h: 1 },
    ])
  })

  it('已有版式 → 返回原引用（不覆盖用户排版）', () => {
    const { project, episodeId, pageId } = projectWithPage()
    const laid = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    expect(reduceComic({ kind: 'page.instantiate', episodeId, pageId }, laid)).toBe(laid)
  })

  it('页不存在 → 返回原引用', () => {
    const { project, episodeId } = projectWithPage()
    expect(reduceComic({ kind: 'page.instantiate', episodeId, pageId: 'nope' }, project)).toBe(
      project,
    )
  })
})

describe('reduceComic / page.splitLeaf', () => {
  it('竖切：版式变 2 格、池变 2 格，几何左右各半', () => {
    const { project, episodeId, pageId } = projectWithPage()
    let p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const firstId = pageOf(p).panels[0]!.id

    p = reduceComic(
      { kind: 'page.splitLeaf', episodeId, pageId, panelId: firstId, direction: 'v' },
      p,
    )
    const page = pageOf(p)
    expect(layoutPanelIds(page.layout)).toHaveLength(2)
    expect(page.panels).toHaveLength(2)
    const rects = layoutRects(page.layout)
    expect(rects[0]).toMatchObject({ panelId: firstId, x: 0, w: 0.5 })
    expect(rects[1]).toMatchObject({ x: 0.5, w: 0.5 })
    // 新兄弟格是池里的第二个
    expect(rects[1]!.panelId).toBe(page.panels[1]!.id)
  })

  it('横切与连续切割：可拼出四宫格', () => {
    const { project, episodeId, pageId } = projectWithPage()
    let p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const a = pageOf(p).panels[0]!.id
    p = reduceComic({ kind: 'page.splitLeaf', episodeId, pageId, panelId: a, direction: 'h' }, p)
    const b = pageOf(p).panels[1]!.id
    p = reduceComic({ kind: 'page.splitLeaf', episodeId, pageId, panelId: a, direction: 'v' }, p)
    p = reduceComic({ kind: 'page.splitLeaf', episodeId, pageId, panelId: b, direction: 'v' }, p)
    const page = pageOf(p)
    expect(layoutRects(page.layout)).toHaveLength(4)
    expect(page.panels).toHaveLength(4)
  })

  it('目标格不在版式里 → 返回原引用（不新增池内格）', () => {
    const { project, episodeId, pageId } = projectWithPage()
    const p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const before = pageOf(p).panels.length
    expect(
      reduceComic(
        { kind: 'page.splitLeaf', episodeId, pageId, panelId: 'ghost', direction: 'v' },
        p,
      ),
    ).toBe(p)
    expect(pageOf(p).panels).toHaveLength(before)
  })
})

describe('reduceComic / page.removeLeaf', () => {
  it('删格：版式少一格，但内容仍留池中（删格不丢内容）', () => {
    const { project, episodeId, pageId } = projectWithPage()
    let p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const a = pageOf(p).panels[0]!.id
    p = reduceComic({ kind: 'page.splitLeaf', episodeId, pageId, panelId: a, direction: 'v' }, p)
    const b = pageOf(p).panels[1]!.id

    p = reduceComic({ kind: 'page.removeLeaf', episodeId, pageId, panelId: b }, p)
    const page = pageOf(p)
    expect(layoutPanelIds(page.layout)).toEqual([a])
    expect(page.panels.map((x) => x.id)).toEqual([a, b]) // 池里两者都在
  })

  it('删最后一个格 → 版式回到空（尚未排版），池内容保留', () => {
    const { project, episodeId, pageId } = projectWithPage()
    let p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const a = pageOf(p).panels[0]!.id
    p = reduceComic({ kind: 'page.removeLeaf', episodeId, pageId, panelId: a }, p)
    expect(pageOf(p).layout).toEqual([])
    expect(pageOf(p).panels).toHaveLength(1)
  })

  it('目标格不在版式里 → 返回原引用', () => {
    const { project, episodeId, pageId } = projectWithPage()
    const p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    expect(
      reduceComic({ kind: 'page.removeLeaf', episodeId, pageId, panelId: 'ghost' }, p),
    ).toBe(p)
  })
})

describe('reduceComic / page.layoutReset', () => {
  it('清空版式：回到尚未排版，内容留池', () => {
    const { project, episodeId, pageId } = projectWithPage()
    const p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const next = reduceComic({ kind: 'page.layoutReset', episodeId, pageId }, p)
    expect(pageOf(next).layout).toEqual([])
    expect(pageOf(next).panels).toHaveLength(1)
  })

  it('本来就空 → 返回原引用', () => {
    const { project, episodeId, pageId } = projectWithPage()
    expect(reduceComic({ kind: 'page.layoutReset', episodeId, pageId }, project)).toBe(project)
  })
})

describe('reduceComic / 版式 + 阅读顺序联动', () => {
  it('阅读方向只改顺序，几何位置不变', () => {
    const { project, episodeId, pageId } = projectWithPage()
    let p = reduceComic({ kind: 'page.instantiate', episodeId, pageId }, project)
    const a = pageOf(p).panels[0]!.id
    p = reduceComic({ kind: 'page.splitLeaf', episodeId, pageId, panelId: a, direction: 'v' }, p)
    const page = pageOf(p)
    const ids = layoutPanelIds(page.layout)

    expect(readingOrderOf(page, 'ltr')).toEqual(ids)
    expect(readingOrderOf(page, 'rtl')).toEqual([...ids].reverse())

    const rectsLtr = layoutRects(page.layout)
    const rectsRtl = layoutRects(page.layout)
    expect(rectsLtr).toEqual(rectsRtl) // 几何与方向无关
    // 但「第 n 个读到的格」在两方向下指向不同的 panelId
    expect(readingOrderOf(page, 'ltr')[0]).not.toBe(readingOrderOf(page, 'rtl')[0])
  })
})

// ─────────────────────────────────────────────────────────────
// M6-4：格内容与对白
// ─────────────────────────────────────────────────────────────

/** 造一个「一话一页一格」的项目（格内容为空，便于逐步断言） */
function projectWithSinglePanel(): { project: ComicProject; panelId: string } {
  const panel = newComicPanel()
  const project: ComicProject = {
    ...emptyComicProject('p1', 'T'),
    episodes: [
      {
        id: 'ep1',
        index: 0,
        title: '第 1 话',
        pages: [{ id: 'pg1', index: 0, title: '', layout: [leaf(panel.id)], panels: [panel] }],
      },
    ],
  }
  return { project, panelId: panel.id }
}

function panelOf(project: ComicProject, panelId: string) {
  for (const ep of project.episodes) {
    for (const pg of ep.pages) {
      const found = pg.panels.find((p) => p.id === panelId)
      if (found) return found
    }
  }
  throw new Error(`未找到格 ${panelId}`)
}

describe('reduceComic / panel.update', () => {
  it('改画面描述', () => {
    const { project, panelId } = projectWithSinglePanel()
    const next = reduceComic(
      { kind: 'panel.update', panelId, patch: { scene: '少女在天台' } },
      project,
    )
    expect(panelOf(next, panelId).scene).toBe('少女在天台')
    expect(panelOf(project, panelId).scene).toBe('') // 原对象不可变
  })

  it('改镜头语言（景别 + 机位），未传字段保持不动', () => {
    const { project, panelId } = projectWithSinglePanel()
    const next = reduceComic(
      { kind: 'panel.update', panelId, patch: { shot: { framing: 'close-up' } } },
      project,
    )
    const shot = panelOf(next, panelId).shot
    expect(shot.framing).toBe('close-up')
    expect(shot.angle).toBe('eye-level') // 未传 → 不动
    expect(shot.transition).toBeUndefined()
  })

  it('设置转场 / 用 null 清除转场', () => {
    const { project, panelId } = projectWithSinglePanel()
    const set = reduceComic(
      { kind: 'panel.update', panelId, patch: { shot: { transition: 'action-to-action' } } },
      project,
    )
    expect(panelOf(set, panelId).shot.transition).toBe('action-to-action')
    const cleared = reduceComic(
      { kind: 'panel.update', panelId, patch: { shot: { transition: null } } },
      set,
    )
    expect(panelOf(cleared, panelId).shot.transition).toBeUndefined()
  })

  it('同值 → 返回原引用', () => {
    const { project, panelId } = projectWithSinglePanel()
    expect(reduceComic({ kind: 'panel.update', panelId, patch: { scene: '' } }, project)).toBe(
      project,
    )
    expect(
      reduceComic({ kind: 'panel.update', panelId, patch: { shot: { framing: 'medium' } } }, project),
    ).toBe(project)
  })

  it('未命中 panelId → 返回原引用', () => {
    const { project } = projectWithSinglePanel()
    expect(
      reduceComic({ kind: 'panel.update', panelId: 'ghost', patch: { scene: 'x' } }, project),
    ).toBe(project)
  })
})

describe('reduceComic / panel.toggleCharacter', () => {
  it('勾选加入、再勾取消', () => {
    const { project, panelId } = projectWithSinglePanel()
    const on = reduceComic({ kind: 'panel.toggleCharacter', panelId, characterId: 'c1' }, project)
    expect(panelOf(on, panelId).characterIds).toEqual(['c1'])
    const off = reduceComic({ kind: 'panel.toggleCharacter', panelId, characterId: 'c1' }, on)
    expect(panelOf(off, panelId).characterIds).toEqual([])
  })

  it('未命中 panelId → 返回原引用', () => {
    const { project } = projectWithSinglePanel()
    expect(
      reduceComic({ kind: 'panel.toggleCharacter', panelId: 'ghost', characterId: 'c1' }, project),
    ).toBe(project)
  })
})

describe('reduceComic / balloon.add', () => {
  it('加对白：默认位置带尾巴（下缘中点）', () => {
    const { project, panelId } = projectWithSinglePanel()
    const next = reduceComic({ kind: 'balloon.add', panelId, type: 'speech' }, project)
    const balloons = panelOf(next, panelId).balloons
    expect(balloons).toHaveLength(1)
    const b = balloons[0]!
    expect(b.type).toBe('speech')
    expect(b.text).toBe('')
    expect(b.tail).toEqual({ x: b.x + b.w / 2, y: b.y + b.h })
  })

  it('第二个贴纸纵向叠放（更靠下）；旁白无尾巴', () => {
    const { project, panelId } = projectWithSinglePanel()
    const one = reduceComic({ kind: 'balloon.add', panelId, type: 'speech' }, project)
    const two = reduceComic({ kind: 'balloon.add', panelId, type: 'narration' }, one)
    const balloons = panelOf(two, panelId).balloons
    expect(balloons).toHaveLength(2)
    expect(balloons[1]!.y).toBeGreaterThan(balloons[0]!.y)
    expect(balloons[1]!.tail).toBeUndefined()
  })

  it('未命中 panelId → 返回原引用', () => {
    const { project } = projectWithSinglePanel()
    expect(reduceComic({ kind: 'balloon.add', panelId: 'ghost', type: 'speech' }, project)).toBe(
      project,
    )
  })
})

describe('reduceComic / balloon.update', () => {
  function withBalloon(type: 'speech' | 'narration' = 'speech') {
    const { project, panelId } = projectWithSinglePanel()
    const p = reduceComic({ kind: 'balloon.add', panelId, type }, project)
    const balloonId = panelOf(p, panelId).balloons[0]!.id
    return { project: p, panelId, balloonId }
  }

  it('改文本', () => {
    const { project, panelId, balloonId } = withBalloon()
    const next = reduceComic(
      { kind: 'balloon.update', panelId, balloonId, patch: { text: '你好' } },
      project,
    )
    expect(panelOf(next, panelId).balloons[0]!.text).toBe('你好')
  })

  it('对白 → 旁白：去掉尾巴', () => {
    const { project, panelId, balloonId } = withBalloon('speech')
    const next = reduceComic(
      { kind: 'balloon.update', panelId, balloonId, patch: { type: 'narration' } },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.type).toBe('narration')
    expect(b.tail).toBeUndefined()
  })

  it('旁白 → 心理：补上默认尾巴', () => {
    const { project, panelId, balloonId } = withBalloon('narration')
    const next = reduceComic(
      { kind: 'balloon.update', panelId, balloonId, patch: { type: 'thought' } },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.type).toBe('thought')
    expect(b.tail).toEqual({ x: b.x + b.w / 2, y: b.y + b.h })
  })

  it('设说话人 / 用 null 清除说话人', () => {
    const { project, panelId, balloonId } = withBalloon()
    const set = reduceComic(
      { kind: 'balloon.update', panelId, balloonId, patch: { speakerId: 'c1' } },
      project,
    )
    expect(panelOf(set, panelId).balloons[0]!.speakerId).toBe('c1')
    const cleared = reduceComic(
      { kind: 'balloon.update', panelId, balloonId, patch: { speakerId: null } },
      set,
    )
    expect(panelOf(cleared, panelId).balloons[0]!.speakerId).toBeUndefined()
  })

  it('同值 / 未命中 → 返回原引用', () => {
    const { project, panelId, balloonId } = withBalloon()
    expect(
      reduceComic({ kind: 'balloon.update', panelId, balloonId, patch: { text: '' } }, project),
    ).toBe(project)
    expect(
      reduceComic({ kind: 'balloon.update', panelId, balloonId, patch: { type: 'speech' } }, project),
    ).toBe(project)
    expect(
      reduceComic({ kind: 'balloon.update', panelId, balloonId: 'ghost', patch: { text: 'x' } }, project),
    ).toBe(project)
  })
})

describe('reduceComic / balloon.move', () => {
  function withBalloon() {
    const { project, panelId } = projectWithSinglePanel()
    const p = reduceComic({ kind: 'balloon.add', panelId, type: 'speech' }, project)
    const balloonId = panelOf(p, panelId).balloons[0]!.id
    return { project: p, panelId, balloonId }
  }

  it('移动到新位置，尾巴跟随平移', () => {
    const { project, panelId, balloonId } = withBalloon()
    const before = panelOf(project, panelId).balloons[0]!
    const dx = 0.1
    const dy = 0.08
    const next = reduceComic(
      { kind: 'balloon.move', panelId, balloonId, x: before.x + dx, y: before.y + dy },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.x).toBeCloseTo(before.x + dx, 6)
    expect(b.y).toBeCloseTo(before.y + dy, 6)
    expect(b.tail!.x).toBeCloseTo(before.tail!.x + dx, 6)
    expect(b.tail!.y).toBeCloseTo(before.tail!.y + dy, 6)
  })

  it('拖出格 → 夹回格内', () => {
    const { project, panelId, balloonId } = withBalloon()
    const next = reduceComic(
      { kind: 'balloon.move', panelId, balloonId, x: 9, y: 9 },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.x).toBeCloseTo(1 - b.w, 6)
    expect(b.y).toBeCloseTo(1 - b.h, 6)
  })

  it('移动到同一点 / 未命中 → 返回原引用', () => {
    const { project, panelId, balloonId } = withBalloon()
    const b = panelOf(project, panelId).balloons[0]!
    expect(
      reduceComic({ kind: 'balloon.move', panelId, balloonId, x: b.x, y: b.y }, project),
    ).toBe(project)
    expect(
      reduceComic({ kind: 'balloon.move', panelId, balloonId: 'ghost', x: 0, y: 0 }, project),
    ).toBe(project)
  })
})

describe('reduceComic / balloon.resize（M6-14）', () => {
  function withBalloon(type: BalloonType = 'speech') {
    const { project, panelId } = projectWithSinglePanel()
    const p = reduceComic({ kind: 'balloon.add', panelId, type }, project)
    const balloonId = panelOf(p, panelId).balloons[0]!.id
    return { project: p, panelId, balloonId }
  }

  it('改宽高，左上角不动，尾巴按比例跟随（仍是新的下缘中点）', () => {
    const { project, panelId, balloonId } = withBalloon()
    const before = panelOf(project, panelId).balloons[0]!
    const next = reduceComic(
      { kind: 'balloon.resize', panelId, balloonId, w: 0.8, h: 0.32 },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.w).toBeCloseTo(0.8, 6)
    expect(b.h).toBeCloseTo(0.32, 6)
    expect(b.x).toBeCloseTo(before.x, 6)
    expect(b.y).toBeCloseTo(before.y, 6)
    expect(b.tail!.x).toBeCloseTo(b.x + b.w / 2, 6)
    expect(b.tail!.y).toBeCloseTo(b.y + b.h, 6)
  })

  it('缩到低于下限 → 抬到下限；无尾巴的贴纸缩放后仍无尾巴', () => {
    const { project, panelId, balloonId } = withBalloon('sfx')
    const next = reduceComic(
      { kind: 'balloon.resize', panelId, balloonId, w: 0, h: 0 },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.w).toBe(BALLOON_MIN_W)
    expect(b.h).toBe(BALLOON_MIN_H)
    expect(b.tail).toBeUndefined()
  })

  it('尺寸未变 / 未命中 → 返回原引用', () => {
    const { project, panelId, balloonId } = withBalloon()
    const b = panelOf(project, panelId).balloons[0]!
    expect(
      reduceComic({ kind: 'balloon.resize', panelId, balloonId, w: b.w, h: b.h }, project),
    ).toBe(project)
    expect(
      reduceComic({ kind: 'balloon.resize', panelId, balloonId: 'ghost', w: 0.5, h: 0.5 }, project),
    ).toBe(project)
  })
})

describe('reduceComic / balloon.moveTail（M6-14）', () => {
  function withBalloon(type: BalloonType = 'speech') {
    const { project, panelId } = projectWithSinglePanel()
    const p = reduceComic({ kind: 'balloon.add', panelId, type }, project)
    const balloonId = panelOf(p, panelId).balloons[0]!.id
    return { project: p, panelId, balloonId }
  }

  it('只改尾巴锚点，气泡本体不动', () => {
    const { project, panelId, balloonId } = withBalloon()
    const before = panelOf(project, panelId).balloons[0]!
    const next = reduceComic(
      { kind: 'balloon.moveTail', panelId, balloonId, x: 0.1, y: 0.9 },
      project,
    )
    const b = panelOf(next, panelId).balloons[0]!
    expect(b.tail).toEqual({ x: 0.1, y: 0.9 })
    expect(b.x).toBe(before.x)
    expect(b.y).toBe(before.y)
    expect(b.w).toBe(before.w)
    expect(b.h).toBe(before.h)
  })

  it('拖出格 → 夹回 [0,1]', () => {
    const { project, panelId, balloonId } = withBalloon()
    const next = reduceComic(
      { kind: 'balloon.moveTail', panelId, balloonId, x: -1, y: 4 },
      project,
    )
    expect(panelOf(next, panelId).balloons[0]!.tail).toEqual({ x: 0, y: 1 })
  })

  it('无尾巴的贴纸 / 同一锚点 / 未命中 → 返回原引用', () => {
    const noTail = withBalloon('narration')
    expect(
      reduceComic(
        { kind: 'balloon.moveTail', panelId: noTail.panelId, balloonId: noTail.balloonId, x: 0.3, y: 0.3 },
        noTail.project,
      ),
    ).toBe(noTail.project)

    const { project, panelId, balloonId } = withBalloon()
    const tail = panelOf(project, panelId).balloons[0]!.tail!
    expect(
      reduceComic(
        { kind: 'balloon.moveTail', panelId, balloonId, x: tail.x, y: tail.y },
        project,
      ),
    ).toBe(project)
    expect(
      reduceComic({ kind: 'balloon.moveTail', panelId, balloonId: 'ghost', x: 0.5, y: 0.5 }, project),
    ).toBe(project)
  })
})

describe('reduceComic / balloon.remove', () => {
  it('删掉贴纸', () => {
    const { project, panelId } = projectWithSinglePanel()
    const p = reduceComic({ kind: 'balloon.add', panelId, type: 'speech' }, project)
    const balloonId = panelOf(p, panelId).balloons[0]!.id
    const next = reduceComic({ kind: 'balloon.remove', panelId, balloonId }, p)
    expect(panelOf(next, panelId).balloons).toHaveLength(0)
  })

  it('未命中 balloonId → 返回原引用', () => {
    const { project, panelId } = projectWithSinglePanel()
    const p = reduceComic({ kind: 'balloon.add', panelId, type: 'speech' }, project)
    expect(reduceComic({ kind: 'balloon.remove', panelId, balloonId: 'ghost' }, p)).toBe(p)
  })
})

describe('reduceComic / panel.setAsset（M6-5 生成结果写回）', () => {
  it('写入 assetHash（原对象不可变）', () => {
    const { project, panelId } = projectWithSinglePanel()
    const next = reduceComic({ kind: 'panel.setAsset', panelId, assetHash: 'h1' }, project)
    expect(panelOf(next, panelId).assetHash).toBe('h1')
    expect(panelOf(project, panelId).assetHash).toBeUndefined()
  })

  it('同值 → 返回原引用', () => {
    const { project, panelId } = projectWithSinglePanel()
    const once = reduceComic({ kind: 'panel.setAsset', panelId, assetHash: 'h1' }, project)
    expect(reduceComic({ kind: 'panel.setAsset', panelId, assetHash: 'h1' }, once)).toBe(once)
  })

  it('null 清除 assetHash；本来就无 → 原引用', () => {
    const { project, panelId } = projectWithSinglePanel()
    expect(reduceComic({ kind: 'panel.setAsset', panelId, assetHash: null }, project)).toBe(project)
    const set = reduceComic({ kind: 'panel.setAsset', panelId, assetHash: 'h1' }, project)
    const cleared = reduceComic({ kind: 'panel.setAsset', panelId, assetHash: null }, set)
    expect(panelOf(cleared, panelId).assetHash).toBeUndefined()
  })

  it('写回结果**不动对白层**（「重生成不丢对白」的实现层保证）', () => {
    const { project, panelId } = projectWithSinglePanel()
    const withBalloon = reduceComic({ kind: 'balloon.add', panelId, type: 'speech' }, project)
    const balloonId = panelOf(withBalloon, panelId).balloons[0]!.id
    const withText = reduceComic(
      { kind: 'balloon.update', panelId, balloonId, patch: { text: '台词' } },
      withBalloon,
    )
    const generated = reduceComic({ kind: 'panel.setAsset', panelId, assetHash: 'h9' }, withText)
    const panel = panelOf(generated, panelId)
    expect(panel.assetHash).toBe('h9')
    expect(panel.balloons).toHaveLength(1)
    expect(panel.balloons[0]!.text).toBe('台词')
    // 对白数组引用未变 → 不是重建
    expect(panel.balloons).toBe(panelOf(withText, panelId).balloons)
  })

  it('未命中 panelId → 返回原引用', () => {
    const { project } = projectWithSinglePanel()
    expect(reduceComic({ kind: 'panel.setAsset', panelId: 'ghost', assetHash: 'h' }, project)).toBe(
      project,
    )
  })
})

describe('reduceComic / panel.update 生成配置（M6-5）', () => {
  it('设渠道与模型', () => {
    const { project, panelId } = projectWithSinglePanel()
    const next = reduceComic(
      { kind: 'panel.update', panelId, patch: { channelId: 'ch1', model: 'm1' } },
      project,
    )
    expect(panelOf(next, panelId).channelId).toBe('ch1')
    expect(panelOf(next, panelId).model).toBe('m1')
  })

  it('同值 → 返回原引用', () => {
    const { project, panelId } = projectWithSinglePanel()
    const once = reduceComic(
      { kind: 'panel.update', panelId, patch: { channelId: 'ch1', model: 'm1' } },
      project,
    )
    expect(
      reduceComic({ kind: 'panel.update', panelId, patch: { channelId: 'ch1', model: 'm1' } }, once),
    ).toBe(once)
  })
})

// ─────────────────────────────────────────────────────────────
// M6-15 生成留痕与版本回退
// 域层三条不变量（只增不减 / 版本号自推 / 回退也追加）在
// `domain/comic/panel/panelRunRecord.test.ts` 逐条落锁；这里只验**命令接线**：
// 命令能定位到格、能写进历史、无变化时原样返回原引用。
// ─────────────────────────────────────────────────────────────

/** 留痕载荷（不含 version——它由 reducer 从格的历史推出） */
function runInput(over: Partial<Omit<ComicPanelRun, 'version'>> = {}): Omit<ComicPanelRun, 'version'> {
  return {
    id: 'r1',
    createdAt: 1000,
    status: 'succeeded',
    outputHashes: ['h1'],
    scene: '雨夜的霓虹街道',
    framing: 'medium',
    angle: 'eye-level',
    characterIds: [],
    channelId: 'ch-mock',
    model: 'mock-image-1',
    referenceHashes: [],
    fingerprint: 'fp1',
    durationMs: 120,
    ...over,
  }
}

describe('reduceComic / panel.runRecord.append（M6-15 生成留痕）', () => {
  it('把留痕写进格的历史，版本号从 1 起（原对象不可变）', () => {
    const { project, panelId } = projectWithSinglePanel()
    const next = reduceComic(
      { kind: 'panel.runRecord.append', panelId, run: runInput() },
      project,
    )
    expect(panelOf(next, panelId).runs).toHaveLength(1)
    expect(panelOf(next, panelId).runs[0]!.version).toBe(1)
    // 原对象不动（不可变）
    expect(panelOf(project, panelId).runs).toHaveLength(0)
  })

  it('连续两次生成 → 版本号顺延为 1 / 2', () => {
    const { project, panelId } = projectWithSinglePanel()
    const once = reduceComic(
      { kind: 'panel.runRecord.append', panelId, run: runInput({ id: 'r1' }) },
      project,
    )
    const twice = reduceComic(
      { kind: 'panel.runRecord.append', panelId, run: runInput({ id: 'r2' }) },
      once,
    )
    expect(panelOf(twice, panelId).runs.map((r) => r.version)).toEqual([1, 2])
  })

  it('同一条留痕重复落（同 id）→ 返回原引用，不出孪生版本', () => {
    const { project, panelId } = projectWithSinglePanel()
    const once = reduceComic(
      { kind: 'panel.runRecord.append', panelId, run: runInput({ id: 'dup' }) },
      project,
    )
    expect(
      reduceComic({ kind: 'panel.runRecord.append', panelId, run: runInput({ id: 'dup' }) }, once),
    ).toBe(once)
  })

  it('未命中 panelId → 返回原引用', () => {
    const { project } = projectWithSinglePanel()
    expect(
      reduceComic({ kind: 'panel.runRecord.append', panelId: 'ghost', run: runInput() }, project),
    ).toBe(project)
  })
})

describe('reduceComic / panel.runRecord.restore（M6-15 版本回退）', () => {
  /** 造一格：历史里两条成功版本（v1 描述 A、v2 描述 B），当前画面停在 v2 */
  function projectWithHistory(): { project: ComicProject; panelId: string } {
    const { project, panelId } = projectWithSinglePanel()
    const withTwo = [
      runInput({ id: 'r1', scene: 'A 画面', outputHashes: ['hA'] }),
      runInput({ id: 'r2', scene: 'B 画面', outputHashes: ['hB'] }),
    ].reduce(
      (p, run) => reduceComic({ kind: 'panel.runRecord.append', panelId, run }, p),
      project,
    )
    const current = reduceComic(
      { kind: 'panel.update', panelId, patch: { scene: 'B 画面' } },
      withTwo,
    )
    return { project: reduceComic({ kind: 'panel.setAsset', panelId, assetHash: 'hB' }, current), panelId }
  }

  it('回退：画面输入与产物写回源版本，且回退本身追加为新版本（历史只增）', () => {
    const { project, panelId } = projectWithHistory()
    const next = reduceComic(
      { kind: 'panel.runRecord.restore', panelId, runId: 'r1', newRunId: 'r3', createdAt: 5000 },
      project,
    )
    const panel = panelOf(next, panelId)
    expect(panel.scene).toBe('A 画面')
    expect(panel.assetHash).toBe('hA')
    // 历史只增：两条原版本仍在，回退追加为第三条
    expect(panel.runs).toHaveLength(3)
    expect(panel.runs.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(panel.runs[2]!.version).toBe(3)
  })

  it('回退到失败版本 → 返回原引用（不留假痕迹、不空写）', () => {
    const { project, panelId } = projectWithSinglePanel()
    const withFailed = reduceComic(
      {
        kind: 'panel.runRecord.append',
        panelId,
        run: runInput({ id: 'rf', status: 'failed', outputHashes: [] }),
      },
      project,
    )
    expect(
      reduceComic(
        { kind: 'panel.runRecord.restore', panelId, runId: 'rf', newRunId: 'x', createdAt: 1 },
        withFailed,
      ),
    ).toBe(withFailed)
  })

  it('源版本不存在 / 未命中 panelId → 返回原引用', () => {
    const { project, panelId } = projectWithHistory()
    expect(
      reduceComic(
        { kind: 'panel.runRecord.restore', panelId, runId: 'ghost', newRunId: 'x', createdAt: 1 },
        project,
      ),
    ).toBe(project)
    expect(
      reduceComic(
        { kind: 'panel.runRecord.restore', panelId: 'ghost', runId: 'r1', newRunId: 'x', createdAt: 1 },
        project,
      ),
    ).toBe(project)
  })
})
