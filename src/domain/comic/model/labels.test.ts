import { describe, it, expect } from 'vitest'
import {
  BALLOON_TYPES,
  PANEL_TRANSITIONS,
  SHOT_ANGLES,
  SHOT_FRAMINGS,
} from './comicProject'
import { RUN_STATUSES } from '../../shared/execution/types'
import {
  BALLOON_TYPE_LABELS,
  PANEL_RUN_STATUS_LABELS,
  PANEL_TRANSITION_LABELS,
  SHOT_ANGLE_LABELS,
  SHOT_FRAMING_LABELS,
} from './labels'

/**
 * 标签与词表是「同一份封闭枚举的两面」——这里把这条不变量钉死：
 * 每个词表成员都要有非空标签，且**不多不少**（多出的键说明词表删过成员而标签没跟着删）。
 */
function assertComplete<T extends string>(
  vocab: readonly T[],
  labels: Record<T, string>,
  name: string,
) {
  for (const key of vocab) {
    expect(labels[key], `${name} 缺标签：${key}`).toBeTruthy()
    expect(labels[key].trim(), `${name} 标签为空：${key}`).not.toBe('')
  }
  expect(Object.keys(labels).sort(), `${name} 有多余键`).toEqual([...vocab].sort())
}

describe('comic labels / 词表标签完备', () => {
  it('对白类型', () => assertComplete(BALLOON_TYPES, BALLOON_TYPE_LABELS, '对白类型'))
  it('景别', () => assertComplete(SHOT_FRAMINGS, SHOT_FRAMING_LABELS, '景别'))
  it('机位角度', () => assertComplete(SHOT_ANGLES, SHOT_ANGLE_LABELS, '机位角度'))
  it('转场', () => assertComplete(PANEL_TRANSITIONS, PANEL_TRANSITION_LABELS, '转场'))
  // 留痕状态的词表在共享执行词里（comic 只是它的第二个消费者），故从这里取
  it('留痕状态', () => assertComplete(RUN_STATUSES, PANEL_RUN_STATUS_LABELS, '留痕状态'))
})
