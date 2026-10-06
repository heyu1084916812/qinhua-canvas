import { describe, expect, it } from 'vitest'
import {
  buildHistory,
  countAssets,
  countHistory,
  dateLabelOf,
  filterHistory,
  groupHistory,
  modelCounts,
  type HistoryQuery,
} from './assetHistory'

/**
 * 「全部生成历史」（对账 #264）。用户 2026-10-06 第 8 条 + 同日答复：
 * **含未收藏**、也含**生成失败**；筛选维度 = 类型 / 模型 / 时间 / 是否收藏；
 * 参考图五里还有"日期分组"与"模型生成分组"两栏。
 */
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-06T12:00:00Z').getTime()

const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  nodeId: 'n1',
  projectId: 'p1',
  version: 1,
  createdAt: NOW - DAY,
  status: 'succeeded',
  inputs: [],
  params: { prompt: '一只钓鱼的猫', model: 'image-pro', ratio: '16:9', quality: 'high' },
  outputHashes: ['h1'],
  fingerprint: 'fp',
  taskId: 't1',
  durationMs: 1,
  ...over,
})

const asset = (hash: string, mime = 'image/png', over: Record<string, unknown> = {}) => ({
  id: hash,
  hash,
  mime,
  bytes: 1000,
  width: 1024,
  height: 576,
  ...over,
})

describe('buildHistory', () => {
  it('★★ 一条记录产出多张 ⇒ 展开成多条（用户看的是图，不是"一次任务"）', () => {
    const items = buildHistory({
      runs: [run({ outputHashes: ['a', 'b', 'c'] })],
      assets: [asset('a'), asset('b'), asset('c')],
      savedHashes: [],
      projects: [],
    })
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.kind === 'output')).toBe(true)
  })

  it('★★ 同一 hash 出现在多条记录里 ⇒ 只留**最新**那条（重试/重复保存不该列两遍）', () => {
    const items = buildHistory({
      runs: [
        run({ id: 'old', createdAt: NOW - 5 * DAY, outputHashes: ['a'] }),
        run({ id: 'new', createdAt: NOW - DAY, outputHashes: ['a'] }),
      ],
      assets: [asset('a')],
      savedHashes: [],
      projects: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.createdAt).toBe(NOW - DAY)
  })

  it('★★ 失败的记录也进历史（没有产物，但用户确实等过这一次）', () => {
    const items = buildHistory({
      runs: [run({ id: 'r-fail', status: 'failed', outputHashes: [] })],
      assets: [],
      savedHashes: [],
      projects: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'failed', id: 'r-fail' })
  })

  it('★ 记录在、素材字节没了 ⇒ 照样列出（带 0 字节），不悄悄跳过', () => {
    const items = buildHistory({
      runs: [run({ outputHashes: ['gone'] })],
      assets: [],
      savedHashes: [],
      projects: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'output', hash: 'gone', bytes: 0 })
  })

  it('★ 模型与像素的取值优先级：实际发出的 → 记录里请求的 → 素材行里的', () => {
    const items = buildHistory({
      runs: [
        run({ sentModel: 'upstream-1', outputWidth: undefined, outputHeight: undefined }),
        run({ id: 'r2', createdAt: NOW - 2 * DAY, outputHashes: ['h2'], sentModel: undefined, outputWidth: 512, outputHeight: 512 }),
      ],
      assets: [asset('h1', 'image/png', { width: 64, height: 36 }), asset('h2', 'image/png', { width: 64, height: 36 })],
      savedHashes: [],
      projects: [],
    })
    const byHash = new Map(items.map((i) => [i.kind === 'output' ? i.hash : i.id, i]))
    expect(byHash.get('h1')).toMatchObject({ model: 'upstream-1', width: 64, height: 36 })
    // 记录里有实际像素就用它（素材行可能只有缩略图尺寸）
    expect(byHash.get('h2')).toMatchObject({ model: 'image-pro', width: 512, height: 512 })
  })

  it('★ 收藏标记来自 assetLibrary，不改变条目本身', () => {
    const items = buildHistory({
      runs: [run({ outputHashes: ['saved-one', 'loose-one'] })],
      assets: [asset('saved-one'), asset('loose-one')],
      savedHashes: ['saved-one'],
      projects: [{ id: 'p1', name: '画布' }],
    })
    const saved = items.find((i) => i.kind === 'output' && i.hash === 'saved-one')
    const loose = items.find((i) => i.kind === 'output' && i.hash === 'loose-one')
    expect(saved).toMatchObject({ saved: true, projectName: '画布' })
    expect(loose).toMatchObject({ saved: false })
  })
})

