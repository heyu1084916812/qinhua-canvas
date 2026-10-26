import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type {
  StoryboardRunPlan,
  StoryboardRunTask,
} from '../../../domain/storyboard/runTypes'
import type { GeneratedAsset } from '../../../platform/channels/types'
import type { CollectedAsset } from '../../shared/execution/placement'
import { createStoryboardPlacement } from './storyboardPlacement'

function task(): StoryboardRunTask {
  return {
    id: 'plan:shot-video:shot-1',
    nodeId: 'shot:shot-1',
    planId: 'plan-1',
    workbench: 'storyboard',
    operationId: 'op-1',
    action: 'shot-video',
    subject: {
      kind: 'shot-video',
      id: 'shot:shot-1',
      scopeId: 'episode:ep-1',
      episodeId: 'ep-1',
      shotId: 'shot-1',
    },
    request: {
      kind: 'video',
      channelId: 'channel-1',
      model: 'model-1',
      prompt: '镜头运动',
      inputs: [],
      params: { durationSec: 5 },
    },
    dependsOn: [],
    fingerprint: 'fp-1',
    params: { durationSec: 5 },
  }
}

const asset: GeneratedAsset = {
  hash: 'asset-1',
  mime: 'video/mp4',
  bytes: new Uint8Array([1, 2, 3]),
}

describe('StoryboardPlacement', () => {
  it('落点是业务 subject，commit 命令不包含画布节点类型', () => {
    const placement = createStoryboardPlacement('project-1')
    const input = task()
    const begin = placement.begin(input, {
      isRepeat: false,
      slotIndex: 0,
      slotCount: 1,
    })
    expect(begin).toEqual({ targetId: 'shot:shot-1', commands: [] })

    const commands = placement.commit(input, begin.targetId, [asset])
    expect(commands).toEqual([
      {
        kind: 'storyboard.commit',
        planId: 'plan-1',
        taskId: 'plan:shot-video:shot-1',
        projectId: 'project-1',
        action: 'shot-video',
        subject: input.subject,
        assets: [asset],
        metadata: {
          prompt: '镜头运动',
          model: 'model-1',
          params: { durationSec: 5 },
        },
      },
    ])
    expect(commands[0]).not.toHaveProperty('nodeId')
    expect(JSON.stringify(commands[0])).not.toContain('node.create')
    expect(JSON.stringify(commands[0])).not.toContain('node.updateData')
  })

  it('记录与投影也走漫剧中性别名', () => {
    const placement = createStoryboardPlacement('project-1')
    const input = task()
    const record = {
      id: 'record-1',
      nodeId: 'shot:shot-1',
    } as RunRecord
    expect(placement.record(input, input.subject.id, record)).toEqual({
      kind: 'runRecord.finalize',
      planId: 'plan-1',
      taskId: input.id,
      record,
    })
    const plan: StoryboardRunPlan = {
      id: 'plan-1',
      workbench: 'storyboard',
      tasks: [input],
      scope: 'node',
      mode: 'single',
    }
    expect(placement.finalize(plan, [] as CollectedAsset[])).toEqual([
      {
        kind: 'storyboard.projection.sync',
        planId: 'plan-1',
        taskIds: [input.id],
        projectId: 'project-1',
      },
    ])
  })
})
