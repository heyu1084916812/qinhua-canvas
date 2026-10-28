import { describe, expect, it } from 'vitest'
import {
  AGENT_QUEUE_LIMIT,
  enqueueAgentTurn,
  normalizeQueuedTurns,
  queuedTurnPreview,
  removeAgentTurn,
  sessionForQueuedTurn,
  takeNextAgentTurn,
  updateAgentTurnText,
  type QueuedAgentTurn,
} from './queuedTurn'

function turn(id: string, text = `任务 ${id}`): QueuedAgentTurn {
  return {
    id,
    text,
    createdAt: Number(id),
    channelId: 'channel-a',
    model: 'chat-a',
  }
}

describe('Agent 待执行回合', () => {
  it('旧数据和坏数据不会拖垮整个队列', () => {
    expect(normalizeQueuedTurns(undefined)).toEqual([])
    expect(normalizeQueuedTurns([
      turn('1'),
      turn('1'),
      { id: 'bad' },
      null,
      { ...turn('2'), pendingAssetIds: ['a', 'a', '', 3] },
    ])).toEqual([
      turn('1'),
      expect.objectContaining({ id: '2', pendingAssetIds: ['a'] }),
    ])
  })

  it('空任务不能入队，达到上限后拒绝继续堆积', () => {
    expect(enqueueAgentTurn([], turn('1', '   '))).toMatchObject({ ok: false, reason: 'empty' })
    const full = Array.from({ length: AGENT_QUEUE_LIMIT }, (_, i) => turn(String(i)))
    expect(enqueueAgentTurn(full, turn('new'))).toMatchObject({ ok: false, reason: 'full' })
  })

  it('FIFO 取出下一项，且删除指定项不影响其他任务', () => {
    const queued = [turn('1'), turn('2'), turn('3')]
    expect(takeNextAgentTurn(queued)).toEqual({
      turn: queued[0],
      turns: [queued[1], queued[2]],
    })
    expect(removeAgentTurn(queued, '2').map((item) => item.id)).toEqual(['1', '3'])
  })

  it('编辑排队消息只改正文，不改位置和冻结设置', () => {
    const queued = [
      { ...turn('1', '旧文案'), imageModel: 'image-a' },
      turn('2'),
    ]
    expect(updateAgentTurnText(queued, '1', '  新文案  ')).toEqual([
      { ...turn('1', '新文案'), imageModel: 'image-a' },
      turn('2'),
    ])
    expect(updateAgentTurnText(queued, '1', '   ')).toEqual(queued)
  })

  it('★★ 真正执行时使用入队时冻结的模型、技能和素材引用', () => {
    const session = {
      channelId: 'new-channel',
      model: 'new-model',
      imageModel: 'new-image',
      skillId: 'new-skill',
      autoRun: true,
      pendingAssetIds: ['new-asset'],
    }
    const queued = {
      ...turn('1'),
      imageModel: 'queued-image',
      skillId: 'queued-skill',
      pendingAssetIds: ['queued-asset'],
    }
    expect(sessionForQueuedTurn(session, queued)).toMatchObject({
      channelId: 'channel-a',
      model: 'chat-a',
      imageModel: 'queued-image',
      skillId: 'queued-skill',
      autoRun: false,
      pendingAssetIds: ['queued-asset'],
    })
  })

  it('队列预览不带内部 mention token，并限制长度', () => {
    expect(queuedTurnPreview('@[主图](node:node_1) 生成一张产品图')).toBe('生成一张产品图')
    expect(queuedTurnPreview('abcdef', 3)).toBe('abc…')
  })
})