describe('filterHistory', () => {
  const items = buildHistory({
    runs: [
      run({ id: 'r-img', outputHashes: ['img1'], createdAt: NOW - 2 * 60 * 60 * 1000 }),
      run({
        id: 'r-vid',
        outputHashes: ['vid1'],
        createdAt: NOW - 20 * DAY,
        params: { prompt: '奔跑的狗', model: 'video-x' },
      }),
      run({ id: 'r-fail', status: 'failed', outputHashes: [], createdAt: NOW - 60 * 1000 }),
    ],
    assets: [asset('img1'), asset('vid1', 'video/mp4')],
    savedHashes: ['img1'],
    projects: [{ id: 'p1', name: '画布' }],
  })
  const q = (over: Partial<HistoryQuery> = {}): HistoryQuery => ({
    query: '',
    kind: 'all',
    quick: 'all',
    model: null,
    now: NOW,
    ...over,
  })

  it('★★ 快捷筛选：收藏 / 最近 7 天 / 生成失败 各筛各的', () => {
    expect(filterHistory(items, q({ quick: 'saved' })).map((i) => i.kind === 'output' && i.hash)).toEqual(['img1'])
    expect(filterHistory(items, q({ quick: 'recent' }))).toHaveLength(2) // 图 + 失败（20 天前那个视频出局）
    expect(filterHistory(items, q({ quick: 'failed' })).map((i) => i.kind)).toEqual(['failed'])
  })

  it('★★ 按类型筛时**失败条目不出现在图/视频档**（它没有素材类型，混进来会让人以为筛坏了）', () => {
    const video = filterHistory(items, q({ kind: 'video' }))
    expect(video).toHaveLength(1)
    expect(video[0]).toMatchObject({ hash: 'vid1' })
    expect(filterHistory(items, q({ kind: 'image' }))).toHaveLength(1)
    expect(filterHistory(items, q({ kind: 'all' }))).toHaveLength(3)
  })

  it('★ 关键字能搜到提示词 / 模型 / 项目名（用户认得出来的那几类）', () => {
    expect(filterHistory(items, q({ query: '奔跑' }))).toHaveLength(1)
    // 失败那条也带着同一个模型名（它确实是用这个模型跑的），所以命中 2 条
    expect(filterHistory(items, q({ query: 'image-pro' }))).toHaveLength(2)
    // 三条都来自同一个项目（含失败那条），所以搜项目名命中 3 条
    expect(filterHistory(items, q({ query: '画布' }))).toHaveLength(3)
  })

  it('★ 模型分组点中一档 ⇒ 只留那一个模型', () => {
    expect(filterHistory(items, q({ model: 'video-x' }))).toHaveLength(1)
    expect(filterHistory(items, q({ model: '不存在的模型' }))).toHaveLength(0)
  })

  it('★ 四类条件**同时生效**（不是互相替换）', () => {
    expect(filterHistory(items, q({ quick: 'recent', kind: 'image', query: '钓鱼' }))).toHaveLength(1)
    expect(filterHistory(items, q({ quick: 'recent', kind: 'video' }))).toHaveLength(0)
  })
})

