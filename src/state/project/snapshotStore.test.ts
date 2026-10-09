import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { SNAPSHOT_INTERVAL_MS } from '../../domain/project/snapshot'
import { createSnapshotStore } from './snapshotStore'

/**
 * 项目快照落库（用户 2026-10-09，对账 #378 A4）。
 *
 * 端到端在内存平台上跑：拍 → 改坏 → 还原，验证**图真的回来了**。
 * 只断言"拍了几张"是不够的 —— 那种测试在"还原是空操作"时也会绿。
 */
const DAY = SNAPSHOT_INTERVAL_MS

function seed() {
  return createMemoryPlatform({
    rows: {
      projects: [{ id: 'p1', name: '猫咪', workbench: 'canvas', createdAt: 1, updatedAt: 2 * DAY }],
      nodes: [
        { id: 'n1', projectId: 'p1', type: 'prompt', data: { text: '原样' } },
        { id: 'n2', projectId: 'p1', type: 'generation' },
      ],
      edges: [{ id: 'e1', projectId: 'p1', source: 'n1', target: 'n2' }],
      runRecords: [{ id: 'r1', projectId: 'p1', createdAt: 5, outputHashes: [] }],
    },
  })
}

describe('项目快照 · 落库与还原', () => {
  it('★★ 拍一张 → 改坏 → 还原：节点、连线、正文都回到快照那一刻', async () => {
    const platform = seed()
    const store = createSnapshotStore(platform.storage)

    const snap = await store.capture('p1', 2 * DAY)
    expect(snap).not.toBeNull()
    expect(snap!.nodeCount).toBe(2)
    expect(snap!.name).toBe('猫咪')

    // 改坏：删掉一条节点、一条连线，并改掉正文
    await platform.storage.delete('nodes', 'n2')
    await platform.storage.delete('edges', 'e1')
    await platform.storage.put('nodes', {
      id: 'n1',
      projectId: 'p1',
      type: 'prompt',
      data: { text: '被改坏了' },
    })

    await store.restore(snap!.id)

    const nodes = await platform.storage.query('nodes', { projectId: 'p1' })
    expect(nodes).toHaveLength(2)
    expect(await platform.storage.query('edges', { projectId: 'p1' })).toHaveLength(1)
    const n1 = nodes.find((r) => r.id === 'n1')!
    expect((n1.data as { text: string }).text).toBe('原样')
  })

  it('★★ 运行记录只补写不清空（还原画布不该弄丢日志）', async () => {
    const platform = seed()
    const store = createSnapshotStore(platform.storage)
    const snap = await store.capture('p1', 2 * DAY)

    // 快照之后又跑了一次，产生一条新记录
    await platform.storage.put('runRecords', { id: 'r2', projectId: 'p1', createdAt: 9 })
    await store.restore(snap!.id)

    const records = await platform.storage.query('runRecords', { projectId: 'p1' })
    expect(records.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
  })

  it('★★ 自动快照的三条判据：空项目不拍、没改不拍、一天内不重复拍', async () => {
    const platform = createMemoryPlatform({
      rows: {
        projects: [
          { id: 'p1', name: '有内容', workbench: 'canvas', updatedAt: 5 * DAY },
          { id: 'p2', name: '空的', workbench: 'canvas', updatedAt: 5 * DAY },
          { id: 'p3', name: '在回收站', workbench: 'canvas', updatedAt: 5 * DAY, deletedAt: 4 * DAY },
        ],
        nodes: [
          { id: 'n1', projectId: 'p1' },
          { id: 'n3', projectId: 'p3' },
        ],
      },
    })
    const store = createSnapshotStore(platform.storage)

    const first = await store.runAuto({ now: 5 * DAY })
    expect(first.map((s) => s.projectId)).toEqual(['p1']) // 空项目与回收站里的都不拍

    // 立刻再跑一次：间隔没到，且也没改过 ⇒ 不拍
    const second = await store.runAuto({ now: 5 * DAY + 1000 })
    expect(second).toHaveLength(0)

    // 隔了一天并改过 ⇒ 拍
    await platform.storage.put('projects', {
      id: 'p1',
      name: '有内容',
      workbench: 'canvas',
      updatedAt: 6 * DAY,
    })
    const third = await store.runAuto({ now: 6 * DAY })
    expect(third.map((s) => s.projectId)).toEqual(['p1'])
  })

  it('★ 保留份数生效：超过 keep 时删最旧的', async () => {
    const platform = seed()
    const store = createSnapshotStore(platform.storage)

    // 连拍 5 张（每次隔一天且"改过"），keep = 3
    for (let i = 1; i <= 5; i += 1) {
      await platform.storage.put('projects', {
        id: 'p1',
        name: '猫咪',
        workbench: 'canvas',
        updatedAt: i * DAY,
      })
      await store.runAuto({ now: i * DAY, keep: 3 })
    }

    const list = await store.list('p1')
    expect(list).toHaveLength(3)
    // 最新的三张（第 3/4/5 天的）
    expect(list.map((s) => s.createdAt)).toEqual([5 * DAY, 4 * DAY, 3 * DAY])
  })

  it('★ 快照不抄素材字节（只留 hash，素材表本身是只增不改的）', async () => {
    const platform = createMemoryPlatform({
      rows: {
        projects: [{ id: 'p1', name: 'A', workbench: 'canvas', updatedAt: 2 * DAY }],
        nodes: [{ id: 'n1', projectId: 'p1', data: { assetHash: 'abc' } }],
        assets: [{ id: 'abc', bytes: new Uint8Array([1, 2, 3]) }],
      },
    })
    const store = createSnapshotStore(platform.storage)
    const snap = await store.capture('p1', 2 * DAY)
    const full = await store.read(snap!.id)

    expect(JSON.stringify(full)).not.toContain('"bytes"')
    expect(JSON.stringify(full)).toContain('abc')
  })

  it('★ 还原一份已不存在的快照要报错（不静默当成功）', async () => {
    const platform = seed()
    const store = createSnapshotStore(platform.storage)
    await expect(store.restore('不存在')).rejects.toThrow(/不在库里/)
  })
})
