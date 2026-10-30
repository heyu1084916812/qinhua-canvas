import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { DEFAULT_CANVAS_STYLE, readCanvasStyle } from '../../domain/project/canvasStyle'
import { readCoverMark } from '../../domain/project/cover'
import { loadCanvasStyle, saveCanvasStyle } from './canvasStyle'

/**
 * 项目级画布偏好的落库（对账 #379 的 C 步）。
 *
 * 判据一律落在**回读**上：写完之后从库里读回来是不是那一份 ——
 * 「函数被调用过」这类断言在真实链路上什么都保证不了。
 */
describe('画布外观偏好落库（内存存储）', () => {
  const putProject = async (storage: ReturnType<typeof createMemoryStorage>, id: string) => {
    await storage.put('projects', {
      id,
      name: 'P',
      workbench: 'canvas',
      createdAt: 1,
      updatedAt: 1,
      extra: {},
    })
  }

  it('★ 写进去之后能读回那一份（背景 / 预设或自定义色 / 两档字号 / 尺寸档）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    const style = {
      ...DEFAULT_CANVAS_STYLE,
      background: 'grid' as const,
      tone: 'amber' as const,
      customCanvas: {
        light: { background: '#654321', dot: '#d2d0cb' },
        dark: { background: '#010203', dot: '#242424' },
      },
      customNode: {
        light: '#fff4e6',
        dark: '#111111',
      },
      bodySize: 18,
    }
    expect(await saveCanvasStyle(storage, 'p1', style)).toBe(true)
    expect(await loadCanvasStyle(storage, 'p1')).toEqual(style)
  })

  it('不碰 updatedAt / name（改背景色不是"项目被编辑"）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    await saveCanvasStyle(storage, 'p1', { ...DEFAULT_CANVAS_STYLE, tone: 'blue' })
    const rows = await storage.query('projects', { id: 'p1' })
    expect(rows[0].updatedAt).toBe(1)
    expect(rows[0].name).toBe('P')
  })

  it('★ 值没变就不写（面板每点一下都调它，反复写同一份只让存储层白忙）', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    expect(await saveCanvasStyle(storage, 'p1', DEFAULT_CANVAS_STYLE)).toBe(false)
    const rows = await storage.query('projects', { id: 'p1' })
    expect(rows[0].extra).toEqual({})
  })

  it('★ 不吞掉 extra 里的其他键（封面标记还在）', async () => {
    const storage = createMemoryStorage()
    await storage.put('projects', {
      id: 'p1',
      name: 'P',
      workbench: 'canvas',
      createdAt: 1,
      updatedAt: 1,
      extra: { cover: { hash: 'h1', at: 100 } },
    })
    await saveCanvasStyle(storage, 'p1', { ...DEFAULT_CANVAS_STYLE, tone: 'rose' })
    const rows = await storage.query('projects', { id: 'p1' })
    expect(readCoverMark(rows[0].extra)).toEqual({ hash: 'h1', at: 100 })
    expect(readCanvasStyle(rows[0].extra).tone).toBe('rose')
  })

  it('项目不存在 / demo / 空 id：静默返回，不新建脏行', async () => {
    const storage = createMemoryStorage()
    expect(await saveCanvasStyle(storage, 'nope', DEFAULT_CANVAS_STYLE)).toBe(false)
    expect(await saveCanvasStyle(storage, 'demo', DEFAULT_CANVAS_STYLE)).toBe(false)
    expect(await saveCanvasStyle(storage, '', DEFAULT_CANVAS_STYLE)).toBe(false)
    expect(await storage.query('projects', {})).toHaveLength(0)
    expect(await loadCanvasStyle(storage, 'nope')).toEqual(DEFAULT_CANVAS_STYLE)
  })
})