describe('countHistory / modelCounts', () => {
  const items = buildHistory({
    runs: [
      run({ id: 'r1', outputHashes: ['i1'] }),
      run({ id: 'r2', outputHashes: ['v1'], createdAt: NOW - 2 * DAY, params: { model: 'video-x' } }),
      run({ id: 'r3', outputHashes: [], status: 'failed', createdAt: NOW - 3 * DAY }),
      run({ id: 'r4', outputHashes: ['old'], createdAt: NOW - 30 * DAY, params: { model: 'video-x' } }),
    ],
    assets: [asset('i1'), asset('v1', 'video/mp4'), asset('old')],
    savedHashes: ['i1'],
    projects: [],
  })

  it('★ 计数是对**全量**算的（顶部那排数字与左侧快捷筛选同源）', () => {
    expect(countHistory(items, NOW)).toEqual({
      all: 4,
      image: 2,
      video: 1,
      audio: 0,
      saved: 1,
      recent: 3, // 今天/昨天/3 天前；30 天前那张不算
      failed: 1,
    })
  })

  it('★ 模型分组按张数从多到少（主力模型不该沉到底下）', () => {
    expect(modelCounts(items)).toEqual([
      { model: 'video-x', count: 2 },
      { model: 'image-pro', count: 1 },
    ])
  })

  /**
   * ★★ 整个库的全量（用户 2026-10-06 第 11 批第 5 条）：
   * 「生成历史没用收藏的算全部素材，**整个库的全量**」。
   *
   * 用户报的正是这一档：图里**素材库有 1 张、全部历史 0**，于是顶部与左侧的数字**全是 0**
   * —— 因为旧实现只统计生成历史（`runRecords`），素材库里"上传/导入保存进来的"那张
   * 根本没有生成记录、一张都没被算上。
   */
  describe('countAssets（生成历史 ∪ 素材库）', () => {
    it('★★ 库里有图但生成历史为空 ⇒ 数字**不是 0**（用户报的那一档）', () => {
      const lib = [{ hash: 'up-1', mime: 'image/png', savedAt: NOW - 60 * 60 * 1000 }]
      expect(countAssets([], lib, NOW)).toEqual({
        all: 1,
        image: 1,
        video: 0,
        audio: 0,
        saved: 1,
        recent: 1,
        failed: 0,
      })
    })

    it('★★ 同一张既在生成历史里、又在素材库里 ⇒ **只算一次**（按 hash 去重）', () => {
      const lib = [{ hash: 'i1', mime: 'image/png', savedAt: NOW - 60 * 60 * 1000 }]
      expect(countAssets(items, lib, NOW)).toEqual({
        /*
         * `all` **只数素材**（图/视频/音频三家之和 = all，口径自洽）；
         * 失败那一条进 `failed`，不再混进"全部" —— 参考图五里它本来就是独立一档
         * （左侧「生成失败 N」），旧实现把它算进"全部"才让 4 ≠ 2+1+0。
         */
        all: 3,
        image: 2,
        video: 1,
        audio: 0,
        saved: 1,
        recent: 2,
        failed: 1,
      })
    })

    it('★ 库与历史取**更晚**的时间决定"最近 7 天"（30 天前生成的今天被收藏 ⇒ 算最近）', () => {
      const lib = [{ hash: 'old', mime: 'image/png', savedAt: NOW - 60 * 60 * 1000 }]
      const union = countAssets(items, lib, NOW)
      expect(union.all).toBe(3)
      expect(union.recent).toBe(3) // 原来 2：30 天前那张被"今天收藏"拉进窗口
    })

    it('★ 素材库多张（含未在历史里的）⇒ saved 与 all 一起长', () => {
      const lib = [
        { hash: 'i1', mime: 'image/png', savedAt: NOW },
        { hash: 'up-1', mime: 'image/png', savedAt: NOW },
        { hash: 'up-2', mime: 'video/mp4', savedAt: NOW },
        { hash: 'i1', mime: 'image/png', savedAt: NOW }, // 重复行只算一次
      ]
      expect(countAssets(items, lib, NOW)).toMatchObject({
        all: 5,
        image: 3,
        video: 2,
        saved: 3,
      })
    })

    it('★ 失败记录仍然只来自生成历史（素材库没有这一档）', () => {
      expect(countAssets(items, [], NOW).failed).toBe(1)
      expect(countAssets([], [{ hash: 'up-1', mime: 'image/png' }], NOW).failed).toBe(0)
    })
  })
})

describe('dateLabelOf / groupHistory', () => {
  it('★ 日期标题：今天 / 昨天 / 具体日期（跨年才带年份）', () => {
    expect(dateLabelOf(NOW - 60 * 1000, NOW)).toBe('今天')
    expect(dateLabelOf(NOW - DAY, NOW)).toBe('昨天')
    expect(dateLabelOf(NOW - 3 * DAY, NOW)).toBe('10月3日')
    expect(dateLabelOf(new Date('2025-12-31T08:00:00Z').getTime(), NOW)).toBe('2025年12月31日')
  })

  it('★★ 日期分组按时间倒序（最新那组在最上面）', () => {
    const items = buildHistory({
      runs: [
        run({ id: 'a', outputHashes: ['a'], createdAt: NOW - 5 * DAY }),
        run({ id: 'b', outputHashes: ['b'], createdAt: NOW - 0.5 * DAY }),
        run({ id: 'c', outputHashes: ['c'], createdAt: NOW - 3 * DAY }),
      ],
      assets: [asset('a'), asset('b'), asset('c')],
      savedHashes: [],
      projects: [],
    })
    const groups = groupHistory(items, 'date', NOW)
    expect(groups.map((g) => g.label)).toEqual(['今天', '10月3日', '10月1日'])
  })

  it('★ 模型分组：没有模型的归「未知模型」而不是被丢掉', () => {
    const items = buildHistory({
      runs: [run({ id: 'a', outputHashes: ['a'], params: {} })],
      assets: [asset('a')],
      savedHashes: [],
      projects: [],
    })
    expect(groupHistory(items, 'model', NOW)).toEqual([
      { key: '未知模型', label: '未知模型', items: expect.any(Array) },
    ])
  })

  it('★ 不分组的模式返回单组（视图切换里"不分组"那一档）', () => {
    const items = buildHistory({
      runs: [run({ outputHashes: ['a'] })],
      assets: [asset('a')],
      savedHashes: [],
      projects: [],
    })
    expect(groupHistory(items, 'none', NOW)).toHaveLength(1)
    expect(groupHistory([], 'none', NOW)).toHaveLength(0)
  })
})
