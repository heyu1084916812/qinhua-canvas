import { describe, it, expect } from 'vitest'
import { newComicPanel, type ComicPanel } from '../model/comicProject'
import type { RunRecord } from '../../shared/execution/runRecord'
import type { NodeInput } from '../../shared/execution/types'
import {
  appendPanelRun,
  canRestorePanelRun,
  livePanelRun,
  nextPanelRunVersion,
  panelRunFromRecord,
  restorePanelRun,
  type PanelRunInput,
} from './panelRunRecord'

/** 留痕载荷夹具（不含 version——它由 appendPanelRun 从历史推出） */
function run(over: Partial<PanelRunInput> = {}): PanelRunInput {
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

function panel(over: Partial<ComicPanel> = {}): ComicPanel {
  return { ...newComicPanel(), ...over }
}

/** 造一段已落库的历史：**走 appendPanelRun** 而非手写字面量，版本号由被测逻辑给 */
function withRuns(...inputs: PanelRunInput[]): ComicPanel {
  return inputs.reduce((p, i) => appendPanelRun(p, i), panel())
}

const START = { newRunId: 'r-restored', createdAt: 5000 }

describe('nextPanelRunVersion / 版本号由历史自身推出', () => {
  it('空历史从 1 起', () => {
    expect(nextPanelRunVersion([])).toBe(1)
  })

  it('取最大版本 + 1', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b' }))
    expect(nextPanelRunVersion(p.runs)).toBe(3)
  })

  it('乱序 / 跳号也只看最大值（不依赖数组顺序）', () => {
    const runs = withRuns(run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c' })).runs
    const shuffled = [runs[2]!, runs[0]!, runs[1]!]
    expect(nextPanelRunVersion(shuffled)).toBe(4)
  })
})

describe('appendPanelRun / 追加留痕', () => {
  it('按序给版本号 1 / 2 / 3', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c' }))
    expect(p.runs.map((r) => r.version)).toEqual([1, 2, 3])
  })

  it('不改原格（不可变）', () => {
    const p0 = panel()
    const p1 = appendPanelRun(p0, run())
    expect(p0.runs).toHaveLength(0)
    expect(p1).not.toBe(p0)
    expect(p1.runs).toHaveLength(1)
  })

  it('同 id 重复追加 → 返回原引用（幂等，不出孪生版本）', () => {
    const p1 = withRuns(run({ id: 'dup' }))
    const p2 = appendPanelRun(p1, run({ id: 'dup' }))
    expect(p2).toBe(p1)
    expect(p2.runs).toHaveLength(1)
  })

  it('保留记录里的其余字段（产物 / 参考图 / 指纹 / 耗时）', () => {
    const p = withRuns(run({ outputHashes: ['h1', 'h2'], referenceHashes: ['x'], durationMs: 999 }))
    expect(p.runs[0]).toMatchObject({
      outputHashes: ['h1', 'h2'],
      referenceHashes: ['x'],
      durationMs: 999,
      fingerprint: 'fp1',
    })
  })
})

describe('canRestorePanelRun / 谁可以回退', () => {
  it('成功且有产物 → 可回退', () => {
    expect(canRestorePanelRun({ ...run(), version: 1 })).toBe(true)
  })

  it('失败 / 取消 → 不可回退（那次没有画面）', () => {
    expect(canRestorePanelRun({ ...run({ status: 'failed' }), version: 1 })).toBe(false)
    expect(canRestorePanelRun({ ...run({ status: 'canceled' }), version: 1 })).toBe(false)
  })

  it('成功但产物为空（渠道没回图）→ 不可回退', () => {
    expect(canRestorePanelRun({ ...run({ outputHashes: [] }), version: 1 })).toBe(false)
  })
})

