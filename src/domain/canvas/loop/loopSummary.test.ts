import { describe, it, expect } from 'vitest'
import { loopSummary } from './loopSummary'

/**
 * 「这套参数实际会怎么跑」的说明文字（用户 2026-09-23）。
 *
 * 这是本轮补上的关键信息：循环节点的三个数字（起始 / 次数 / 批次）互相配合，
 * 但界面上它们只是三个孤立的小方框，用户看不出关系。这一组把「翻译规则」钉死，
 * 免得以后改文案时把某档漏掉。
 *
 * 用法与 `expandLoopRounds` 的语义必须一致：素材切片（取完就没有）、
 * 起始越界则空跑、最后一轮不足 batch 也算一轮。
 */

const base = {
  count: 2,
  loopStart: 1,
  batch: 1,
  useImageInput: true,
  usePrompt: false,
}

describe('loopSummary · 把参数翻译成人话', () => {
  it('★ 批次 1、起始 2、2 轮 → 「跑 2 轮：第 2–3 张」', () => {
    const s = loopSummary({ ...base, loopStart: 2, count: 2 }, { images: 6, prompts: 0 })
    expect(s.tone).toBe('ok')
    expect(s.text).toBe('跑 2 轮：第 2–3 张')
  })

  it('单轮时不写区间，直接「第 2 张」', () => {
    const s = loopSummary({ ...base, loopStart: 2, count: 1 }, { images: 6, prompts: 0 })
    expect(s.text).toBe('跑 1 轮：第 2 张')
  })

  it('★ 批次大于 1 时说清「每轮几张」与首尾区间', () => {
    const s = loopSummary({ ...base, loopStart: 1, count: 2, batch: 3 }, { images: 6, prompts: 0 })
    expect(s.tone).toBe('ok')
    expect(s.text).toContain('每轮 3 张')
    expect(s.text).toContain('第 1–3 张')
    expect(s.text).toContain('第 4–6 张')
  })

  it('★ 上游素材不够跑满设定的轮数 → warn，并说出实际能跑几轮', () => {
    // 上游 4 张、起始 2、每轮 1 张 ⇒ 只剩 3 张，跑不满 5 轮
    const s = loopSummary({ ...base, loopStart: 2, count: 5 }, { images: 4, prompts: 0 })
    expect(s.tone).toBe('warn')
    expect(s.text).toBe('素材只够跑 3 轮（设了 5 轮）')
  })

  it('★ 最后一轮不足 batch 也算一轮（与 expandLoopRounds 的切片一致）', () => {
    // 上游 5 张、每轮 2 张 ⇒ 能覆盖第 1-2 / 3-4 / 5 张共 3 轮（ceil(5/2)）
    const s = loopSummary({ ...base, loopStart: 1, count: 3, batch: 2 }, { images: 5, prompts: 0 })
    expect(s.tone).toBe('ok')
    expect(s.text).toContain('跑 3 轮')
  })

  it('★ 起始超出上游素材数 → blocked（三个数字各自合法、组合起来跑空）', () => {
    const s = loopSummary({ ...base, loopStart: 9, count: 2 }, { images: 6, prompts: 0 })
    expect(s.tone).toBe('blocked')
    expect(s.text).toBe('起始 9 超过上游 6 张，没有可取的图')
  })

  it('上游没有图片 → blocked，指出去连上游', () => {
    const s = loopSummary(base, { images: 0, prompts: 0 })
    expect(s.tone).toBe('blocked')
    expect(s.text).toBe('上游还没有图片')
  })

  it('★ 两个通道都关掉 → blocked，说明打开才能跑', () => {
    const s = loopSummary({ ...base, useImageInput: false, usePrompt: false }, { images: 6, prompts: 3 })
    expect(s.tone).toBe('blocked')
    expect(s.text).toBe('两个通道都关着，打开后才能运行')
  })

  it('只开提示词：提示词是按轮次轮换的，不必担心「不够」', () => {
    const s = loopSummary(
      { ...base, useImageInput: false, usePrompt: true, prompts: ['a', 'b'], count: 9 },
      { images: 0, prompts: 0 },
    )
    expect(s.tone).toBe('ok')
    expect(s.text).toBe('跑 9 轮，提示词按轮次轮换')
  })

  it('只开提示词但没有可用提示词 → blocked', () => {
    const s = loopSummary(
      { ...base, useImageInput: false, usePrompt: true, prompts: ['  '] },
      { images: 0, prompts: 0 },
    )
    expect(s.tone).toBe('blocked')
    expect(s.text).toBe('还没有可用的提示词')
  })

  it('提示词数量把上游与本节点的都算上', () => {
    const s = loopSummary(
      { ...base, useImageInput: false, usePrompt: true, prompts: ['x'] },
      { images: 0, prompts: 2 },
    )
    expect(s.tone).toBe('ok')
  })

  it('两个通道都开：摘要以图片为主（提示词轮换是默认行为，不必重复说）', () => {
    const s = loopSummary(
      { ...base, usePrompt: true, loopStart: 2, count: 2, prompts: ['a'] },
      { images: 6, prompts: 1 },
    )
    expect(s.tone).toBe('ok')
    expect(s.text).toBe('跑 2 轮：第 2–3 张')
  })

  it('参数越界时先归一化再算（count=0 当作 1 轮）', () => {
    const s = loopSummary({ ...base, count: 0 }, { images: 6, prompts: 0 })
    expect(s.text).toBe('跑 1 轮：第 1 张')
  })
})
