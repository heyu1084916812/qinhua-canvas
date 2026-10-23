import { describe, expect, it } from 'vitest'
import { tasksAffectedByChannelRemoval } from './channelRemoval'

describe('tasksAffectedByChannelRemoval', () => {
  it('只命中实际使用被删渠道的任务，不按模型名误伤同模型的其他渠道', () => {
    const tasks = new Map([
      ['t1', 'deleted-channel'],
      ['t2', 'same-model-other-channel'],
      ['t3', 'deleted-channel'],
    ])

    expect(tasksAffectedByChannelRemoval(tasks, new Set(['deleted-channel']))).toEqual([
      { taskId: 't1', channelId: 'deleted-channel' },
      { taskId: 't3', channelId: 'deleted-channel' },
    ])
  })

  it('没有命中时不返回任务，删除无关渠道不会停掉正在运行的计划', () => {
    expect(
      tasksAffectedByChannelRemoval(
        new Map([
          ['t1', 'channel-a'],
          ['t2', 'channel-b'],
        ]),
        new Set(['channel-c']),
      ),
    ).toEqual([])
  })
})
