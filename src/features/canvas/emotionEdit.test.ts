import { describe, expect, it } from 'vitest'
import { faceBoxFromRect } from './emotionEdit'

/**
 * 手动框脸：灯箱的选区（**原图像素**）→ 节点上的人脸框（**归一化 0–1**）。
 *
 * 两个坐标各说各的：灯箱要「缩放平移时框跟着图走」，所以存原图像素；
 * 节点要「换尺寸、复制粘贴都不指错」，所以存比例。换算必须显式做一次，
 * 塞在组件里做就没人测得到 —— 而它算错的形态是「框看着没问题、位置整体偏一点」，
 * 那正是最难靠肉眼发现的一类。
 */
describe('faceBoxFromRect', () => {
  it('★ 像素矩形 → 归一化框（相对图片尺寸）', () => {
    expect(faceBoxFromRect({ x: 100, y: 50, w: 200, h: 100 }, { w: 1000, h: 500 })).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    })
  })

  it('★★ 超出画面 → 夹回画面内（不许返回一个越界的框）', () => {
    const box = faceBoxFromRect({ x: 950, y: 0, w: 200, h: 100 }, { w: 1000, h: 500 })
    expect(box).not.toBeNull()
    expect(box!.x + box!.w).toBeLessThanOrEqual(1.0001)
  })

  it('★ 空框判 null（不产生一个「零面积」的脸）', () => {
    expect(faceBoxFromRect({ x: 0, y: 0, w: 0, h: 100 }, { w: 1000, h: 500 })).toBeNull()
  })

  it('★ 尺寸为 0 也不炸（除零守卫）', () => {
    expect(faceBoxFromRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    })
  })
})
