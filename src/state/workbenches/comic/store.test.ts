import { describe, it, expect, beforeEach } from 'vitest'
import { createComicStore } from './store'
import { createMemoryPlatform } from '../../../platform/memory'
import { emptyComicProject } from '../../../domain/comic/model/comicProject'
import type { PlatformKit } from '../../../platform/ports'

let platform: PlatformKit

beforeEach(() => {
  platform = createMemoryPlatform()
})

describe('comic store / 命令与快照', () => {
  it('episode.add 后 project 含一话，索引与标题自增', () => {
    const store = createComicStore({ platform, projectId: 'c1' })
    expect(store.getProject().episodes).toHaveLength(0)

    store.dispatch({ kind: 'episode.add' })
    store.dispatch({ kind: 'episode.add' })

    const eps = store.getProject().episodes
    expect(eps).toHaveLength(2)
    expect(eps[0]!.index).toBe(0)
    expect(eps[1]!.index).toBe(1)
    // 未传 title 时按序号生成
    expect(eps[0]!.title).toBe('第 1 话')
    expect(eps[1]!.title).toBe('第 2 话')
  })

  it('episode.add 支持自定义标题（首尾空白被裁剪）', () => {
    const store = createComicStore({ platform, projectId: 'c1' })
    store.dispatch({ kind: 'episode.add', title: '  序章  ' })
    expect(store.getProject().episodes[0]!.title).toBe('序章')
  })

  it('初始标题取 options.title，缺省为空白漫画剧', () => {
    const a = createComicStore({ platform, projectId: 'c1', title: '我的漫画' })
    expect(a.getProject().title).toBe('我的漫画')
    const b = createComicStore({ platform, projectId: 'c2' })
    expect(b.getProject().title).toBe('未命名漫画剧')
    expect(b.getProject().episodes).toHaveLength(0)
  })
})

describe('comic store / 持久化', () => {
  it('dispatch 后 flush 落库到 comics 表（主键为 projectId）', async () => {
    const store = createComicStore({ platform, projectId: 'c1', title: 'T' })
    store.dispatch({ kind: 'episode.add' })
    store.dispatch({ kind: 'episode.add' })

    await store.flush()
    const rows = await platform.storage.query('comics', {})
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('c1')
    expect((rows[0] as unknown as { title: string }).title).toBe('T')
    expect((rows[0] as unknown as { episodes: unknown[] }).episodes).toHaveLength(2)
  })

  it('防抖：同窗口内多次操作只写一次库，且内容是最后一次', async () => {
    let writes = 0
    const counting: PlatformKit = {
      ...platform,
      storage: {
        ...platform.storage,
        put: async (table, row) => {
          if (table === 'comics') writes++
          return platform.storage.put(table, row)
        },
      },
    }
    const store = createComicStore({ platform: counting, projectId: 'c1', debounceMs: 50 })
    store.dispatch({ kind: 'episode.add' })
    store.dispatch({ kind: 'episode.add' })
    store.dispatch({ kind: 'episode.add' })
    expect(writes).toBe(0) // 防抖窗口内尚未落库

    await store.flush()
    expect(writes).toBe(1)
    const rows = await platform.storage.query('comics', {})
    expect((rows[0] as unknown as { episodes: unknown[] }).episodes).toHaveLength(3)
  })

  it('hydrate 是读回而非用户操作：不触发回写', async () => {
    let writes = 0
    const counting: PlatformKit = {
      ...platform,
      storage: {
        ...platform.storage,
        put: async (table, row) => {
          if (table === 'comics') writes++
          return platform.storage.put(table, row)
        },
      },
    }
    const store = createComicStore({ platform: counting, projectId: 'c1' })
    store.hydrate(emptyComicProject('c1', '读回'))
    await store.flush()
    expect(writes).toBe(0)
    expect(store.getProject().title).toBe('读回')

    // 之后的用户操作照常落库
    store.dispatch({ kind: 'episode.add' })
    await store.flush()
    expect(writes).toBe(1)
  })

  it('无待写内容时 flush 不产生写库', async () => {
    let writes = 0
    const counting: PlatformKit = {
      ...platform,
      storage: {
        ...platform.storage,
        put: async (table, row) => {
          if (table === 'comics') writes++
          return platform.storage.put(table, row)
        },
      },
    }
    const store = createComicStore({ platform: counting, projectId: 'c1' })
    await store.flush()
    expect(writes).toBe(0)
  })
})

describe('comic store / M6-2 项目级命令', () => {
  it('character.add 落库并可读回', async () => {
    const store = createComicStore({ platform, projectId: 'c1', title: 'T' })
    store.dispatch({ kind: 'character.add', name: '阿花', description: '双马尾' })
    await store.flush()

    const rows = await platform.storage.query('comics', {})
    const chars = (rows[0] as unknown as { characters: { name: string; description: string }[] }).characters
    expect(chars).toHaveLength(1)
    expect(chars[0]).toMatchObject({ name: '阿花', description: '双马尾' })
  })

  it('character.update 改名后落库', async () => {
    const store = createComicStore({ platform, projectId: 'c1' })
    store.dispatch({ kind: 'character.add', name: '阿花' })
    const id = store.getProject().characters[0]!.id
    store.dispatch({ kind: 'character.update', id, patch: { name: '花姐' } })
    await store.flush()

    const rows = await platform.storage.query('comics', {})
    const chars = (rows[0] as unknown as { characters: { id: string; name: string }[] }).characters
    expect(chars[0]).toMatchObject({ id, name: '花姐' })
  })

  it('character.remove 删除角色卡后落库', async () => {
    const store = createComicStore({ platform, projectId: 'c1' })
    store.dispatch({ kind: 'character.add', name: 'A' })
    store.dispatch({ kind: 'character.add', name: 'B' })
    const idA = store.getProject().characters[0]!.id
    store.dispatch({ kind: 'character.remove', id: idA })
    expect(store.getProject().characters).toHaveLength(1)
    expect(store.getProject().characters[0]!.name).toBe('B')

    await store.flush()
    const rows = await platform.storage.query('comics', {})
    const chars = (rows[0] as unknown as { characters: { name: string }[] }).characters
    expect(chars.map((c) => c.name)).toEqual(['B'])
  })

  it('project.setReadingDirection 切换后落库', async () => {
    const store = createComicStore({ platform, projectId: 'c1' })
    expect(store.getProject().readingDirection).toBe('ltr')
    store.dispatch({ kind: 'project.setReadingDirection', direction: 'rtl' })
    expect(store.getProject().readingDirection).toBe('rtl')

    await store.flush()
    const rows = await platform.storage.query('comics', {})
    expect((rows[0] as unknown as { readingDirection: string }).readingDirection).toBe('rtl')
  })

  it('设为同值不触发落库（reducer 返回原引用 → store 跳过 schedule）', async () => {
    let writes = 0
    const counting: PlatformKit = {
      ...platform,
      storage: {
        ...platform.storage,
        put: async (table, row) => {
          if (table === 'comics') writes++
          return platform.storage.put(table, row)
        },
      },
    }
    const store = createComicStore({ platform: counting, projectId: 'c1' })
    store.dispatch({ kind: 'project.setReadingDirection', direction: 'ltr' }) // 与默认同值
    await store.flush()
    expect(writes).toBe(0)
  })
})
