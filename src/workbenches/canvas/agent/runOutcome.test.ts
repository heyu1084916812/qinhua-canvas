import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../../../domain/canvas/model/runRecord'
import { agentRunOutcomeOf } from './runOutcome'

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: 'r1',
    nodeId: 'n1',
    projectId: 'p1',
    version: 1,
    createdAt: 1,
    status: 'succeeded',
    inputs: [],
    params: {},
    outputHashes: [],
    fingerprint: 'f',
    taskId: 't',
    durationMs: 1,
    ...overrides,
  }
}

describe('agentRunOutcomeOf', () => {
  it('成功记录回报 ok:true，并带上实际渠道与模型', () => {
    expect(
      agentRunOutcomeOf(
        [record({ id: 'new', sentChannelId: 'ch-a', sentModel: 'gpt-image-2.5' })],
        'n1',
        new Set(['old']),
      ),
    ).toEqual({
      nodeId: 'n1',
      ok: true,
      status: 'succeeded',
      channelId: 'ch-a',
      model: 'gpt-image-2.5',
    })
  })

  it('失败记录回报 ok:false，并把可读原因带出来', () => {
    expect(
      agentRunOutcomeOf(
        [
          record({
            id: 'new',
            status: 'failed',
            errorText: '服务端返回错误（HTTP 451）：识别到您当前网络处于暂不支持的地区',
            sentChannelId: 'ch-comfly',
            sentModel: 'gpt-image-2.5-sunburst',
          }),
        ],
        'n1',
        new Set(),
      ),
    ).toEqual({
      nodeId: 'n1',
      ok: false,
      status: 'failed',
      error: '服务端返回错误（HTTP 451）：识别到您当前网络处于暂不支持的地区',
      channelId: 'ch-comfly',
      model: 'gpt-image-2.5-sunburst',
    })
  })

  it('只认这次新写入的记录，旧记录不能冒充成功', () => {
    expect(
      agentRunOutcomeOf(
        [record({ id: 'old', status: 'succeeded' })],
        'n1',
        new Set(['old']),
      ),
    ).toEqual({ nodeId: 'n1', ok: false, error: '这次运行没有留下记录，无法确认是否出图' })
  })

  it('执行层没有留下记录时，优先回报真实前置阻塞原因', () => {
    expect(
      agentRunOutcomeOf(
        [],
        'n1',
        new Set(),
        '「婴童泳圈三视图」无法运行：所选渠道已停用',
      ),
    ).toEqual({
      nodeId: 'n1',
      ok: false,
      error: '「婴童泳圈三视图」无法运行：所选渠道已停用',
    })
  })
})
