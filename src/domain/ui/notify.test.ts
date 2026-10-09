import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFY_PREFS,
  imageCountOf,
  notifyPrefsFrom,
  progressNotice,
  runNotice,
  shouldNotify,
} from './notify'

/**
 * 通知偏好（对账 #386 的 E5）。
 *
 * 这一组钉三件事：**默认值**（升级不改变老用户听到的东西）、
 * **脏数据只补那一项**、以及**完成 / 失败 / 进度各自的文案边界**。
 */
describe('通知偏好 · 读回与默认值', () => {
  it('★ 默认：完成 / 失败开，批量进度关（20 张弹 20 条比不弹还吵）', () => {
    expect(DEFAULT_NOTIFY_PREFS).toEqual({ success: true, failure: true, progress: false })
  })

  it('★ 缺行 / 非对象 → 整份默认，不抛', () => {
    for (const raw of [undefined, null, 0, 'x', []]) {
      expect(notifyPrefsFrom(raw)).toEqual(DEFAULT_NOTIFY_PREFS)
    }
  })

  it('★★ 脏值只补**那一项**：合法的另一项要留住（不许整份回落）', () => {
    expect(notifyPrefsFrom({ success: false, progress: 'yes', extra: 1 })).toEqual({
      success: false,
      failure: true,
      progress: false,
    })
  })

  it('★ 全关是合法状态（用户有权把提示全关掉）', () => {
    const prefs = notifyPrefsFrom({ success: false, failure: false, progress: false })
    expect(shouldNotify(prefs, 'success')).toBe(false)
    expect(shouldNotify(prefs, 'failure')).toBe(false)
    expect(shouldNotify(prefs, 'progress')).toBe(false)
  })
})

describe('通知文案 · 一趟跑完说什么', () => {
  it('★★ 出图且没有失败 → 完成，且张数是**图数**不是任务数', () => {
    expect(runNotice({ images: 4, failed: 0 })).toEqual({ kind: 'success', text: '生成完成：4 张' })
  })

  it('★★ 部分失败 → 走失败档，两个数都报（只报一个都会让人误解）', () => {
    const notice = runNotice({ images: 2, failed: 1 })
    expect(notice?.kind).toBe('failure')
    expect(notice?.text).toContain('2')
    expect(notice?.text).toContain('1')
  })

  it('★ 全失败 → 失败档，不带"成功 0 张"这种多余的话', () => {
    const notice = runNotice({ images: 0, failed: 3 })
    expect(notice?.kind).toBe('failure')
    expect(notice?.text).not.toContain('成功')
  })

  it('★ 什么都没有（用户自己取消 / 空跑）→ 闭嘴，不打扰', () => {
    expect(runNotice({ images: 0, failed: 0 })).toBeNull()
  })

  it('★ 脏数字（负数 / 小数）不许进文案', () => {
    expect(runNotice({ images: -1, failed: 0 })).toBeNull()
    expect(runNotice({ images: 2.7, failed: 0 })?.text).toContain('2')
  })
})

describe('通知文案 · 批量进度', () => {
  it('★ 单任务不叫批量：不说话', () => {
    expect(progressNotice(1, 1)).toBeNull()
  })

  it('★★ 最后一条让位给完成 / 失败通知（提示位只有一个，两条挨着弹等于前一条白弹）', () => {
    expect(progressNotice(3, 3)).toBeNull()
  })

  it('★ 中间过程报"已完成 / 总数"', () => {
    expect(progressNotice(2, 5)).toEqual({ kind: 'progress', text: '批量进度：2/5' })
  })

  it('★ 越界值（0 / 超过总数）不报', () => {
    expect(progressNotice(0, 5)).toBeNull()
    expect(progressNotice(6, 5)).toBeNull()
  })
})

describe('出图张数 · 从任务结果数出来', () => {
  it('★★ 只数 succeeded，且按 result 的张数累加（count=4 就是 4 张）', () => {
    const images = imageCountOf([
      { state: { kind: 'succeeded', result: [{}, {}, {}, {}] } },
      { state: { kind: 'failed' } },
      { state: { kind: 'canceled' } },
      { state: { kind: 'succeeded', result: [{}] } },
    ])
    expect(images).toBe(5)
  })

  it('★ 成功但结果是空的（协议返回 0 张）→ 计 0，不虚报', () => {
    expect(imageCountOf([{ state: { kind: 'succeeded', result: [] } }])).toBe(0)
  })
})
