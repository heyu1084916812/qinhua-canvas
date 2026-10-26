import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyStoryboard } from '../../domain/storyboard/storyboard'
import type { StoryboardStore } from '../../state/project/storyboardStore'
import {
  StoryboardDocumentStoreProvider,
  useStoryboardDocumentStore,
} from './StoryboardDocumentStoreContext'
import {
  STORYBOARD_SAVE_DEBOUNCE_MS,
  createStoryboardDocumentWriter,
} from './useStoryboardDocument'

afterEach(() => {
  vi.useRealTimers()
})

describe('createStoryboardDocumentWriter', () => {
  it('replaceDoc 更新时间和界面状态，并在防抖窗口后只保存最后一次文档', async () => {
    vi.useFakeTimers()
    let now = 100
    const save = vi.fn().mockResolvedValue(undefined)
    const onDocumentChange = vi.fn()
    const onStatus = vi.fn()
    const writer = createStoryboardDocumentWriter({
      store: { save },
      onDocumentChange,
      onStatus,
      now: () => now,
    })
    const first = { ...emptyStoryboard('project-1'), sourceText: 'first' }
    const second = { ...emptyStoryboard('project-1'), sourceText: 'second' }

    now = 200
    const stampedFirst = writer.replaceDoc(first)
    expect(stampedFirst.updatedAt).toBe(200)
    expect(onDocumentChange).toHaveBeenLastCalledWith(stampedFirst)
    expect(onStatus).toHaveBeenLastCalledWith('正在保存…')

    vi.advanceTimersByTime(STORYBOARD_SAVE_DEBOUNCE_MS - 1)
    expect(save).not.toHaveBeenCalled()

    now = 300
    const stampedSecond = writer.replaceDoc(second)
    expect(onDocumentChange).toHaveBeenLastCalledWith(stampedSecond)

    await vi.advanceTimersByTimeAsync(STORYBOARD_SAVE_DEBOUNCE_MS)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(stampedSecond)
    expect(onStatus).toHaveBeenLastCalledWith('已保存')
  })

  it('flush 立即写入 pending，重复 flush 不重复保存', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const writer = createStoryboardDocumentWriter({
      store: { save },
      debounceMs: 10_000,
    })
    const doc = { ...emptyStoryboard('project-1'), sourceText: 'pending' }

    writer.replaceDoc(doc)
    await writer.flush()
    await writer.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0].sourceText).toBe('pending')
  })

  it('防抖已触发时 flush 等待在飞写入，且旧写入不覆盖新编辑状态', async () => {
    vi.useFakeTimers()
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const save = vi
      .fn()
      .mockImplementationOnce(() => firstGate)
      .mockResolvedValue(undefined)
    const onStatus = vi.fn()
    const writer = createStoryboardDocumentWriter({
      store: { save },
      onStatus,
    })
    const first = { ...emptyStoryboard('project-1'), sourceText: 'first' }
    const second = { ...emptyStoryboard('project-1'), sourceText: 'second' }

    writer.replaceDoc(first)
    vi.advanceTimersByTime(STORYBOARD_SAVE_DEBOUNCE_MS)
    await Promise.resolve()
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)

    writer.replaceDoc(second)
    expect(onStatus).toHaveBeenLastCalledWith('正在保存…')

    let flushed = false
    const flushing = writer.flush().then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)

    releaseFirst()
    await flushing

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0].sourceText).toBe('second')
    expect(onStatus).toHaveBeenLastCalledWith('已保存')
  })
})

describe('StoryboardDocumentStoreProvider', () => {
  it('两个消费者拿到同一个 Store / save 函数，不产生第二份文档端口', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const documents = {
      load: vi.fn(),
      save,
    } as unknown as StoryboardStore
    const seen: StoryboardStore[] = []

    function Probe() {
      seen.push(useStoryboardDocumentStore())
      return null
    }

    renderToStaticMarkup(
      createElement(
        StoryboardDocumentStoreProvider,
        { documents },
        createElement(Probe),
        createElement(Probe),
      ),
    )

    expect(seen).toEqual([documents, documents])
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]?.save).toBe(seen[1]?.save)
  })
})
