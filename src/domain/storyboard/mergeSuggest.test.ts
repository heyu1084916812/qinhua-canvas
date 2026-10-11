import { describe, expect, it } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addScene,
  addShot,
  dismissMerge,
  emptyStoryboard,
  pairKey,
  parseStoryboard,
  toggleShotCharacter,
  updateCharacter,
  type StoryboardDoc,
} from './storyboard'
import {
  buildMergeText,
  isDismissed,
  parseMergeReply,
  withoutDismissed,
} from './mergeSuggest'

/**
 * 同义归并的查重建议（对账 #437）。
 *
 * 这一层的风险全在"模型说了算"上，所以每条断言都对着一个"绝不许发生"的情形：
 * 把不存在的 id 当候选、把两个不同类的东西凑一组、解析不过还照样改文档。
 */
describe('同义归并 · 候选解析', () => {
  /** 两个角色 + 一个场景，第 1 镜引用第一个角色 */
  const doc = (): StoryboardDoc => {
    let next = emptyStoryboard('p1', 0)
    next = addCharacter(next, 1)
    next = addCharacter(next, 1)
    next = addScene(next, 1)
    const [a, b] = next.characters
    next = updateCharacter(next, a!.id, { name: '林轩', description: '主角', aliases: ['阿轩'] }, 1)
    next = updateCharacter(next, b!.id, { name: '林公子' }, 1)
    next = addEpisode(next, 1)
    next = addShot(next, next.episodes[0]!.id, 1)
    next = toggleShotCharacter(next, next.shots[0]!.id, a!.id, 1)
    return next
  }

  it('★★ 清单里带上 id / 名字 / 别名 / 描述 / 出场镜数（缺一个模型就少一条线索）', () => {
    /* ⚠️ 同**一份**文档取文本与 id：`doc()` 每调一次就生成一批新 id（第一版就栽在这儿） */
    const d = doc()
    const text = buildMergeText(d)
    const [a] = d.characters
    expect(text).toContain(`id=${a!.id}`)
    expect(text).toContain('名字=林轩')
    expect(text).toContain('别名=阿轩')
    expect(text).toContain('描述=主角')
    expect(text).toContain('出场=1 镜')
  })

  it('★★★ 合法候选读得出来：一组两条，keep 是第一条、其余进 dropIds', () => {
    const d = doc()
    const [a, b] = d.characters
    const raw = JSON.stringify({
      groups: [{ kind: 'char', ids: [a!.id, b!.id], reason: '名字像是同一个人的两种叫法' }],
    })
    const parsed = parseMergeReply(raw, d)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.suggestions).toEqual([
      {
        kind: 'char',
        keepId: a!.id,
        dropIds: [b!.id],
        reason: '名字像是同一个人的两种叫法',
      },
    ])
  })

  it('★★★ 三道校验：不存在的 id 丢掉、**跨类凑组**丢掉、去重后不足两条丢掉', () => {
    const d = doc()
    const [a, b] = d.characters
    const sceneId = d.scenes[0]!.id
    const raw = JSON.stringify({
      groups: [
        { kind: 'char', ids: [a!.id, '不存在的人'], reason: '半真半假' },
        { kind: 'char', ids: [a!.id, sceneId], reason: '把场景塞进角色组' },
        { kind: 'char', ids: [b!.id, b!.id], reason: '自己跟自己' },
        { kind: 'char', ids: [a!.id, b!.id], reason: '这一组才是好的' },
      ],
    })
    const parsed = parseMergeReply(raw, d)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.suggestions).toHaveLength(1)
    expect(parsed.suggestions[0]!.reason).toBe('这一组才是好的')
  })

  it('★★ 一组可用的都没有 ⇒ 如实报错（不是"空候选"那种假成功）', () => {
    const d = doc()
    expect(parseMergeReply('我看这两条挺像的（不是 JSON）', d).ok).toBe(false)
    expect(parseMergeReply(JSON.stringify({ groups: [] }), d).ok).toBe(false)
  })
})

describe('同义归并 · 不是同一个', () => {
  const two = () => {
    let next = emptyStoryboard('p1', 0)
    next = addCharacter(next, 1)
    next = addCharacter(next, 1)
    return next
  }

  it('★★★ 记下"不是同一个"：顺序无关、幂等；跨类或不存在的 id 不动文档', () => {
    const d = two()
    const [a, b] = d.characters
    const once = dismissMerge(d, 'char', a!.id, b!.id, 9)
    expect(once.mergeDismissals).toEqual([pairKey(a!.id, b!.id)])
    /* 反过来写一遍是同一个键 ⇒ 原引用（别搅动防抖保存） */
    expect(dismissMerge(once, 'char', b!.id, a!.id, 9)).toBe(once)
    expect(dismissMerge(d, 'char', a!.id, a!.id, 9)).toBe(d)
    expect(dismissMerge(d, 'char', a!.id, '不存在', 9)).toBe(d)
    expect(dismissMerge(d, 'scene', a!.id, b!.id, 9)).toBe(d)
  })

  it('★★★ 否掉一对之后，**含它的那一组不再提**（同一组里只要有一对被否就不提）', () => {
    const d = two()
    const [a, b] = d.characters
    const suggestion = { kind: 'char' as const, keepId: a!.id, dropIds: [b!.id], reason: '' }
    expect(withoutDismissed(d, [suggestion])).toHaveLength(1)
    const dismissed = dismissMerge(d, 'char', a!.id, b!.id, 9)
    expect(withoutDismissed(dismissed, [suggestion])).toHaveLength(0)
    expect(isDismissed(dismissed, b!.id, a!.id)).toBe(true)
  })

  it('★★ 读回：两支都还在的键留着；有一支被删掉的键**自动丢掉**', () => {
    const d = two()
    const [a, b] = d.characters
    const withKey = dismissMerge(d, 'char', a!.id, b!.id, 9)
    const again = parseStoryboard(withKey, 'p1')
    expect(again.mergeDismissals).toEqual([pairKey(a!.id, b!.id)])
    /* 把 b 从库里去掉再读一遍：那个键就没有意义了 */
    const onlyA = { ...withKey, characters: [a!] }
    expect(parseStoryboard(onlyA, 'p1').mergeDismissals).toBeUndefined()
  })
})
