import { describe, it, expect } from 'vitest'
import {
  emptyComicProject,
  newComicPanel,
  newComicCharacter,
  addCharacterReference,
  removeCharacterReference,
  countPages,
  countPanels,
  normalizeComicProject,
  DEFAULT_READING_DIRECTION,
  DEFAULT_FRAMING,
  DEFAULT_ANGLE,
} from './comicProject'
import type { ComicProject, LayoutNode } from './comicProject'

const leaf = (panelId: string): LayoutNode => ({ kind: 'panel', panelId })

describe('comicProject / 工厂', () => {
  it('emptyComicProject 补齐 v2 项目级字段', () => {
    const p = emptyComicProject('p1')
    expect(p).toMatchObject({
      id: 'p1',
      title: '未命名漫画剧',
      readingDirection: DEFAULT_READING_DIRECTION,
      characters: [],
      episodes: [],
    })
  })

  it('newComicPanel 三层皆空且用缺省镜头', () => {
    const panel = newComicPanel()
    expect(panel.scene).toBe('')
    expect(panel.shot).toEqual({ framing: DEFAULT_FRAMING, angle: DEFAULT_ANGLE })
    expect(panel.characterIds).toEqual([])
    expect(panel.balloons).toEqual([])
    expect(panel.id).toMatch(/^panel_/)
  })

  it('newComicCharacter 空名回退「新角色」，描述与参考图可空', () => {
    expect(newComicCharacter()).toMatchObject({
      name: '新角色',
      description: '',
      referenceHashes: [],
    })
    expect(newComicCharacter({ name: '  阿花  ' }).name).toBe('阿花')
  })
})

describe('comicProject / 统计', () => {
  const project: ComicProject = {
    id: 'p1',
    title: 'T',
    readingDirection: 'ltr',
    characters: [],
    episodes: [
      {
        id: 'ep1',
        index: 0,
        title: '第 1 话',
        pages: [
          // 已排 2 格，池里多一个孤儿
          { id: 'pg1', index: 0, title: '', layout: [leaf('a'), leaf('b')], panels: [
            { id: 'a', scene: '', shot: { framing: 'medium', angle: 'eye-level' }, characterIds: [], balloons: [], runs: [] },
            { id: 'b', scene: '', shot: { framing: 'medium', angle: 'eye-level' }, characterIds: [], balloons: [], runs: [] },
            { id: 'orphan', scene: '', shot: { framing: 'medium', angle: 'eye-level' }, characterIds: [], balloons: [], runs: [] },
          ] },
          // 尚未排版
          { id: 'pg2', index: 1, title: '', layout: [], panels: [] },
        ],
      },
    ],
  }

  it('countPages 统计全部页', () => {
    expect(countPages(project)).toBe(2)
  })

  it('countPanels 只算已排入版式的格（池中孤儿不计）', () => {
    expect(countPanels(project)).toBe(2)
  })

  it('未排版页计 0 格', () => {
    expect(countPanels(emptyComicProject('x'))).toBe(0)
  })
})

