import { describe, expect, it } from 'vitest'
import {
  assetKindOf,
  buildLibraryAssetSnapshot,
  byteLengthOf,
  filterLibraryAssets,
  formatAssetSize,
  formatBytes,
  masonryAspectOf,
  sortLibraryAssets,
  toLibraryAssets,
  type LibraryAsset,
  type SnapshotRunRecordLike,
} from './assetLibrary'

const asset = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  hash: 'h1',
  mime: 'image/png',
  bytes: 1024,
  width: 512,
  height: 512,
  savedAt: 1000,
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
  it('三种落库形态都能量出长度', () => {
    expect(byteLengthOf(new Uint8Array(10))).toBe(10)
    expect(byteLengthOf(new ArrayBuffer(7))).toBe(7)
    expect(byteLengthOf([1, 2, 3])).toBe(3)
  })

  it('认不出来时是 0，不抛', () => {
    expect(byteLengthOf(undefined)).toBe(0)
    expect(byteLengthOf('abc')).toBe(0)
  })
})

describe('sortLibraryAssets', () => {
  it('新的在前，时间相同时按 hash 稳定排序', () => {
    const sorted = sortLibraryAssets([
      asset({ hash: 'old', savedAt: 1 }),
      asset({ hash: 'b', savedAt: 9 }),
      asset({ hash: 'a', savedAt: 9 }),
    ])
    expect(sorted.map((item) => item.hash)).toEqual(['a', 'b', 'old'])
  })

  it('不修改入参数组', () => {
    const input = [asset({ hash: 'b', savedAt: 5 }), asset({ hash: 'a', savedAt: 9 })]
    sortLibraryAssets(input)
    expect(input.map((item) => item.hash)).toEqual(['b', 'a'])
  })
})

describe('filterLibraryAssets', () => {
  const pool = [
    asset({
      hash: 'a',
      mime: 'image/png',
      prompt: '猫咪在窗边',
      model: 'image-pro',
      quality: 'high',
      ratio: '16:9',
      resolution: '2k',
    }),
    asset({ hash: 'v', mime: 'video/mp4', prompt: '狗狗奔跑', model: 'video-x' }),
  ]

  it('类型筛选：只要图片时视频不出现', () => {
    expect(filterLibraryAssets(pool, '', 'image').map((item) => item.hash)).toEqual(['a'])
  })

  it('关键字能命中提示词、模型、质量、比例、分辨率与尺寸', () => {
    expect(filterLibraryAssets(pool, '猫咪', 'all').map((item) => item.hash)).toEqual(['a'])
    expect(filterLibraryAssets(pool, 'video-x', 'all').map((item) => item.hash)).toEqual(['v'])
    expect(filterLibraryAssets(pool, 'high', 'all').map((item) => item.hash)).toEqual(['a'])
    expect(filterLibraryAssets(pool, '16:9', 'all').map((item) => item.hash)).toEqual(['a'])
    expect(filterLibraryAssets(pool, '2k', 'all').map((item) => item.hash)).toEqual(['a'])
    expect(filterLibraryAssets(pool, '512', 'all')).toHaveLength(2)
  })

  it('刻意不按 hash 搜索', () => {
    const withHash = [...pool, asset({ hash: 'z9q8w7', prompt: '没有关键字', model: '' })]
    expect(filterLibraryAssets(withHash, 'z9q8w7', 'all')).toHaveLength(0)
  })

  it('空关键字返回全部', () => {
    expect(filterLibraryAssets(pool, '   ', 'all')).toHaveLength(2)
  })
})

describe('toLibraryAssets', () => {
  it('收藏行直接转成冻结快照，按保存时间倒序', () => {
    const out = toLibraryAssets([
      {
        id: 'a',
        mime: 'image/png',
        bytes: new Uint8Array(4),
        savedAt: 1,
        projectId: 'p1',
        prompt: 'P',
      },
      {
        id: 'b',
        mime: 'video/mp4',
        bytes: 8,
        savedAt: 2,
        channelId: 'ch2',
      },
    ])
    expect(out.map((item) => item.hash)).toEqual(['b', 'a'])
    expect(out[1]).toMatchObject({
      projectId: 'p1',
      prompt: 'P',
      width: undefined,
      savedAt: 1,
    })
    expect(out[0]!.channelId).toBe('ch2')
  })

  it('没有 hash 也没有 id 的行被跳过', () => {
    expect(toLibraryAssets([{ mime: 'image/png' }])).toHaveLength(0)
  })
})

