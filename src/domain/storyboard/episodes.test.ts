import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EPISODE_CHARS,
  MAX_EPISODES,
  SPLIT_BATCH_SIZE,
  SPLIT_MARKER,
  applySplit,
  buildSplitSystem,
  buildSplitText,
  episodeSourceText,
  parseSplitReply,
  planSplitBatches,
  splitSource,
} from './episodes'
import { addEpisode, addShot, emptyStoryboard, shotsOf, updateSourceText } from './storyboard'

/**
 * 小说 → 拆集（对账 #417；调研稿 §3.1）。
 *
 * 这一层守的是**切分点**：它错了，后面每一集的原文范围都跟着错，
 * 而"范围错了"在界面上很难看出来（标题看着都对）。
 */

const NOVEL = [
  '第一章 雨夜',
  '雨下了整晚。骑手把最后一单塞进保温箱，冲进雨里。',
  '',
  '第二章 十五楼',
  '电梯停在十五楼。门缝里透出暖光，却没人应门。',
  '',
  '第三章 收尾',
  '第二天清早，收货人终于回了消息：昨晚睡着了。',
].join('\n')

describe('splitSource（章节标记 → 字数兜底）', () => {
  it('★★ 有章节标记：一章一段，标题取标记行，范围是原文偏移', () => {
    const chunks = splitSource(NOVEL)
    expect(chunks.map((c) => c.title)).toEqual(['第一章 雨夜', '第二章 十五楼', '第三章 收尾'])
    for (const c of chunks) {
      expect(c.to).toBeGreaterThan(c.from)
      /* 范围取出来必须真的是原文那一段（首字是标题） */
      expect(NOVEL.slice(c.from, c.to).trimStart().startsWith(c.title)).toBe(true)
    }
    expect(chunks[0]!.from).toBe(0)
    expect(chunks[chunks.length - 1]!.to).toBe(NOVEL.length)
  })

  it('第一个标题前面够长 ⇒ 单列「开篇」；只有一两行 ⇒ 并进第一集', () => {
    const long = `这是一段很长的设定说明，交代了世界、时代与主角的处境，按规矩它值得单独成为开篇。${'补充。'.repeat(20)}\n${NOVEL}`
    const withPreamble = splitSource(long)
    expect(withPreamble[0]!.title).toBe('开篇')
    expect(withPreamble).toHaveLength(4)

    const short = `作者的话\n${NOVEL}`
    const merged = splitSource(short)
    expect(merged).toHaveLength(3)
    expect(merged[0]!.from).toBe(0)
    expect(merged[0]!.title).toBe('第一章 雨夜')
  })

  it('★★ 无标记时按字数兜底：切满目标长度就另起一集（范围连续、覆盖全文）', () => {
    const body = '雨一直下。'.repeat(640) // 3200 字
    const chunks = splitSource(body, { targetChars: DEFAULT_EPISODE_CHARS })
    expect(chunks.length).toBe(3)
    expect(chunks[0]!.from).toBe(0)
    expect(chunks[chunks.length - 1]!.to).toBe(body.length)
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.from).toBe(chunks[i - 1]!.to)
    }
    expect(chunks[0]!.title).toBe('第 1 集')
  })

  it('没有换行的长段落也切得开，而且切在句末标点上（不把句子劈两半）', () => {
    const body = '甲说这是一句很长的话。'.repeat(200)
    const chunks = splitSource(body, { targetChars: 500 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(body.slice(0, chunks[0]!.to).endsWith('。')).toBe(true)
  })

  it('空文本 / 全是空白 ⇒ 不切（不产生空集）', () => {
    expect(splitSource('')).toEqual([])
    expect(splitSource('   \n\n  ')).toEqual([])
  })

  it('★ 上限：再长的小说也不超过 MAX_EPISODES 集，最后一段一定到全文结尾', () => {
    const huge = '句。'.repeat(22_500) // 45000 字，按 200 字切会得到 225 段
    const chunks = splitSource(huge, { targetChars: 200 })
    expect(chunks).toHaveLength(MAX_EPISODES)
    expect(chunks[chunks.length - 1]!.to).toBe(huge.length)
  })
})

describe('planSplitBatches（第三层：分批防超时）', () => {
  it('★ 每批最多 5 段，多的往下批；最后一批可以不满', () => {
    const chunks = splitSource('句。'.repeat(3000), { targetChars: 200 })
    const batches = planSplitBatches(chunks)
    expect(chunks.length).toBeGreaterThan(SPLIT_BATCH_SIZE)
    expect(batches[0]).toHaveLength(SPLIT_BATCH_SIZE)
    expect(batches.flat()).toHaveLength(chunks.length)
    expect(batches.every((b) => b.length <= SPLIT_BATCH_SIZE)).toBe(true)
  })

  it('11 段 → 5 / 5 / 1；传入非法批大小按 1 处理（不出现空批）', () => {
    const chunks = splitSource(NOVEL)
    expect(planSplitBatches(chunks, 1).map((b) => b.length)).toEqual([1, 1, 1])
    expect(planSplitBatches(chunks, 0).map((b) => b.length)).toEqual([1, 1, 1])
    expect(planSplitBatches([], 5)).toEqual([])
  })
})

