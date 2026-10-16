import { describe, expect, it } from 'vitest'
import {
  MAX_ANNOTATE_TEXT_SIZE,
  MIN_ANNOTATE_TEXT_SIZE,
  clampAnnotateTextSize,
  moveAnnotateText,
  resizeAnnotateText,
  type AnnotateTextItem,
} from './annotateOps'

const item: AnnotateTextItem = {
  id: 't1',
  x: 20,
  y: 30,
  text: '第一行\n第二行',
  color: '#e5484d',
  fontSize: 40,
}

describe('标注文字图层', () => {
  it('★ 拖动改的是图片像素坐标，并夹在图内', () => {
    expect(moveAnnotateText(item, 12, -8)).toMatchObject({ x: 32, y: 22 })
    expect(moveAnnotateText(item, -100, 999, { w: 200, h: 120 })).toMatchObject({
      x: 0,
      y: 120,
    })
  })

  it('★ 缩放手柄改字号，并夹在可用范围内', () => {
    expect(resizeAnnotateText(item, 96).fontSize).toBe(96)
    expect(resizeAnnotateText(item, 1).fontSize).toBe(MIN_ANNOTATE_TEXT_SIZE)
    expect(resizeAnnotateText(item, 9999).fontSize).toBe(MAX_ANNOTATE_TEXT_SIZE)
    expect(clampAnnotateTextSize(Number.NaN)).toBe(MIN_ANNOTATE_TEXT_SIZE)
  })
})
