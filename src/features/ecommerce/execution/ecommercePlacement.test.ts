import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import { createEcommercePlacement } from './ecommercePlacement'
import type { EcommerceRunTask } from './ecommerceRunPlan'

const task: EcommerceRunTask = {
  id: 'task_1',
  nodeId: 'ecr_1',
  planId: 'ecommerce:ect_1:run',
  taskId: 'ect_1',
  resultId: 'ecr_1',
  request: {
    kind: 'image',
    channelId: 'ch_1',
    model: 'model_1',
    prompt: 'prompt',
    inputs: [],
    params: {},
  },
  dependsOn: [],
  fingerprint: 'fp',
  params: {},
  seq: 0,
}

const record = (status: RunRecord['status'], errorText?: string): RunRecord => ({
  id: 'rec_1',
  nodeId: task.resultId,
  projectId: 'p1',
  version: 1,
  createdAt: 1,
  status,
  inputs: [],
  params: {},
  outputHashes: [],
  fingerprint: task.fingerprint,
  taskId: task.id,
  durationMs: 1,
  ...(errorText ? { errorText } : {}),
})

describe('EcommercePlacement', () => {
  it('开始执行只标记结果行 running，不创建画布节点', () => {
    const placement = createEcommercePlacement('p1')
    const begun = placement.begin(task, {
      isRepeat: false,
      slotIndex: 0,
      slotCount: 1,
    })
    expect(begun).toEqual({
      targetId: 'ecr_1',
      commands: [
        {
          kind: 'result.status',
          planId: 'ecommerce:ect_1:run',
          resultId: 'ecr_1',
          status: 'running',
        },
      ],
    })
    expect(placement.shouldCollect(task, [])).toBe(false)
  })

  it('成功产物写结果行，RUN 记录单独追加，计划结束只同步投影', () => {
    const placement = createEcommercePlacement('p1')
    const asset = { hash: 'asset_1', mime: 'image/png', bytes: new Uint8Array([1]) }
    expect(placement.commit(task, 'ecr_1', [asset])).toEqual([
      {
        kind: 'result.commit',
        planId: 'ecommerce:ect_1:run',
        resultId: 'ecr_1',
        prompt: 'prompt',
        model: 'model_1',
        assets: [asset],
      },
    ])
    expect(placement.record(task, 'ecr_1', record('succeeded'))).toEqual({
      kind: 'runRecord.finalize',
      planId: 'ecommerce:ect_1:run',
      record: record('succeeded'),
      resultId: 'ecr_1',
    })
    expect(placement.finalize({ id: 'plan', tasks: [task], scope: 'global', mode: 'single' }, []))
      .toEqual([
        {
          kind: 'projection.sync',
          planId: 'plan',
          projectId: 'p1',
          taskId: 'ect_1',
        },
      ])
  })

  it('失败或取消先留 RunRecord，再把真实状态写回结果行', () => {
    const placement = createEcommercePlacement('p1')
    expect(placement.record(task, 'ecr_1', record('failed', '服务端原文'))).toEqual({
      kind: 'runRecord.finalize',
      planId: 'ecommerce:ect_1:run',
      record: record('failed', '服务端原文'),
      resultId: 'ecr_1',
      status: 'failed',
      errorText: '服务端原文',
    })
    expect(placement.record(task, 'ecr_1', record('canceled'))).toEqual({
      kind: 'runRecord.finalize',
      planId: 'ecommerce:ect_1:run',
      record: record('canceled'),
      resultId: 'ecr_1',
      status: 'canceled',
    })
  })
})
