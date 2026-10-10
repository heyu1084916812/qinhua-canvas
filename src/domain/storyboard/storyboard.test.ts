import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHOT_SECONDS,
  addEpisode,
  addShot,
  emptyStoryboard,
  exportStoryboardMarkdown,
  moveEpisode,
  moveShot,
  parseStoryboard,
  removeEpisode,
  removeShot,
  shotPrompt,
  shotsOf,
  storyboardStats,
  updateEpisode,
  updateScript,
  updateShot,
  type StoryboardDoc,
} from './storyboard'

/**
 * 漫剧工作台第一阶段（对账 #382）：剧本 → 分集 → 分镜。
 *
 * 这一层全是**纯函数**，所以这里守的都是"改一条会影响到谁"：
 * 删集要不要连镜头一起删、新增的镜头插在哪儿、时长怎么夹、
 * 导出表遇到竖线 / 换行会不会把表格撑坏 —— 这些错了在界面上都很难看出来。
 */

/** 造一份"两集三镜"的底稿（第一集两镜、第二集一镜） */
function sample(): StoryboardDoc {
  let doc = emptyStoryboard('p1', 1)
  doc = addEpisode(doc, 2)
  doc = addEpisode(doc, 3)
  const [ep1, ep2] = doc.episodes
  doc = addShot(doc, ep1!.id, 4)
  doc = addShot(doc, ep1!.id, 5)
  doc = addShot(doc, ep2!.id, 6)
  doc = updateShot(doc, shotsOf(doc, ep1!.id)[0]!.id, { scene: '客厅，清晨' }, 7)
  return doc
}

describe('storyboard · 文档读写', () => {
  it('空文档：一集没有、镜头没有，标题给个能改的默认', () => {
    const doc = emptyStoryboard('p1', 10)
    expect(doc.projectId).toBe('p1')
    expect(doc.script.title).toBe('未命名漫剧')
    expect(doc.episodes).toEqual([])
    expect(doc.shots).toEqual([])
    expect(doc.updatedAt).toBe(10)
  })

  it('★★ 脏数据只补坏的那一项，并且丢掉"孤儿镜头"（指向不存在的集）', () => {
    const doc = parseStoryboard(
      {
        script: { title: 42, logline: '一句话', body: '正文' },
        episodes: [{ id: 'e1', title: '', summary: null }, { id: '', title: '没 id' }, 'garbage'],
        shots: [
          { id: 's1', episodeId: 'e1', scene: '画面', durationSec: 'abc' },
          { id: 's2', episodeId: '不存在', scene: '孤儿' },
          { id: 's3', episodeId: 'e1' },
        ],
        updatedAt: 'nope',
      },
      'p9',
    )
    expect(doc.projectId).toBe('p9')
    expect(doc.script.title).toBe('未命名漫剧') // 42 不是字符串 ⇒ 回落默认
    expect(doc.script.logline).toBe('一句话')
    expect(doc.episodes).toHaveLength(1)
    expect(doc.episodes[0]!.title).toBe('未命名一集') // 空标题补默认
    expect(doc.shots.map((s) => s.id)).toEqual(['s1', 's3']) // 孤儿 s2 被丢掉
    expect(doc.shots[0]!.durationSec).toBe(DEFAULT_SHOT_SECONDS) // 脏数字回落默认
    expect(doc.updatedAt).toBe(0)
  })

  it('剧本三件（标题 / 一句话 / 正文）都能改，且只改传进来的那些', () => {
    let doc = emptyStoryboard('p1')
    doc = updateScript(doc, { title: '小猫钓鱼', logline: '一只猫想钓到月亮' }, 5)
    expect(doc.script.title).toBe('小猫钓鱼')
    expect(doc.script.logline).toBe('一只猫想钓到月亮')
    expect(doc.script.body).toBe('')
    expect(doc.updatedAt).toBe(5)
  })
})

describe('storyboard · 分集', () => {
  it('新增一集：默认叫「第 N 集」，顺序即数组顺序', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    doc = addEpisode(doc, 2)
    expect(doc.episodes.map((e) => e.title)).toEqual(['第 1 集', '第 2 集'])
  })

  it('改一集：只动那一集，别的原样', () => {
    const doc0 = sample()
    const doc = updateEpisode(doc0, doc0.episodes[0]!.id, { title: '起', summary: '开场' }, 9)
    expect(doc.episodes[0]!.title).toBe('起')
    expect(doc.episodes[1]!.title).toBe('第 2 集')
    expect(doc.updatedAt).toBe(9)
  })

  it('★★ 删一集要连它的镜头一起删（否则那些镜头变成界面上看不到的孤儿）', () => {
    const doc0 = sample()
    const ep1 = doc0.episodes[0]!.id
    const doc = removeEpisode(doc0, ep1, 10)
    expect(doc.episodes.map((e) => e.id)).toEqual([doc0.episodes[1]!.id])
    expect(doc.shots).toHaveLength(1) // 原本 3 镜，第一集的 2 镜随集删掉
    expect(doc.shots.every((s) => s.episodeId !== ep1)).toBe(true)
  })

  it('上下移一集：到边界就原样返回（不抛错、不改 updatedAt）', () => {
    const doc0 = sample()
    const first = doc0.episodes[0]!.id
    const second = doc0.episodes[1]!.id
    expect(moveEpisode(doc0, first, -1)).toBe(doc0)
    const moved = moveEpisode(doc0, second, -1, 11)
    expect(moved.episodes.map((e) => e.id)).toEqual([second, first])
    expect(moved.updatedAt).toBe(11)
    expect(moveEpisode(moved, first, 5)).toBe(moved)
  })
})