describe('comicProject / 读回归一化', () => {
  it('空 / 垃圾输入 → 全默认（不抛错）', () => {
    for (const bad of [null, undefined, 42, 'x', {}]) {
      const p = normalizeComicProject(bad)
      expect(p.readingDirection).toBe(DEFAULT_READING_DIRECTION)
      expect(p.characters).toEqual([])
      expect(p.episodes).toEqual([])
      expect(p.title).toBe('未命名漫画剧')
    }
  })

  it('旧版行（无 readingDirection / characters）补默认，保留原有话', () => {
    const legacy = {
      id: 'p1',
      title: '旧漫画',
      episodes: [{ id: 'ep1', index: 0, title: '第 1 话', pages: [] }],
    }
    const p = normalizeComicProject(legacy)
    expect(p.id).toBe('p1')
    expect(p.title).toBe('旧漫画')
    expect(p.readingDirection).toBe('ltr')
    expect(p.characters).toEqual([])
    expect(p.episodes).toHaveLength(1)
    expect(p.episodes[0]!.title).toBe('第 1 话')
  })

  it('非法词表值收敛到缺省（readingDirection / framing / angle）', () => {
    const p = normalizeComicProject({
      id: 'p1',
      readingDirection: 'diagonal',
      episodes: [
        {
          id: 'ep1',
          pages: [
            {
              id: 'pg1',
              panels: [{ id: 'a', shot: { framing: 'gigantic', angle: 'moon' } }],
            },
          ],
        },
      ],
    })
    expect(p.readingDirection).toBe('ltr')
    expect(p.episodes[0]!.pages[0]!.panels[0]!.shot.framing).toBe(DEFAULT_FRAMING)
    expect(p.episodes[0]!.pages[0]!.panels[0]!.shot.angle).toBe(DEFAULT_ANGLE)
  })

  it('只补不删：未知字段忽略，已知内容保留', () => {
    const p = normalizeComicProject({
      id: 'p1',
      unknownTop: 'x',
      readingDirection: 'rtl',
      characters: [{ id: 'c1', name: '阿花', description: '双马尾', referenceHashes: ['h1'], junk: 1 }],
      episodes: [
        {
          id: 'ep1',
          index: 0,
          title: '序章',
          pages: [
            {
              id: 'pg1',
              index: 0,
              layout: [{ kind: 'panel', panelId: 'a' }],
              panels: [
                {
                  id: 'a',
                  scene: '雨夜',
                  shot: { framing: 'wide', angle: 'low', transition: 'scene-to-scene' },
                  characterIds: ['c1'],
                  assetHash: 'hh',
                  balloons: [
                    { id: 'b1', type: 'speech', text: '你好', speakerId: 'c1', x: 0.1, y: 0.2, w: 0.3, h: 0.1, tail: { x: 0.15, y: 0.3 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(p.readingDirection).toBe('rtl')
    expect(p.characters[0]).toMatchObject({ id: 'c1', name: '阿花', description: '双马尾', referenceHashes: ['h1'] })
    const panel = p.episodes[0]!.pages[0]!.panels[0]!
    expect(panel.scene).toBe('雨夜')
    expect(panel.shot).toEqual({ framing: 'wide', angle: 'low', transition: 'scene-to-scene' })
    expect(panel.assetHash).toBe('hh')
    expect(panel.balloons[0]).toMatchObject({ id: 'b1', type: 'speech', speakerId: 'c1' })
  })

  it('缺少 id 的格 / 角色被丢弃（无法定位的实体不留）', () => {
    const p = normalizeComicProject({
      id: 'p1',
      characters: [{ name: '无 id' }, { id: 'c2', name: '有 id' }],
      episodes: [
        {
          id: 'ep1',
          pages: [{ id: 'pg1', layout: [{ kind: 'panel' }, { kind: 'panel', panelId: 'ok' }], panels: [{ scene: '无 id' }] }],
        },
      ],
    })
    expect(p.characters).toHaveLength(1)
    expect(p.characters[0]!.id).toBe('c2')
    expect(p.episodes[0]!.pages[0]!.panels).toEqual([])
    // 只留下有效叶子
    expect(p.episodes[0]!.pages[0]!.layout).toEqual([{ kind: 'panel', panelId: 'ok' }])
  })

  it('切割节点递归归一，count 至少为 2，缺省方向 v / 位置 equal', () => {
    const p = normalizeComicProject({
      id: 'p1',
      episodes: [
        {
          id: 'ep1',
          pages: [
            {
              id: 'pg1',
              layout: [
                { kind: 'cut', count: 1, children: [{ kind: 'panel', panelId: 'a' }, { kind: 'panel', panelId: 'b' }] },
              ],
            },
          ],
        },
      ],
    })
    const node = p.episodes[0]!.pages[0]!.layout[0]!
    expect(node.kind).toBe('cut')
    if (node.kind === 'cut') {
      expect(node.direction).toBe('v')
      expect(node.position).toBe('equal')
      expect(node.count).toBe(2)
      expect(node.children).toHaveLength(2)
    }
  })

  it('对白缺失坐标回退 0；可选字段缺省则不写入（不给假默认值）', () => {
    const p = normalizeComicProject({
      id: 'p1',
      episodes: [{ id: 'ep1', pages: [{ id: 'pg1', panels: [{ id: 'a', balloons: [{ id: 'b1' }] }] }] }],
    })
    const b = p.episodes[0]!.pages[0]!.panels[0]!.balloons[0]!
    expect(b).toMatchObject({ type: 'speech', text: '', x: 0, y: 0, w: 0, h: 0 })
    expect(b.speakerId).toBeUndefined()
    expect(b.tail).toBeUndefined()
  })

  it('幂等：归一化两次结果一致', () => {
    const raw = {
      id: 'p1',
      title: 'T',
      readingDirection: 'rtl',
      characters: [{ id: 'c1', name: 'A' }],
      episodes: [{ id: 'ep1', pages: [{ id: 'pg1', layout: [{ kind: 'panel', panelId: 'a' }], panels: [{ id: 'a' }] }] }],
    }
    const once = normalizeComicProject(raw)
    const twice = normalizeComicProject(once)
    expect(twice).toEqual(once)
  })
})

describe('comicProject / 参考图列表（M6-13）', () => {
  it('追加：新 hash 追加到末尾', () => {
    expect(addCharacterReference(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('追加：已存在则**返回原数组引用**（让「无变化」可被上层识别、避免空写库）', () => {
    const hashes = ['a', 'b']
    expect(addCharacterReference(hashes, 'a')).toBe(hashes)
  })

  it('追加：不改原数组（不可变）', () => {
    const hashes = ['a']
    const next = addCharacterReference(hashes, 'b')
    expect(hashes).toEqual(['a'])
    expect(next).not.toBe(hashes)
  })

  it('移除：只删命中的那一个，其余保序', () => {
    expect(removeCharacterReference(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('移除：不存在则**返回原数组引用**', () => {
    const hashes = ['a']
    expect(removeCharacterReference(hashes, 'zz')).toBe(hashes)
  })

  it('移除：不改原数组（不可变）', () => {
    const hashes = ['a', 'b']
    removeCharacterReference(hashes, 'a')
    expect(hashes).toEqual(['a', 'b'])
  })

  it('去重口径是内容哈希：同图（同 hash）加两次仍只有一项', () => {
    const hashes = addCharacterReference([], 'h1')
    expect(addCharacterReference(hashes, 'h1')).toEqual(['h1'])
  })
})
