import { describe, expect, it } from 'vitest'
import { loopImageStatusText } from './loopImageStatus'

describe('loopImageStatusText', () => {
  it('没有上游图片时提示没有可用图片', () => {
    expect(loopImageStatusText({ upstreamImages: 0, willOutput: 0, loopStart: 1 })).toBe(
      '上游没有可用的图片',
    )
  })

  it('有可输出图片时提示当前输出数量', () => {
    expect(loopImageStatusText({ upstreamImages: 3, willOutput: 2, loopStart: 1 })).toBe(
      '当前会输出 2 张图片',
    )
  })

  it('有上游图片但起始越界时说明真实原因', () => {
    expect(loopImageStatusText({ upstreamImages: 2, willOutput: 0, loopStart: 8 })).toBe(
      '无可取图片：起始 8 / 共 2 张',
    )
  })
})
