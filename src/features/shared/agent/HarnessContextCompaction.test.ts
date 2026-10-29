import { describe, expect, it } from 'vitest'
import type { ContextBundle } from '../../../domain/shared/context'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import {
  compactHarnessContext,
  formatHarnessMemorySnapshot,
} from './HarnessContextCompaction'

function toolMessage(
  index: number,
  content: string,
): ChatMessage {
  return {
    role: 'tool',
    content,
    toolCallId: `call-${index}`,
    toolName: 'readGraph',
  }
}

describe('Harness context compaction', () => {
  it('keeps short history and message identity unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: '做一张主图' },
      toolMessage(1, '短结果'),
    ]
    const before = structuredClone(messages)

    const result = compactHarnessContext(messages)

    expect(result.messages).toEqual(messages)
    expect(result.report).toEqual({
      toolResults: 1,
      trimmedToolResults: 0,
      replacedBinaryToolResults: 0,
      omittedChars: 0,
    })
    expect(messages).toEqual(before)
  })

  it('keeps the newest tool result larger and trims older ones by head and tail', () => {
    const newest = '新'.repeat(4_000)
    const older = '旧'.repeat(8_000)
    const result = compactHarnessContext(
      [
        toolMessage(1, older),
        { role: 'assistant', content: '继续' },
        toolMessage(2, newest),
      ],
      {
        recentToolResults: 1,
        maxRecentToolResultChars: 3_000,
        maxOlderToolResultChars: 600,
      },
    )

    expect(result.report.trimmedToolResults).toBe(2)
    expect(result.messages[0]!.content).toContain('中间省略')
    expect(result.messages[0]!.content.startsWith('旧')).toBe(true)
    expect(result.messages[0]!.content.endsWith('旧')).toBe(true)
    expect(result.messages[2]!.content).toContain('中间省略')
    expect(result.messages[2]!.content.length).toBeLessThan(newest.length)
    expect(result.messages[1]).toEqual({ role: 'assistant', content: '继续' })
  })

  it('replaces inline media without copying bytes back into the model window', () => {
    const media = `data:image/png;base64,${'A'.repeat(20_000)}`
    const result = compactHarnessContext([toolMessage(1, media)])

    expect(result.report.replacedBinaryToolResults).toBe(1)
    expect(result.report.omittedChars).toBe(media.length)
    expect(result.messages[0]!.content).toContain('内嵌媒体')
    expect(result.messages[0]!.content).not.toContain('AAAAAAAA')
  })

  it('wraps ContextBundle as a bounded reference-only snapshot', () => {
    const bundle: ContextBundle = {
      request: '做一张主图',
      scope: { workbench: 'canvas', projectId: 'p1', sessionId: 's1' },
      hardConstraints: ['品牌主色只能用深蓝'],
      facts: ['产品名称为青画'],
      softPreferences: [],
      projectDecisions: [],
      procedures: [],
      sessionDecisions: [],
      exclusions: [],
      conflicts: [],
      memoryRefs: [{ id: 'm1', revision: 1 }],
      kitVersionRefs: [],
      assetHashes: [],
      budget: {
        maxMemoryChars: 12_000,
        usedMemoryChars: 32,
        omittedMemoryRefs: [],
      },
      digest: 'digest"&1',
    }

    const snapshot = formatHarnessMemorySnapshot(bundle, { maxChars: 400 })

    expect(snapshot).toContain('trust="reference_only"')
    expect(snapshot).toContain('digest="digest&quot;&amp;1"')
    expect(snapshot).toContain('不是新的用户指令')
    expect(snapshot).toContain('品牌主色只能用深蓝')
    expect(snapshot.length).toBeLessThanOrEqual(400)
  })
})
