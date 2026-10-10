import { beforeEach, describe, expect, it } from 'vitest'
import type { CanvasStore } from './store'
import {
  canvasStoreCacheSize,
  canvasStoreFor,
  forgetCanvasStore,
  resetCanvasStoreCache,
} from './storeCache'

/**
 * **一个项目 = 一个 store 实例**（对账 #411）。
 *
 * 这里守的是那条会让用户直接踩到的因果链：
 * 电商页与画布页若各拿一个实例 ⇒ 在电商页出的图，到画布页**按不出撤销**（撤销栈在另一个实例上），
 * 而且两边各存一份内存图，谁改了对方都不知道。
 */

/** 只关心"是不是同一个对象"，不需要真的 store —— 用带 id 的替身即可 */
function fakeStore(tag: string): CanvasStore {
  return { tag } as unknown as CanvasStore
}

describe('画布 store 按项目缓存（画布页 / 电商页共用）', () => {
  beforeEach(() => resetCanvasStoreCache())

  it('★ 第二次取同一个项目：拿到同一个实例，且 create 只跑过一次', () => {
    let created = 0
    const a = canvasStoreFor('p1', () => {
      created += 1
      return fakeStore('a')
    })
    const b = canvasStoreFor('p1', () => {
      created += 1
      return fakeStore('b')
    })
    expect(a).toBe(b)
    expect(created).toBe(1)
  })

  it('★★ 两个入口（各自的 create 闭包）拿到的是同一个 store —— 撤销栈能跨页面的前提', () => {
    const fromCanvas = canvasStoreFor('p1', () => fakeStore('canvas'))
    const fromEcommerce = canvasStoreFor('p1', () => fakeStore('ecommerce'))
    expect(fromEcommerce.store).toBe(fromCanvas.store)
  })

  it('不同项目互不影响（各是各的实例与 hydrated 标记）', () => {
    const p1 = canvasStoreFor('p1', () => fakeStore('p1'))
    const p2 = canvasStoreFor('p2', () => fakeStore('p2'))
    expect(p1.store).not.toBe(p2.store)
    p1.hydrated = true
    expect(canvasStoreCacheSize()).toBe(2)
    expect(p2.hydrated).toBe(false)
  })

  it('hydrated 跟着实例走：标记一次，两个入口都看得到（不会各自再 hydrate 一遍）', () => {
    canvasStoreFor('p1', () => fakeStore('a')).hydrated = true
    expect(canvasStoreFor('p1', () => fakeStore('b')).hydrated).toBe(true)
  })

  it('forget 之后重建（项目真的被删掉时用）', () => {
    const first = canvasStoreFor('p1', () => fakeStore('a'))
    forgetCanvasStore('p1')
    const second = canvasStoreFor('p1', () => fakeStore('b'))
    expect(second).not.toBe(first)
    expect(second.store).not.toBe(first.store)
  })
})
