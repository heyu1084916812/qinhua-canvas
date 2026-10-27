import { describe, expect, it } from 'vitest'
import type { RunLogEntry } from '../../../state/shared/runLogRepository'
import {
  runLogPromptOf,
  runLogStatusLabel,
  runLogWorkbenchLabel,
} from './RunLogList'

const entry = (patch: Partial<RunLogEntry> = {}): RunLogEntry => ({
  scopeState: 'scoped',
  effectiveWorkbench: 'storyboard',
  record: {
    id: 'run-1',
    projectId: 'p1',
    nodeId: 'n1',
    status: 'failed',
    createdAt: 1,
    durationMs: 1200,
    inputs: [],
    outputHashes: [],
    taskId: 'task-1',
    params: { prompt: '镜头向前推进' },
    errorText: '上游超时',
    fingerprint: 'fp',
    version: 1,
    scopeVersion: 1,
    workbench: 'storyboard',
    action: 'shot-image',
    subjectId: 'shot-1',
    scopeId: 'episode-1',
    operationId: 'op-1',
  },
  ...patch,
})

describe('shared run log display', () => {
  it('工作台、状态与提示词都从真实记录派生', () => {
    expect(runLogWorkbenchLabel(entry())).toBe('漫剧工作台')
    expect(runLogStatusLabel(entry().record.status)).toBe('失败')
    expect(runLogPromptOf(entry())).toBe('镜头向前推进')
  })

  it('未分类记录不会被硬塞进某个工作台', () => {
    expect(
      runLogWorkbenchLabel(
        entry({
          scopeState: 'unclassified',
          effectiveWorkbench: undefined,
          reason: '项目缺失',
        }),
      ),
    ).toBe('未分类')
  })
})
