/**
 * 产物像素的取值规则（用户 2026-09-17）。
 *
 * 测的是「什么情况下显示、显示哪个数」——这个读数挂在**节点外**的标题排上，
 * 而渲染截图只能证明「有个数字」，证明不了「这个数字是真实像素而不是请求值」。
 * 真实像素 vs 请求像素正是 §6.18 反复强调要分开的两件事，故单测锁死。
 */
import { describe, it, expect } from 'vitest'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { assetPixelsOf, formatPixels } from './assetPixels'

/** 造一个最小可用的节点快照（只填本函数会读的字段） */
const node = (type: NodeSnapshot['type'], data: unknown): NodeSnapshot =>
  ({
    id: 'n1',
    projectId: 'p1',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 240,
    data,
  }) as unknown as NodeSnapshot

describe('assetPixelsOf / 产物像素', () => {
  it('有素材 + 有真实尺寸 → 返回该尺寸', () => {
    const p = assetPixelsOf(node('generation', { assetHash: 'h1', naturalSize: { width: 1024, height: 1536 } }))
    expect(p).toEqual({ width: 1024, height: 1536 })
  })

  it('★ 取的是 naturalSize（真实像素），不是「请求像素」', () => {
    // 请求 1024×1024、实际收到 832×1248（mock 16:9 的真实产物）—— 必须显示后者
    const p = assetPixelsOf(
      node('generation', {
        assetHash: 'h1',
        naturalSize: { width: 832, height: 1248 },
        requestedWidth: 1024,
        requestedHeight: 1024,
      }),
    )
    expect(p).toEqual({ width: 832, height: 1248 })
    expect(formatPixels(p!)).toBe('832×1248')
  })

  it('没有素材（空节点）→ 不显示', () => {
    expect(assetPixelsOf(node('generation', { naturalSize: { width: 64, height: 64 } }))).toBeNull()
  })

  it('有素材但读不出尺寸（视频未解码）→ 不显示，不猜', () => {
    expect(assetPixelsOf(node('generation', { assetHash: 'h1' }))).toBeNull()
  })

  it('尺寸为 0 / 负数 → 不显示（不显示 0×0 这种假读数）', () => {
    expect(assetPixelsOf(node('generation', { assetHash: 'h1', naturalSize: { width: 0, height: 100 } }))).toBeNull()
    expect(assetPixelsOf(node('generation', { assetHash: 'h1', naturalSize: { width: -5, height: 100 } }))).toBeNull()
  })

  it('非生成节点（提示词 / 分组 / 批量）→ 不显示', () => {
    expect(assetPixelsOf(node('prompt', { assetHash: 'h1', naturalSize: { width: 8, height: 8 } }))).toBeNull()
    expect(assetPixelsOf(node('group', { assetHash: 'h1', naturalSize: { width: 8, height: 8 } }))).toBeNull()
    expect(assetPixelsOf(node('batch', { assetHash: 'h1', naturalSize: { width: 8, height: 8 } }))).toBeNull()
  })

  it('小数尺寸取整（文件头读出来的必是整数，防御性）', () => {
    const p = assetPixelsOf(node('generation', { assetHash: 'h1', naturalSize: { width: 100.6, height: 200.2 } }))
    expect(p).toEqual({ width: 101, height: 200 })
  })

  it('文案用乘号 ×，不是字母 x', () => {
    expect(formatPixels({ width: 1920, height: 1080 })).toBe('1920×1080')
  })
})
