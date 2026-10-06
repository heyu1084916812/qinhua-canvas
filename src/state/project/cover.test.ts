import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { readCoverMark } from '../../domain/project/cover'
import { rememberCanvasCover } from './cover'
import { createProjectRepository } from './repository'

/**
 * 「一张图刚进了画布」这件事的落库（对账 #289）。
 *
 * 它只有一个生产者（`importAssetFile`）和两个消费点（项目列表的封面、
 * 以及这条标记本身），所以这里测的是**回读**：写完之后**从库里读回来**是不是那笔 ——
 * 而不是"函数被调用过"（那种断言在真实链路上什么都保证不了）。
 */
describe('rememberCanvasCover（内存存储）', () => {
  const putProject = async (storage: ReturnType<typeof createMemoryStorage>, id: string) => {
    await storage.put('projects', { id, name: 'P', workbench: 'canvas', createdAt: 1, updatedAt: 1, extra: {} })
  }

  it('★ 写进去之后能从库里读回那一笔（hash + 时间）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    await rememberCanvasCover(storage, 'p1', 'hash-a', 1234)

    const rows = await storage.query('projects', { id: 'p1' })
    expect(readCoverMark(rows[0].extra)).toEqual({ hash: 'hash-a', at: 1234 })
  })

  it('不碰 updatedAt（那是"项目被编辑"的时间，与"导入了哪个文件"是两件事）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    await rememberCanvasCover(storage, 'p1', 'hash-a', 1234)
    const rows = await storage.query('projects', { id: 'p1' })
    expect(rows[0].updatedAt).toBe(1)
    expect(rows[0].name).toBe('P')
  })

  it('★ 同一张图重复导入不写第二次（避免每次拖入同一张都回写项目行）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    await rememberCanvasCover(storage, 'p1', 'hash-a', 1000)
    await rememberCanvasCover(storage, 'p1', 'hash-a', 2000)

    const rows = await storage.query('projects', { id: 'p1' })
    // 时间仍是第一次那一笔 ⇒ 第二次确实没有回写
    expect(readCoverMark(rows[0].extra)).toEqual({ hash: 'hash-a', at: 1000 })
  })

  it('换一张图则改写（后一张才是"最后出现在画布里的"）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    await rememberCanvasCover(storage, 'p1', 'hash-a', 1000)
    await rememberCanvasCover(storage, 'p1', 'hash-b', 2000)
    const rows = await storage.query('projects', { id: 'p1' })
    expect(readCoverMark(rows[0].extra)).toEqual({ hash: 'hash-b', at: 2000 })
  })

  it('项目行不存在 / hash 为空时静默跳过（导入不该因为封面记不上而失败）', async () => {
    const storage = createMemoryStorage()
    await expect(rememberCanvasCover(storage, 'nope', 'hash-a', 1)).resolves.toBeUndefined()
    expect(await storage.query('projects', {})).toHaveLength(0)

    await putProject(storage, 'p1')
    await expect(rememberCanvasCover(storage, 'p1', '', 1)).resolves.toBeUndefined()
    const rows = await storage.query('projects', { id: 'p1' })
    expect(readCoverMark(rows[0].extra)).toBeNull()
  })

  /**
   * ★★ 端到端：导入记一笔 → 列表的封面就是它。
   *
   * 这条把两个模块接起来测（写标记 + 算封面），因为"各写各的都对、接起来不对"
   * 正是这个仓库反复栽的地方（生成/上传两个候选必须在**同一个**判据下比较）。
   */
  it('★★ 导入记一笔之后，list() 的封面就是那张（且压过早先的生成产物）', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: 'P' })
    // 先有一次生成产物（时间更早）
    await storage.put('runRecords', {
      id: 'r1',
      projectId: p.id,
      nodeId: 'n1',
      createdAt: 1000,
      outputHashes: ['gen-1'],
    })
    let list = await repo.list()
    expect(list[0].coverHash).toBe('gen-1')

    // 再导入一张图（时间更晚）
    await rememberCanvasCover(storage, p.id, 'up-1', 2000)
    list = await repo.list()
    expect(list[0].coverHash).toBe('up-1')
  })

  it('★★ 之后的生成产物比导入更晚 ⇒ 封面回到生成那张', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: 'P' })
    await rememberCanvasCover(storage, p.id, 'up-1', 2000)
    await storage.put('runRecords', {
      id: 'r1',
      projectId: p.id,
      nodeId: 'n1',
      createdAt: 3000,
      outputHashes: ['gen-2'],
    })
    const list = await repo.list()
    expect(list[0].coverHash).toBe('gen-2')
  })
})