describe('storyboard · 分镜', () => {
  it('★★ 新增镜头插在"这一集最后一镜"之后（不是整个数组末尾 —— 跨集顺序会乱）', () => {
    const doc0 = sample()
    const ep1 = doc0.episodes[0]!.id
    const doc = addShot(doc0, ep1, 20)
    expect(doc.shots.map((s) => s.episodeId)).toEqual([
      ep1,
      ep1,
      ep1, // 新镜头插在这里
      doc0.episodes[1]!.id,
    ])
  })

  it('★ 往不存在的集加镜头：原样返回（不造孤儿）', () => {
    const doc = sample()
    expect(addShot(doc, '不存在')).toBe(doc)
  })

  it('★ 改镜头：时长夹在 ≥1 秒并取整（脏输入不至于把节奏算成 0 或小数）', () => {
    const doc0 = sample()
    const shot = doc0.shots[0]!
    expect(updateShot(doc0, shot.id, { durationSec: 0 }).shots[0]!.durationSec).toBe(1)
    expect(updateShot(doc0, shot.id, { durationSec: 4.6 }).shots[0]!.durationSec).toBe(5)
    expect(updateShot(doc0, shot.id, { durationSec: Number.NaN }).shots[0]!.durationSec).toBe(
      shot.durationSec,
    )
  })

  it('★★ 上下移镜头只在同一集内换位（跨集是另一件事，这里不偷偷搬）', () => {
    const doc0 = sample()
    const ep1 = doc0.episodes[0]!.id
    const [a, b] = shotsOf(doc0, ep1)
    const moved = moveShot(doc0, b!.id, -1, 21)
    expect(shotsOf(moved, ep1).map((s) => s.id)).toEqual([b!.id, a!.id])
    /** 第一镜再往上移：到边界 ⇒ 原样 */
    expect(moveShot(moved, b!.id, -1)).toBe(moved)
  })

  it('删镜头只删它自己', () => {
    const doc0 = sample()
    const doc = removeShot(doc0, doc0.shots[0]!.id, 22)
    expect(doc.shots).toHaveLength(2)
    expect(doc.updatedAt).toBe(22)
  })

  it('提示词留空时由画面描述派生（"画面描述即提示词"是最省事的默认）', () => {
    const doc0 = sample()
    const shot = shotsOf(doc0, doc0.episodes[0]!.id)[0]!
    expect(shotPrompt(shot)).toBe('客厅，清晨')
    const withPrompt = { ...shot, prompt: '动漫风格，暖光' }
    expect(shotPrompt(withPrompt)).toBe('动漫风格，暖光')
  })

  it('统计：集数 / 镜数 / 粗排总时长（按每镜时长累加）', () => {
    let doc = sample()
    const second = doc.shots[1]!
    doc = updateShot(doc, second.id, { durationSec: 7 }, 23)
    expect(storyboardStats(doc)).toEqual({ episodes: 2, shots: 3, durationSec: 3 + 7 + 3 })
  })
})

describe('storyboard · 导出分镜表（Markdown）', () => {
  it('★★ 导出：标题 / 一句话 / 统计 / 剧本 / 逐集逐镜的表都在', () => {
    let doc = sample()
    doc = updateScript(doc, { title: '小猫钓鱼', logline: '一只猫想钓到月亮', body: '第一场……' }, 30)
    doc = updateEpisode(doc, doc.episodes[0]!.id, { summary: '开场' }, 31)
    doc = updateShot(doc, doc.shots[0]!.id, { scene: '客厅，清晨', dialogue: '早啊', durationSec: 5 }, 32)

    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('# 小猫钓鱼')
    expect(md).toContain('> 一只猫想钓到月亮')
    expect(md).toContain('共 2 集 / 3 镜 / 粗排 11 秒')
    expect(md).toContain('## 剧本')
    expect(md).toContain('## 第 1 集 · 第 1 集')
    expect(md).toContain('> 开场')
    expect(md).toContain('| # | 画面 | 台词 / 旁白 | 时长 | 画面提示词 |')
    expect(md).toContain('| 1 | 客厅，清晨 | 早啊 | 5s | 客厅，清晨 |')
  })

  it('★ 单元格里的竖线与换行会把表格撑坏 ⇒ 导出前换掉（换行变空格、竖线转义）', () => {
    let doc = sample()
    doc = updateShot(
      doc,
      doc.shots[0]!.id,
      { scene: '客厅 | 厨房', dialogue: '第一行\n第二行' },
      33,
    )
    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('客厅 \\| 厨房')
    expect(md).toContain('| 第一行 第二行 |')
    expect(md).not.toContain('第一行\n第二行')
  })

  it('★ 没有分镜的集：表头不出现，改写成一句"还没有分镜"（导出照样能读）', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('（这一集还没有分镜）')
    expect(md).not.toContain('| # | 画面 |')
  })
})
