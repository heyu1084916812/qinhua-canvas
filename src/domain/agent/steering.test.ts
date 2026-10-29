import { describe, expect, it } from 'vitest'
import {
  AGENT_STEER_LIMIT,
  enqueueAgentSteer,
  normalizeAgentSteers,
  removeAgentSteers,
  steerMessagesOf,
  type AgentSteer,
} from './steering'

const steer = (id: string, text = '改成横版'): AgentSteer => ({
  id,
  text,
  createdAt: 1,
  imageNodeIds: ['node-a'],
})

describe('agent steering', () => {
  it('normalizes old and malformed rows without dropping valid steers', () => {
    expect(
      normalizeAgentSteers([
        { id: 'a', text: ' 补充要求 ', createdAt: 3, imageNodeIds: ['n', 'n', 1] },
        { id: '', text: 'bad' },
        null,
      ]),
    ).toEqual([
      {
        id: 'a',
        text: '补充要求',
        createdAt: 3,
        imageNodeIds: ['n'],
      },
    ])
  })

  it('caps the queue and rejects blank guidance', () => {
    let steers: AgentSteer[] = []
    for (let index = 0; index < AGENT_STEER_LIMIT; index += 1) {
      const result = enqueueAgentSteer(steers, steer(`s-${index}`))
      expect(result.ok).toBe(true)
      if (result.ok) steers = result.steers
    }
    expect(enqueueAgentSteer(steers, steer('overflow')).ok).toBe(false)
    expect(enqueueAgentSteer([], steer('blank', '   ')).ok).toBe(false)
  })

  it('removes only delivered steers and preserves message display markup', () => {
    const remaining = removeAgentSteers(
      [steer('a', '@[节点](node:node-a) 改成横版'), steer('b')],
      ['a'],
    )
    expect(remaining.map((item) => item.id)).toEqual(['b'])
    expect(
      steerMessagesOf(
        [steer('a', '@[节点](node:node-a) 改成横版')],
        () => '节点 改成横版',
      ),
    ).toEqual([
      {
        role: 'user',
        createdAt: 1,
        content: '节点 改成横版',
        display: '@[节点](node:node-a) 改成横版',
        imageNodeIds: ['node-a'],
      },
    ])
  })
})
