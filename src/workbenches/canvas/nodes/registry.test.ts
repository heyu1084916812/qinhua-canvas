import { describe, it, expect } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { registerAllViews, getNodeDefinition, assertRegistryConsistent } from './index'
import { resetViews, registerView } from './registry'

/**
 * 视图注册表一致性（架构 §4.5）：注册的「视图类型集合」必须与「规格类型集合」完全一致，
 * 不一致启动即抛错，避免「能渲染但不能生成」的半成品类型上线。
 */
describe('节点视图注册表', () => {
  it('registerAllSpecs + registerAllViews 后 getNodeDefinition 返回完整定义', () => {
    registerAllSpecs()
    registerAllViews()
    const def = getNodeDefinition('prompt')
    expect(def.type).toBe('prompt')
    expect(typeof def.View).toBe('function')
    expect(def.createDefaultData).toBeDefined()
    expect(def.ports).toBeDefined()
  })

  it('规格与视图类型集合不一致时抛错', () => {
    registerAllSpecs()
    registerAllViews() // 先拿到完整视图集合，再人为抽掉两个
    const view = getNodeDefinition('prompt').View
    resetViews()
    // 只保留 prompt 一个 view，故意漏掉其它已注册类型
    registerView('prompt', { View: view as never })
    expect(() => assertRegistryConsistent()).toThrow(/规格与视图注册不一致/)
  })
})
