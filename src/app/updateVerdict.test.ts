import { describe, it, expect } from 'vitest'
import { describeUpdate, shouldNotify, type UpdateVerdict } from './updateVerdict'
import type { UpdateStatus } from '../platform/ports'

function status(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return { state: 'up-to-date', current: '0.1.0', version: null, notes: null, error: null, ...over }
}

describe('describeUpdate', () => {
  it('有新版：两个版本号都说清楚，并给「重启并更新」', () => {
    const v = describeUpdate(status({ state: 'available', version: '0.2.0' }))
    expect(v.tone).toBe('info')
    expect(v.text).toContain('0.2.0')
    expect(v.text).toContain('0.1.0')
    expect(v.action).toBe('install')
  })

  it('已是最新：安心话，不给按钮', () => {
    const v = describeUpdate(status())
    expect(v.tone).toBe('ok')
    expect(v.text).toContain('0.1.0')
    expect(v.action).toBeNull()
  })

  it('★ 没配更新地址：说的是"还没接"，不许说成"失败"', () => {
    // 这两件事用户能做的完全不同：一个是"我们还没接完"，一个是"你网络有问题"
    const v = describeUpdate(status({ state: 'not-configured' }))
    expect(v.tone).toBe('warn')
    expect(v.action).toBeNull()
    expect(v.text).not.toContain('失败')
  })

  it('失败：带原话，不吞', () => {
    const v = describeUpdate(status({ state: 'failed', error: 'connection refused' }))
    expect(v.tone).toBe('error')
    expect(v.text).toContain('connection refused')
  })

  it('失败但没给原因：也要说得出话（不出现 undefined）', () => {
    const v = describeUpdate(status({ state: 'failed' }))
    expect(v.text).not.toContain('undefined')
  })
})

describe('shouldNotify', () => {
  const verdict = (over: Partial<UpdateVerdict> = {}): UpdateVerdict => ({
    tone: 'ok',
    text: 'x',
    action: null,
    ...over,
  })

  it('★ 启动时静默查：只有"真有新版"才弹（每次开应用都弹"已是最新"，三天就烦）', () => {
    expect(shouldNotify(verdict({ action: 'install' }), 'auto')).toBe(true)
    expect(shouldNotify(verdict(), 'auto')).toBe(false)
    expect(shouldNotify(verdict({ tone: 'warn' }), 'auto')).toBe(false)
    expect(shouldNotify(verdict({ tone: 'error' }), 'auto')).toBe(false)
  })

  it('★ 用户自己点的：四档都要给说法（点了没反应 = 以为按钮坏了）', () => {
    expect(shouldNotify(verdict(), 'manual')).toBe(true)
    expect(shouldNotify(verdict({ tone: 'warn' }), 'manual')).toBe(true)
    expect(shouldNotify(verdict({ tone: 'error' }), 'manual')).toBe(true)
  })
})