describe('livePanelRun / 当前生效的版本', () => {
  it('空历史 → null', () => {
    expect(livePanelRun([])).toBeNull()
  })

  it('取版本最大的成功版本', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b' }))
    expect(livePanelRun(p.runs)?.id).toBe('b')
  })

  it('末次失败不算当前（画面还停在上一版）', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b', status: 'failed', outputHashes: [] }))
    expect(livePanelRun(p.runs)?.id).toBe('a')
  })

  it('成功但无产物也不算当前', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b', outputHashes: [] }))
    expect(livePanelRun(p.runs)?.id).toBe('a')
  })
})

describe('restorePanelRun / 回退到某一版', () => {
  const base = panel({
    scene: '改过的画面描述',
    shot: { framing: 'close-up', angle: 'low', transition: 'action-to-action' },
    characterIds: ['ch9'],
    channelId: 'ch-other',
    model: 'other-model',
    balloons: [
      { id: 'b1', type: 'speech', text: '台词', x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
    ],
  })

  /** 「画面已被改过、但历史还在」的面板：`base` 提供当前状态，`p` 提供历史。
   *  注意顺序——`{ ...p, ...base }` 会让 base 的空 `runs` 覆盖掉历史，是错的。 */
  const drifted = (p: ComicPanel): ComicPanel => ({ ...base, runs: p.runs })

  it('写回画面输入与产物', () => {
    const p = withRuns(run({ id: 'a', outputHashes: ['h-old'], scene: '原始描述', framing: 'wide', angle: 'high', characterIds: ['ch1'], channelId: 'ch-a', model: 'm-a' }))
    const src = p.runs[0]!
    const next = restorePanelRun(drifted(p), src.id, START)
    expect(next.scene).toBe('原始描述')
    expect(next.shot.framing).toBe('wide')
    expect(next.shot.angle).toBe('high')
    expect(next.characterIds).toEqual(['ch1'])
    expect(next.channelId).toBe('ch-a')
    expect(next.model).toBe('m-a')
    expect(next.assetHash).toBe('h-old')
  })

  it('对白贴纸不动（回退画面不该动对白）', () => {
    const p = withRuns(run({ id: 'a' }))
    const next = restorePanelRun(drifted(p), 'a', START)
    expect(next.balloons).toBe(base.balloons)
  })

  it('转场不在快照里 → 保留面板当前的转场（叙事关系不随画面回退）', () => {
    const p = withRuns(run({ id: 'a' }))
    const next = restorePanelRun(drifted(p), 'a', START)
    expect(next.shot.transition).toBe('action-to-action')
  })

  it('回退本身追加为新版本：历史只增不减、版本号顺延、耗时记为 0', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b' }))
    const next = restorePanelRun(p, 'a', START)
    expect(next.runs).toHaveLength(3)
    expect(next.runs.map((r) => r.version)).toEqual([1, 2, 3])
    const last = next.runs[2]!
    expect(last.id).toBe('r-restored')
    expect(last.createdAt).toBe(5000)
    expect(last.durationMs).toBe(0)
    // 源版本仍在历史里（不是「把指针拨回去」）
    expect(next.runs.map((r) => r.id)).toEqual(['a', 'b', 'r-restored'])
  })

  it('回退后 livePanelRun 指向这条新版本', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b', outputHashes: ['h-b'] }))
    const next = restorePanelRun(p, 'a', START)
    expect(livePanelRun(next.runs)?.id).toBe('r-restored')
  })

  it('不改原格（不可变）', () => {
    const p = withRuns(run({ id: 'a' }))
    const next = restorePanelRun(p, 'a', START)
    expect(p.runs).toHaveLength(1)
    expect(p.assetHash).toBeUndefined()
    expect(next).not.toBe(p)
  })

  it('源版本不存在 → 返回原引用（不改、不留痕）', () => {
    const p = withRuns(run({ id: 'a' }))
    expect(restorePanelRun(p, 'ghost', START)).toBe(p)
  })

  it('源版本失败 / 无产物 → 返回原引用', () => {
    const p = withRuns(run({ id: 'a', status: 'failed', outputHashes: [] }))
    expect(restorePanelRun(p, 'a', START)).toBe(p)
  })

  it('从中间版本回退：后面的版本都还在', () => {
    const p = withRuns(run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c' }))
    const next = restorePanelRun(p, 'b', START)
    expect(next.runs.map((r) => r.id)).toEqual(['a', 'b', 'c', 'r-restored'])
  })
})

