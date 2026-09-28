import { describe, it, expect } from 'vitest'
import {
  assetKindOf,
  byteLengthOf,
  filterLibraryAssets,
  formatAssetSize,
  formatBytes,
  masonryAspectOf,
  sortLibraryAssets,
  toLibraryAssets,
  type LibraryAsset,
} from './assetLibrary'

const asset = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  hash: 'h1',
  mime: 'image/png',
  bytes: 1024,
  width: 512,
  height: 512,
  createdAt: 1000,
  projectId: 'p1',
  ...over,
})

describe('assetKindOf', () => {
  it('图片 / 视频 / 其它三类，mime 缺失算其它', () => {
    expect(assetKindOf('image/png')).toBe('image')
    expect(assetKindOf('video/mp4')).toBe('video')
    expect(assetKindOf('application/pdf')).toBe('other')
    expect(assetKindOf(undefined)).toBe('other')
  })
})

describe('byteLengthOf', () => {
  it('三种落库形态都能量出长度（IndexedDB 会把 Uint8Array 还原成 ArrayBuffer）', () => {
    expect(byteLengthOf(new Uint8Array(10))).toBe(10)
    expect(byteLengthOf(new ArrayBuffer(7))).toBe(7)
    expect(byteLengthOf([1, 2, 3])).toBe(3)
  })

  it('认不出来时是 0，不抛（界面显示「—」而不是崩）', () => {
    expect(byteLengthOf(undefined)).toBe(0)
    expect(byteLengthOf('abc')).toBe(0)
  })
})

describe('sortLibraryAssets', () => {
  it('新的在前', () => {
    const sorted = sortLibraryAssets([
      asset({ hash: 'old', createdAt: 1 }),
      asset({ hash: 'new', createdAt: 9 }),
    ])
    expect(sorted.map((a) => a.hash)).toEqual(['new', 'old'])
  })

  it('时间相同时按 hash 稳定排序（否则每次渲染顺序都在跳）', () => {
    const sorted = sortLibraryAssets([
      asset({ hash: 'b', createdAt: 5 }),
      asset({ hash: 'a', createdAt: 5 }),
    ])
    expect(sorted.map((a) => a.hash)).toEqual(['a', 'b'])
  })

  it('未知时间（0）排在最后，不冒充「很早以前」', () => {
    const sorted = sortLibraryAssets([
      asset({ hash: 'unknown', createdAt: 0 }),
      asset({ hash: 'known', createdAt: 1 }),
    ])
    expect(sorted.map((a) => a.hash)).toEqual(['known', 'unknown'])
  })

  it('不修改入参数组（界面可能拿它做别的派生）', () => {
    const input = [asset({ hash: 'b', createdAt: 5 }), asset({ hash: 'a', createdAt: 9 })]
    sortLibraryAssets(input)
    expect(input.map((a) => a.hash)).toEqual(['b', 'a'])
  })
})

describe('filterLibraryAssets', () => {
  const names = (id: string | null) => (id === 'p1' ? '猫咪项目' : '未命名项目')
  const pool = [
    asset({ hash: 'a', mime: 'image/png', projectId: 'p1' }),
    asset({ hash: 'v', mime: 'video/mp4', projectId: 'p1' }),
  ]

  it('类型筛选：只要图片时视频不出现', () => {
    const out = filterLibraryAssets(pool, '', 'image', names)
    expect(out.map((a) => a.hash)).toEqual(['a'])
  })

  it('关键字能命中项目名', () => {
    expect(filterLibraryAssets(pool, '猫咪', 'all', names).map((a) => a.hash)).toEqual(['a', 'v'])
  })

  it('关键字能命中 mime 与尺寸', () => {
    expect(filterLibraryAssets(pool, 'video', 'all', names).map((a) => a.hash)).toEqual(['v'])
    expect(filterLibraryAssets(pool, '512', 'all', names).map((a) => a.hash)).toEqual(['a', 'v'])
  })

  it('空关键字返回全部（不把「没输入」当成「什么都不匹配」）', () => {
    expect(filterLibraryAssets(pool, '   ', 'all', names)).toHaveLength(2)
  })
})