describe('buildSplitSystem / buildSplitText', () => {
  it('系统指令带标记与「条数必须一致」这条契约', () => {
    const system = buildSplitSystem()
    expect(system).toContain(SPLIT_MARKER)
    expect(system).toContain('条数与顺序必须')
    expect(system).toContain('hookOpen')
  })

  it('用户消息按段编号，且写明这是第几批 / 一共几批', () => {
    const chunks = splitSource(NOVEL)
    const text = buildSplitText(chunks.slice(0, 2), 1, 3)
    expect(text).toContain('第 2/3 批')
    expect(text).toContain('【第 1 段】')
    expect(text).toContain('【第 2 段】')
    expect(text).not.toContain('【第 3 段】')
  })
})

describe('parseSplitReply / applySplit', () => {
  it('★★ 条数对不上就整批回落（硬对会让标题从某一集开始整体错位）', () => {
    expect(parseSplitReply('{"episodes":[{"title":"一"}]}', 2)).toBeNull()
    expect(parseSplitReply('{"episodes":[{"title":"一"},{"title":"二"}]}', 2)?.map((e) => e.title)).toEqual([
      '一',
      '二',
    ])
  })

  it('不是 JSON / 整批全空 ⇒ null（宁可回落，也不写一份空富化）', () => {
    expect(parseSplitReply('好的，我拆好了', 1)).toBeNull()
    expect(parseSplitReply('{"episodes":[{"title":"","summary":""}]}', 1)).toBeNull()
  })

  it('字段缺失当空串、首尾空白清掉', () => {
    const parsed = parseSplitReply('{"episodes":[{"title":" 雨夜 ","summary":" 梗概 "}]}', 1)
    expect(parsed?.[0]).toEqual({ title: '雨夜', summary: '梗概', hookOpen: '', hookEnd: '' })
  })

  it('★★ 落库：集名 / 梗概 / 钩子 / 原文范围都写进文档；**镜头被清空**（集换了，旧镜头没归属）', () => {
    let doc = emptyStoryboard('p1', 1)
    doc = updateSourceText(doc, NOVEL, 1)
    doc = addEpisode(doc, 1)
    doc = addShot(doc, doc.episodes[0]!.id, 1)
    expect(shotsOf(doc, doc.episodes[0]!.id)).toHaveLength(1)
    const chunks = splitSource(doc.sourceText)
    const next = applySplit(
      doc,
      chunks,
      [
        { title: '模型给的第一集', summary: '梗概一', hookOpen: '开场一', hookEnd: '结尾一' },
        { title: '', summary: '', hookOpen: '', hookEnd: '' },
        { title: '模型给的第三集', summary: '', hookOpen: '', hookEnd: '' },
      ],
      9,
    )
    expect(next.episodes).toHaveLength(3)
    expect(next.episodes[0]!.title).toBe('模型给的第一集')
    expect(next.episodes[0]!.hookOpen).toBe('开场一')
    /* 模型没给标题的那一集回落结构标题 */
    expect(next.episodes[1]!.title).toBe('第二章 十五楼')
    expect('hookOpen' in next.episodes[1]!).toBe(false)
    expect(next.episodes[0]!.sourceRange).toEqual({ from: chunks[0]!.from, to: chunks[0]!.to })
    expect(next.shots).toHaveLength(0)
    expect(next.updatedAt).toBe(9)
  })

  it('没有富化（没配模型 / 模型没按契约来）也能落库，只是标题用结构值', () => {
    const doc = updateSourceText(emptyStoryboard('p1'), NOVEL, 1)
    const next = applySplit(doc, splitSource(doc.sourceText), null, 2)
    expect(next.episodes.map((e) => e.title)).toEqual(['第一章 雨夜', '第二章 十五楼', '第三章 收尾'])
    expect(next.episodes.every((e) => e.summary === '')).toBe(true)
  })
})

describe('episodeSourceText（拆镜优先喂这一集的原文）', () => {
  it('★ 有范围就切那一段；没范围 / 越界 ⇒ 空串（回落剧本正文）', () => {
    const doc = updateSourceText(emptyStoryboard('p1'), NOVEL, 1)
    const chunks = splitSource(doc.sourceText)
    const episode = { id: 'ep1', title: '一', summary: '', sourceRange: { from: chunks[0]!.from, to: chunks[0]!.to } }
    expect(episodeSourceText(doc, episode)).toContain('雨下了整晚')
    expect(episodeSourceText(doc, { id: 'ep2', title: '二', summary: '' })).toBe('')
    expect(
      episodeSourceText(doc, { id: 'ep3', title: '三', summary: '', sourceRange: { from: 9999, to: 10000 } }),
    ).toBe('')
  })
})
