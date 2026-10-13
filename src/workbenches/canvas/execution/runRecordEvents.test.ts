import { describe, expect, it, vi } from 'vitest'
import { emitRunRecordChanged, subscribeRunRecordChanged } from './runRecordEvents'

describe('runRecordEvents', () => {
  it('订阅后能收到写入信号，退订后不再收到', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = subscribeRunRecordChanged(first)
    const offSecond = subscribeRunRecordChanged(second)

    emitRunRecordChanged()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    offFirst()
    emitRunRecordChanged()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    offSecond()
  })
})
