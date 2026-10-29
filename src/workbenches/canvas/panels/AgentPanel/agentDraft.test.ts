import { describe, expect, it } from 'vitest'
import {
  clearAgentDraft,
  draftNodeIds,
  loadAgentDraft,
  pendingAssetIdsAfterDraft,
  saveAgentDraft,
  type AgentDraftStorage,
} from './agentDraft'

function memoryStorage(): AgentDraftStorage {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
  }
}

describe('Agent composer draft persistence', () => {
  it('restores text after the panel unmounts, including an intentionally empty draft', () => {
    const storage = memoryStorage()
    saveAgentDraft('session-1', '保留这段文字', storage)
    expect(loadAgentDraft('session-1', storage)).toBe('保留这段文字')

    saveAgentDraft('session-1', '', storage)
    expect(loadAgentDraft('session-1', storage)).toBe('')

    clearAgentDraft('session-1', storage)
    expect(loadAgentDraft('session-1', storage)).toBeNull()
  })

  it('reads image references from the current draft only', () => {
    const text =
      '@[旧图片](node:img-old) 开头 @[工作流](node:node-flow) @[新图片](node:img-new)'
    expect(draftNodeIds(text)).toEqual(['img-old', 'node-flow', 'img-new'])
    expect(pendingAssetIdsAfterDraft(['img-old', 'img-new'], text)).toEqual([
      'img-old',
      'img-new',
    ])
    expect(pendingAssetIdsAfterDraft(['img-old', 'img-new'], '只输入文字')).toEqual([])
  })
})