describe('toLibraryAssets', () => {
  it('新素材直接用自己的 createdAt 与 projectId', () => {
    const out = toLibraryAssets([
      { hash: 'h1', mime: 'image/png', bytes: new Uint8Array(4), createdAt: 123, projectId: 'p9' },
    ])
    expect(out[0]!.createdAt).toBe(123)
    expect(out[0]!.projectId).toBe('p9')
  })

  it('★ 老素材没有时间 → 回落到最早一次产出它的生成记录', () => {
    const out = toLibraryAssets([{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array(4) }], {
      runRecords: [
        { createdAt: 500, outputHashes: ['h1'] },
        { createdAt: 300, outputHashes: ['h1'] },
      ],
    })
    expect(out[0]!.createdAt).toBe(300)
  })

  it('★ 老素材没有项目 → 回落到「当前持有它的节点」所属项目', () => {
    const out = toLibraryAssets([{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array(4) }], {
      nodes: [{ hash: 'h1', projectId: 'p-current' }],
      runRecords: [{ createdAt: 100, projectId: 'p-old', outputHashes: ['h1'] }],
    })
    // 来源取「现在在哪儿」而不是「谁生的」——后者会让用户在项目里找不到它
    expect(out[0]!.projectId).toBe('p-current')
  })

  it('两者都没有时是 0 / null（界面显示「—」，不猜）', () => {
    const out = toLibraryAssets([{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array(4) }])
    expect(out[0]!.createdAt).toBe(0)
    expect(out[0]!.projectId).toBeNull()
  })

  it('没有 hash 也没有 id 的行被跳过（脏数据不该让整页崩）', () => {
    expect(toLibraryAssets([{ mime: 'image/png' }])).toHaveLength(0)
  })

  it('id 即 hash 的老行也能认出来（assets 表主键就是内容哈希）', () => {
    const out = toLibraryAssets([{ id: 'abc', mime: 'image/png' }])
    expect(out[0]!.hash).toBe('abc')
  })

  it('结果按时间倒序（界面不必再排一遍）', () => {
    const out = toLibraryAssets([
      { hash: 'a', createdAt: 1 },
      { hash: 'b', createdAt: 2 },
    ])
    expect(out.map((a) => a.hash)).toEqual(['b', 'a'])
  })
})

describe('formatBytes', () => {
  it('按量级换档，未知显示「—」而不是 0 B', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(0)).toBe('—')
  })
})

describe('formatAssetSize', () => {
  it('两个数字齐全才显示；缺一侧返回 null', () => {
    expect(formatAssetSize({ width: 1024, height: 768 })).toBe('1024 × 768')
    expect(formatAssetSize({ width: 1024 })).toBeNull()
    expect(formatAssetSize({})).toBeNull()
  })
})

describe('masonryAspectOf', () => {
  it('横图矮、竖图高：比例取自素材真实宽高', () => {
    expect(masonryAspectOf({ width: 1600, height: 900 })).toBeCloseTo(16 / 9, 5)
    expect(masonryAspectOf({ width: 900, height: 1600 })).toBeCloseTo(9 / 16, 5)
  })

  it('★ 极端长图被夹住（否则一列会被单张图撑成一根面条）', () => {
    expect(masonryAspectOf({ width: 100, height: 2000 })).toBeCloseTo(0.5, 5)
    expect(masonryAspectOf({ width: 2000, height: 100 })).toBeCloseTo(2, 5)
  })

  it('★ 尺寸未知时返回默认 4:3（封面容器必须有高度，不能塌成一条线）', () => {
    expect(masonryAspectOf({})).toBeCloseTo(4 / 3, 5)
    expect(masonryAspectOf({ width: 0, height: 100 })).toBeCloseTo(4 / 3, 5)
  })

  it('返回值恒为正（除零 / 负数不该算出 NaN 把布局整条作废）', () => {
    expect(masonryAspectOf({ width: -5, height: -5 })).toBeGreaterThan(0)
    expect(Number.isFinite(masonryAspectOf({ width: 1, height: 0 }))).toBe(true)
  })
})
