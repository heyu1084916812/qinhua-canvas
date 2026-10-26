import { describe, expect, it, vi } from 'vitest'
import {
  addEpisode,
  emptyStoryboard,
  updateSourceText,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import { createStoryboardAuthoringController } from './useStoryboardAuthoringController'

const NOVEL = [
  '第一章 雨夜',
  '雨下了整晚。骑手把最后一单塞进保温箱。',
  '',
  '第二章 十五楼',
  '电梯停在十五楼，门缝里透出暖光。',
  '',
  '第三章 收尾',
  '第二天清早，收货人终于回了消息。',
].join('\n')

function trace(): DirectRunTraceInput {
  return {
    projectId: 'p1',
    scopeVersion: 1,
    workbench: 'storyboard',
    subjectId: 'test',
    scopeId: 'project:p1',
    operationId: 'op:test',
    fingerprint: 'fp',
  }
}

function harness(doc: StoryboardDoc) {
  let current = doc
  const applied: StoryboardDoc[] = []
  const completeWithTools = vi.fn()
  const splits: { kind: 'idle' | 'running' | 'done' | 'error'; text: string }[] = []
  const breakStates: ('idle' | 'running' | 'done' | 'error')[] = []
  const breakMessages: string[] = []
  const mergeStates: {
    kind: 'idle' | 'running' | 'done' | 'error'
    text: string
  }[] = []
  const controller = createStoryboardAuthoringController({
    doc,
    currentDoc: () => current,
    selected: doc.episodes[0] ?? null,
    shots: doc.shots,
    chatTarget: null,
    channels: { completeWithTools } as unknown as ChannelStore,
    projectId: 'p1',
    directTrace: trace,
    apply: (next) => {
      current = next
      applied.push(next)
    },
    split: { kind: 'idle', text: '' },
    setSplit: (next) => {
      const value =
        typeof next === 'function' ? next({ kind: 'idle', text: '' }) : next
      splits.push(value)
    },
    splitConfirm: false,
    setSplitConfirm: () => undefined,
    splitAbort: { current: null },
    breaking: 'idle',
    setBreaking: (next) => {
      const value =
        typeof next === 'function' ? next('idle') : next
      breakStates.push(value)
    },
    setBreakMsg: (next) => {
      const value = typeof next === 'function' ? next('') : next
      breakMessages.push(value)
    },
    breakConfirm: false,
    setBreakConfirm: () => undefined,
    breakAbort: { current: null },
    setMergeScan: (next) => {
      const value =
        typeof next === 'function'
          ? next({ kind: 'idle', text: '' })
          : next
      mergeStates.push(value)
    },
    setMerges: () => undefined,
    setMergeConfirmId: () => undefined,
  })
  return {
    controller,
    applied,
    completeWithTools,
    splits,
    breakStates,
    breakMessages,
    mergeStates,
  }
}

describe('Storyboard authoring controller', () => {
  it('没有对话模型也按章节结构拆集，不伪造 LLM 请求', async () => {
    const doc = updateSourceText(emptyStoryboard('p1'), NOVEL, 1)
    const test = harness(doc)

    await test.controller.runSplit()

    expect(test.completeWithTools).not.toHaveBeenCalled()
    expect(test.applied.at(-1)?.episodes.map((episode) => episode.title)).toEqual([
      '第一章 雨夜',
      '第二章 十五楼',
      '第三章 收尾',
    ])
    expect(test.splits.at(-1)).toEqual({
      kind: 'done',
      text: '按结构拆出 3 集（没配对话模型，标题用章节名 / 第 N 集）',
    })
  })

  it('拆镜缺对话模型时停在可诊断错误，不写文档', async () => {
    let doc = addEpisode(emptyStoryboard('p1'))
    doc = {
      ...doc,
      episodes: doc.episodes.map((episode) => ({
        ...episode,
        summary: '这一集有内容可以拆',
      })),
    }
    const test = harness(doc)

    await test.controller.runBreakdown()

    expect(test.completeWithTools).not.toHaveBeenCalled()
    expect(test.applied).toEqual([])
    expect(test.breakStates.at(-1)).toBe('error')
    expect(test.breakMessages.at(-1)).toContain('还没有可用的对话模型')
  })

  it('查重没有对话模型时明确提示，不发起空请求', async () => {
    const test = harness(emptyStoryboard('p1'))

    await test.controller.scanMerges()

    expect(test.completeWithTools).not.toHaveBeenCalled()
    expect(test.mergeStates.at(-1)).toEqual({
      kind: 'error',
      text: '没有可用的对话模型 —— 先去「设置 → 模型服务」给一条服务勾上对话模型',
    })
  })
})
