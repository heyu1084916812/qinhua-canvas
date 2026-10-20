import { beforeEach, describe, expect, it } from 'vitest'
import {
  acquireEcommerceTaskLease,
  hasEcommerceTaskLease,
  releaseEcommerceTaskLease,
  resetEcommerceTaskLeasesForTest,
} from './taskLease'

describe('电商任务租约', () => {
  beforeEach(() => resetEcommerceTaskLeasesForTest())

  it('任务执行期间切换页面仍保持 active', () => {
    acquireEcommerceTaskLease('task-1')
    expect(hasEcommerceTaskLease('task-1')).toBe(true)
    releaseEcommerceTaskLease('task-1')
    expect(hasEcommerceTaskLease('task-1')).toBe(false)
  })

  it('空 id 不产生租约，重复释放安全', () => {
    acquireEcommerceTaskLease('')
    expect(hasEcommerceTaskLease('')).toBe(false)
    releaseEcommerceTaskLease('missing')
    expect(hasEcommerceTaskLease('missing')).toBe(false)
  })
})