describe('panelRunFromRecord / 引擎记录 → 留痕载荷', () => {
  function record(over: Partial<RunRecord> = {}): RunRecord {
    return {
      id: 'rec1',
      nodeId: 'panel1',
      projectId: 'p1',
      version: 1,
      createdAt: 1000,
      status: 'succeeded',
      inputs: [],
      params: { scene: '雨夜', framing: 'wide', angle: 'low', characterIds: ['ch1'], channelId: 'ch', model: 'mm' },
      outputHashes: ['h1'],
      fingerprint: 'fp1',
      taskId: 't1',
      durationMs: 120,
      ...over,
    }
  }

  it('id 沿用引擎的记录 id（可对表 + 天然幂等）', () => {
    expect(panelRunFromRecord(record()).id).toBe('rec1')
  })

  it('状态 / 时间 / 产物 / 指纹原样带过', () => {
    const r = panelRunFromRecord(record({ status: 'failed', outputHashes: [], createdAt: 7 }))
    expect(r.status).toBe('failed')
    expect(r.outputHashes).toEqual([])
    expect(r.createdAt).toBe(7)
    expect(r.fingerprint).toBe('fp1')
  })

  it('params 平铺成留痕字段', () => {
    const r = panelRunFromRecord(record())
    expect(r.scene).toBe('雨夜')
    expect(r.framing).toBe('wide')
    expect(r.angle).toBe('low')
    expect(r.characterIds).toEqual(['ch1'])
    expect(r.channelId).toBe('ch')
    expect(r.model).toBe('mm')
  })

  it('params 缺失 / 垃圾 → 逐字段回落，不抛', () => {
    const r = panelRunFromRecord(record({ params: undefined }))
    expect(r.scene).toBe('')
    expect(r.framing).toBe('medium')
    expect(r.angle).toBe('eye-level')
    expect(r.characterIds).toEqual([])
    expect(r.channelId).toBe('')
    expect(r.model).toBe('')

    const bad = panelRunFromRecord(record({ params: { framing: 'zoom', angle: 3, characterIds: ['ok', 7] } }))
    expect(bad.framing).toBe('medium')
    expect(bad.angle).toBe('eye-level')
    expect(bad.characterIds).toEqual(['ok'])
  })

  it('参考图取渠道同款口径：只留图像、按 hash 去重、最多 4 张', () => {
    const asset = (hash: string, mime = 'image/png'): NodeInput => ({ kind: 'asset', nodeId: 'c', assetHash: hash, mime })
    const r = panelRunFromRecord(
      record({
        inputs: [
          asset('a1'),
          { kind: 'text', nodeId: 'n1', text: '文本输入不算参考图' },
          asset('a1', 'image/jpeg'), // 同 hash 去重
          asset('v1', 'video/mp4'), // 非图像丢弃
          asset('a2'),
          asset('a3'),
          asset('a4'),
          asset('a5'), // 超上限丢弃
        ],
      }),
    )
    expect(r.referenceHashes).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('集合卡摊平后再取图（未经展开直接调用渠道的路径也兜住）', () => {
    const r = panelRunFromRecord(
      record({
        inputs: [
          {
            kind: 'collection',
            nodeId: 'batch',
            items: [
              { kind: 'asset', nodeId: 'c1', assetHash: 'a1', mime: 'image/png' },
              { kind: 'asset', nodeId: 'c2', assetHash: 'a2', mime: 'image/png' },
            ],
          },
        ],
      }),
    )
    expect(r.referenceHashes).toEqual(['a1', 'a2'])
  })

  it('无输入 → 参考图为空', () => {
    expect(panelRunFromRecord(record()).referenceHashes).toEqual([])
  })
})
