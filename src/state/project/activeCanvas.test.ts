import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeCanvasId,
  activeWorkbenchId,
  forgetActiveWorkbench,
  getActiveCanvasRevision,
  rememberActiveCanvas,
  rememberActiveWorkbench,
  subscribeActiveCanvas,
} from './activeCanvas'

describe('activeCanvas selection', () => {
  beforeEach(() => {
    forgetActiveWorkbench('canvas')
    forgetActiveWorkbench('ecommerce')
    forgetActiveWorkbench('storyboard')
  })

  it('记住与清除都会通知订阅者并推进 revision', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActiveCanvas(listener)
    const before = getActiveCanvasRevision()

    rememberActiveCanvas('p1')
    expect(activeCanvasId()).toBe('p1')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getActiveCanvasRevision()).toBe(before + 1)

    forgetActiveWorkbench('canvas')
    expect(activeCanvasId()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })

  it('三个工作台各自记住最近打开的项目，互不串 id', () => {
    rememberActiveCanvas('canvas-1')
    rememberActiveWorkbench('ecommerce', 'ecommerce-1')
    rememberActiveWorkbench('storyboard', 'storyboard-1')
    expect(activeCanvasId()).toBe('canvas-1')
    expect(activeWorkbenchId('ecommerce')).toBe('ecommerce-1')
    expect(activeWorkbenchId('storyboard')).toBe('storyboard-1')

    forgetActiveWorkbench('ecommerce')
    expect(activeWorkbenchId('ecommerce')).toBeNull()
    expect(activeCanvasId()).toBe('canvas-1')
  })
})
