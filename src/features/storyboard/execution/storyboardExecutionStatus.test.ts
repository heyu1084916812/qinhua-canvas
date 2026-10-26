import { beforeEach, describe, expect, it } from 'vitest'
import type {
  StoryboardRunPlan,
  StoryboardRunTask,
} from '../../../domain/storyboard/runTypes'
import {
  beginStoryboardExecutionPlan,
  clearStoryboardExecutionStatus,
  failStoryboardExecutionPlan,
  finishStoryboardExecutionPlan,
  runningStoryboardPlanIds,
  subjectStateOf,
  updateStoryboardExecutionTask,
} from './storyboardExecutionStatus'

function task(
  planId: string,
  action: 'shot-image' | 'shot-video',
): StoryboardRunTask {
  return {
    id: `${planId}:${action}:shot:shot-1`,
    nodeId: 'shot:shot-1',
    planId,
    workbench: 'storyboard',
    operationId: `op:${planId}`,
    action,
    subject: {
      kind: 'shot-image',
      id: 'shot:shot-1',
      scopeId: 'episode:episode-1',
      episodeId: 'episode-1',
      shotId: 'shot-1',
    },
    request: {
      kind: 'image',
      channelId: 'channel-1',
      model: 'image-1',
      prompt: 'prompt',
      inputs: [],
      params: {},
    },
    dependsOn: [],
    fingerprint: `${planId}:${action}`,
    params: {
      action,
      episodeId: 'episode-1',
      shotId: 'shot-1',
    },
  }
}

function plan(id: string, action: 'shot-image' | 'shot-video'): StoryboardRunPlan {
  return {
    id,
    workbench: 'storyboard',
    tasks: [task(id, action)],
    scope: 'node',
    mode: 'single',
  }
}

describe('storyboard execution status', () => {
  beforeEach(() => clearStoryboardExecutionStatus())

  it('keeps status by business subject and action across provider remounts', () => {
    const imagePlan = plan('plan-image', 'shot-image')
    beginStoryboardExecutionPlan('project-1', imagePlan)
    updateStoryboardExecutionTask(
      'project-1',
      imagePlan.id,
      imagePlan.tasks[0]!.id,
      { kind: 'running', startedAt: 1 },
    )

    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toEqual({ kind: 'running', startedAt: 1 })
    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-video'),
    ).toBeUndefined()
    expect(runningStoryboardPlanIds('project-1')).toEqual(['plan-image'])

    finishStoryboardExecutionPlan('project-1', 'plan-image')

    expect(runningStoryboardPlanIds('project-1')).toEqual([])
    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toEqual({ kind: 'running', startedAt: 1 })
  })

  it('does not let an older plan overwrite a newer subject status', () => {
    const older = plan('plan-old', 'shot-image')
    const newer = plan('plan-new', 'shot-image')
    beginStoryboardExecutionPlan('project-1', older)
    beginStoryboardExecutionPlan('project-1', newer)

    updateStoryboardExecutionTask(
      'project-1',
      older.id,
      older.tasks[0]!.id,
      { kind: 'canceled' },
    )

    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toEqual({ kind: 'queued' })
  })

  it('marks only pending preflight tasks as failed', () => {
    const imagePlan = plan('plan-image', 'shot-image')
    beginStoryboardExecutionPlan('project-1', imagePlan)
    failStoryboardExecutionPlan('project-1', imagePlan.id, {
      kind: 'channel',
      detail: 'missingKey',
    })

    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toMatchObject({ kind: 'failed', attempts: 0 })
  })

  it('isolates project, subject, and action so canvas-originated state cannot alias storyboard state', () => {
    beginStoryboardExecutionPlan('project-1', plan('plan-image', 'shot-image'))

    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toEqual({ kind: 'queued' })
    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-video'),
    ).toBeUndefined()
    expect(
      subjectStateOf('project-2', 'shot:shot-1', 'shot-image'),
    ).toBeUndefined()
  })

  it('keeps the chosen module store until an explicit clear, matching provider remount semantics', () => {
    const imagePlan = plan('plan-image', 'shot-image')
    beginStoryboardExecutionPlan('project-1', imagePlan)
    updateStoryboardExecutionTask(
      'project-1',
      imagePlan.id,
      imagePlan.tasks[0]!.id,
      { kind: 'running', startedAt: 1 },
    )
    finishStoryboardExecutionPlan('project-1', imagePlan.id)

    // A remount reads the same chosen store instance.
    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toEqual({ kind: 'running', startedAt: 1 })

    clearStoryboardExecutionStatus('project-1')
    expect(
      subjectStateOf('project-1', 'shot:shot-1', 'shot-image'),
    ).toBeUndefined()
  })
})
