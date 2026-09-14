import { describe, it, expect, beforeEach } from 'vitest'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import { createMemoryPlatform } from '../../platform/memory'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { createAssetNode, importAssetFile, isImportableMedia, IMPORT_ACCEPT } from './importAsset'
import type { PlatformKit } from '../../platform/ports'

let platform: PlatformKit

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
  platform = createMemoryPlatform()
})

const storeOf = () => createCanvasStore({ platform, projectId: 'p-import' })

describe('isImportableMedia', () => {
  it('图片与视频可导入，其余不行', () => {
    expect(isImportableMedia('image/png')).toBe(true)
    expect(isImportableMedia('video/mp4')).toBe(true)
    expect(isImportableMedia('text/plain')).toBe(false)
    expect(isImportableMedia('application/pdf')).toBe(false)
  })

  it('接受清单里的每一项都是可导入的（清单与实际判定同口径）', () => {
    for (const mime of IMPORT_ACCEPT.split(',')) {
      expect(isImportableMedia(mime)).toBe(true)
    }
  })
})

describe('createAssetNode', () => {
  it('按素材建成生成节点：带 assetHash、thumbOrder，mode 按 mime 定', () => {
    const store = storeOf()
    const id = createAssetNode(
      { platform, store, projectId: 'p-import' },
      { hash: 'h1', mime: 'image/png', width: 1600, height: 900 },
      { x: 10, y: 20 },
    )
    expect(id).toBeTruthy()
    const node = store.getSnapshot().nodes.find((n) => n.id === id)!
    expect(node.type).toBe('generation')
    const data = node.data as { assetHash?: string; mode?: string; thumbOrder?: string[] }
    expect(data.assetHash).toBe('h1')
    expect(data.mode).toBe('image')
    expect(data.thumbOrder).toEqual(['h1'])
    expect(node.x).toBe(10)
    expect(node.y).toBe(20)
  })

  it('视频素材落成的节点 mode 是 video（否则面板与生成按钮都按图片处理）', () => {
    const store = storeOf()
    const id = createAssetNode(
      { platform, store, projectId: 'p-import' },
      { hash: 'v1', mime: 'video/mp4' },
      { x: 0, y: 0 },
    )
    const node = store.getSnapshot().nodes.find((n) => n.id === id)!
    expect((node.data as { mode: string }).mode).toBe('video')
  })

  it('一次导入 = 一个撤销单元：撤一步节点就没了（否则留下空节点或孤儿素材）', () => {
    const store = storeOf()
    const id = createAssetNode(
      { platform, store, projectId: 'p-import' },
      { hash: 'h1', mime: 'image/png' },
      { x: 0, y: 0 },
    )
    expect(store.getSnapshot().nodes).toHaveLength(1)
    store.undo()
    expect(store.getSnapshot().nodes.find((n) => n.id === id)).toBeUndefined()
  })

  it('ownPlan=false 时并入外层计划：整批一次撤销（拖入多文件的语义）', () => {
    const store = storeOf()
    const deps = { platform, store, projectId: 'p-import' }
    // 外层只开一次计划；若 createAssetNode 自己再开一层，内层的 endPlan 会
    // 提前把 activePlan 清掉 ⇒ 后面的节点各自成为独立撤销单元
    store.beginPlan('import:batch', '导入素材')
    const a = createAssetNode(deps, { hash: 'h1', mime: 'image/png' }, { x: 0, y: 0 }, false)
    const b = createAssetNode(deps, { hash: 'h2', mime: 'image/png' }, { x: 400, y: 0 }, false)
    store.endPlan()
    expect(store.getSnapshot().nodes).toHaveLength(2)
    store.undo()
    // 一步撤销两个都走：只走一个说明计划被嵌套关掉了
    expect(store.getSnapshot().nodes.find((n) => n.id === a)).toBeUndefined()
    expect(store.getSnapshot().nodes.find((n) => n.id === b)).toBeUndefined()
  })

  it('文件名去扩展名当节点名（过长截断）', () => {
    const store = storeOf()
    const id = createAssetNode(
      { platform, store, projectId: 'p-import' },
      { hash: 'h1', mime: 'image/png', name: 'a-very-long-file-name-that-needs-cutting.png' },
      { x: 0, y: 0 },
    )
    const node = store.getSnapshot().nodes.find((n) => n.id === id)!
    expect(node.title.length).toBeLessThanOrEqual(24)
    expect(node.title).not.toMatch(/\.png$/)
  })
})

describe('importAssetFile', () => {
  it('memory 平台没有待选文件时返回 null（不建节点、不落库）', async () => {
    const store = storeOf()
    const asset = await importAssetFile({ platform, store, projectId: 'p-import' })
    expect(asset).toBeNull()
    expect(store.getSnapshot().nodes).toHaveLength(0)
  })
})