describe('buildLibraryAssetSnapshot', () => {
  const assetRow = {
    id: 'h1',
    hash: 'h1',
    mime: 'image/png',
    bytes: new Uint8Array(12),
    width: 256,
    height: 256,
  }
  const node = {
    projectId: 'p-current',
    data: {
      channelId: 'node-channel',
      model: 'node-model',
      prompt: 'node prompt',
      quality: 'low',
      ratio: '1:1',
      resolution: '1k',
      naturalSize: { width: 800, height: 600 },
    },
  }

  it('选用最新成功记录，渠道 / 模型与参数优先取实际发送值', () => {
    const records: SnapshotRunRecordLike[] = [
      {
        status: 'succeeded',
        createdAt: 100,
        version: 1,
        outputHashes: ['h1'],
        sentChannelId: 'old-channel',
        sentModel: 'old-model',
        outputWidth: 300,
        outputHeight: 200,
        params: { prompt: 'old', quality: 'medium', ratio: '2:1', resolution: '2k' },
      },
      {
        status: 'failed',
        createdAt: 500,
        outputHashes: ['h1'],
        sentChannelId: 'failed-channel',
      },
      {
        status: 'succeeded',
        createdAt: 300,
        version: 2,
        outputHashes: ['other', 'h1'],
        sentChannelId: 'sent-channel',
        sentModel: 'sent-model',
        outputWidth: 1024,
        outputHeight: 768,
        params: { prompt: 'sent prompt', quality: 'high', ratio: '4:3', resolution: '4k' },
      },
    ]

    const out = buildLibraryAssetSnapshot({
      hash: 'h1',
      asset: assetRow,
      node,
      runRecords: records,
      savedAt: 1234,
    })

    expect(out).toEqual({
      hash: 'h1',
      mime: 'image/png',
      bytes: 12,
      width: 1024,
      height: 768,
      savedAt: 1234,
      projectId: 'p-current',
      prompt: 'sent prompt',
      model: 'sent-model',
      quality: 'high',
      ratio: '4:3',
      resolution: '4k',
      channelId: 'sent-channel',
    })
  })

  it('没有成功记录时回落节点，再回落素材行尺寸', () => {
    const out = buildLibraryAssetSnapshot({
      hash: 'h1',
      asset: assetRow,
      node,
      runRecords: [],
      savedAt: 8,
    })
    expect(out).toMatchObject({
      width: 800,
      height: 600,
      channelId: 'node-channel',
      model: 'node-model',
      prompt: 'node prompt',
      quality: 'low',
      ratio: '1:1',
      resolution: '1k',
    })

    const noNode = buildLibraryAssetSnapshot({
      hash: 'h1',
      asset: assetRow,
      runRecords: [],
      savedAt: 8,
    })
    expect(noNode).toMatchObject({ width: 256, height: 256 })
  })

  it('素材行缺失或 hash 不符时返回 null，不伪造收藏', () => {
    expect(
      buildLibraryAssetSnapshot({ hash: 'h1', asset: null, savedAt: 1 }),
    ).toBeNull()
    expect(
      buildLibraryAssetSnapshot({
        hash: 'h1',
        asset: { id: 'other', bytes: new Uint8Array(2) },
        savedAt: 1,
      }),
    ).toBeNull()
  })

  it('单个像素字段缺失时不在该来源猜数，继续向下回落', () => {
    const out = buildLibraryAssetSnapshot({
      hash: 'h1',
      asset: assetRow,
      node,
      runRecords: [
        {
          status: 'succeeded',
          createdAt: 9,
          outputHashes: ['h1'],
          outputWidth: 999,
        },
      ],
      savedAt: 1,
    })
    expect(out).toMatchObject({ width: 800, height: 600 })
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
  it('横图矮、竖图高，保留真实极端比例', () => {
    expect(masonryAspectOf({ width: 1600, height: 900 })).toBeCloseTo(16 / 9, 5)
    expect(masonryAspectOf({ width: 900, height: 1600 })).toBeCloseTo(9 / 16, 5)
    expect(masonryAspectOf({ width: 100, height: 2000 })).toBeCloseTo(0.05, 5)
    expect(masonryAspectOf({ width: 2000, height: 100 })).toBeCloseTo(20, 5)
  })

  it('尺寸未知时返回默认 4:3', () => {
    expect(masonryAspectOf({})).toBeCloseTo(4 / 3, 5)
    expect(masonryAspectOf({ width: 0, height: 100 })).toBeCloseTo(4 / 3, 5)
  })
})
