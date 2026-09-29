/**
 * 融合节点规格的单测（产品文档 §6.23，2026-09-29）。
 *
 * 重点钉住三条**结构性质**：
 * 1. 它**不能生成**（不调渠道，`generate` / `toRunRequest` 必须缺席）；
 * 2. 三只口的位置与方向（左原图 / 右上局部修改图 / 右中输出）；
 * 3. 输入**按端口**分开读，原图不会被当成第 1 张补丁。
 *
 * 像素合成与几何校验在 `domain/canvas/fusion/fusionPlan.test.ts`。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { GraphSnapshot } from '../model/graph'
import type { Edge } from '../model/edge'
import { resetSpecs, getSpec } from './registry'
import { registerAllSpecs } from './index'
import { canConnect } from '../graph/canConnect'
import { portDeclOf } from './ports'
import { fusionInputsOf, FUSION_PATCH_PORT } from './fusion'
import type { FusionData, NodeSnapshot } from '../model/node'

function node(
  id: string,
  type: NodeSnapshot['type'],
  data: Partial<NodeSnapshot['data']> = {},
): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: 280,
    h: 420,
    title: id,
    disabled: false,
    data: data as NodeSnapshot['data'],
  }
}

/** 一个「有产物」的生成节点：`resultImagesOf` 只认 `data.assetHash` */
function producer(id: string, hash: string): NodeSnapshot {
  return node(id, 'generation', { assetHash: hash })
}

const edge = (
  id: string,
  source: string,
  target: string,
  targetPort?: string,
): Edge => ({
  id,
  projectId: 'p1',
  source,
  target,
  ...(targetPort ? { targetPort } : {}),
})

function graph(nodes: NodeSnapshot[], edges: Edge[] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('fusionSpec / 结构', () => {
  it('注册了融合节点规格', () => {
    expect(getSpec('fusion')).toBeTruthy()
    expect(getSpec('fusion')?.label).toBe('融合节点')
  })

  it('★ 不能生成（融合是本地像素合成，不是模型调用）', () => {
    const spec = getSpec('fusion')!
    expect(spec.generate).toBeUndefined()
    expect(spec.toRunRequest).toBeUndefined()
  })

  it('★ 两只口：左原图（入）+ 右侧一只**共用口**（入 / 出，允许多条入边）', () => {
    const ports = getSpec('fusion')!.ports
    expect(ports.output).toBe(false) // 关掉默认 output：否则右侧又变成两个点
    expect(portDeclOf(ports, 'input')).toMatchObject({ kind: 'input', side: 'left', y: 0.5 })
    expect(portDeclOf(ports, 'output')).toBeNull()
    const patchPort = portDeclOf(ports, FUSION_PATCH_PORT)
    // 一个锚点，两个方向都用它（参考实现给同一个点挂 in + out 两个类）
    expect(patchPort).toMatchObject({ kind: 'both', side: 'right', y: 0.5 })
    expect(patchPort!.multi).toBe(true)
  })

  it('默认数据：没有选区、没有选中、没有产物', () => {
    expect(getSpec('fusion')!.createDefaultData()).toEqual({
      contexts: [],
      activeContextId: null,
    })
  })

  it('接受会产图的类型作上游（含自己，二次融合）', () => {
    const accepts = getSpec('fusion')!.accepts.upstream
    expect(accepts).toContain('generation')
    expect(accepts).toContain('fusion')
    // 提示词只产文本，不是图片 → 不该出现在这里
    expect(accepts).not.toContain('prompt')
  })
})

describe('fusionSpec / 输入按端口拆分', () => {
  it('★ 左口是原图、右上口是补丁 —— 不按端口读会把原图算成第 1 张补丁', () => {
    const f = node('f', 'fusion', { contexts: [] })
    const g = graph(
      [producer('src', 'a'.repeat(64)), producer('p1', 'b'.repeat(64)), producer('p2', 'c'.repeat(64)), f],
      [
        edge('e0', 'src', 'f'),
        edge('e1', 'p1', 'f', FUSION_PATCH_PORT),
        edge('e2', 'p2', 'f', FUSION_PATCH_PORT),
      ],
    )
    const { original, patches } = fusionInputsOf(f as NodeSnapshot<FusionData>, g)
    expect(original?.nodeId).toBe('src')
    expect(patches.map((p) => p.nodeId)).toEqual(['p1', 'p2'])
  })

  it('补丁顺序 = 连线顺序（位置映射靠它，排序会配错选区）', () => {
    const f = node('f', 'fusion', {})
    const g = graph(
      [producer('src', 'a'.repeat(64)), producer('p1', 'b'.repeat(64)), producer('p2', 'c'.repeat(64)), f],
      [
        edge('e1', 'p1', 'f', FUSION_PATCH_PORT),
        edge('e0', 'src', 'f'),
        edge('e2', 'p2', 'f', FUSION_PATCH_PORT),
      ],
    )
    const { patches } = fusionInputsOf(f as NodeSnapshot<FusionData>, g)
    expect(patches.map((p) => p.nodeId)).toEqual(['p1', 'p2'])
  })

  it('多个原图入边时只认第一条（多接不报错，但语义取第一张）', () => {
    const f = node('f', 'fusion', {})
    const g = graph(
      [producer('a', 'a'.repeat(64)), producer('b', 'b'.repeat(64)), f],
      [edge('e1', 'a', 'f'), edge('e2', 'b', 'f')],
    )
    expect(fusionInputsOf(f as NodeSnapshot<FusionData>, g).original?.nodeId).toBe('a')
  })

  it('没有产物的上游不算输入（空节点连了线也不冒充素材）', () => {
    const f = node('f', 'fusion', {})
    const g = graph([node('empty', 'generation', {}), f], [edge('e1', 'empty', 'f', FUSION_PATCH_PORT)])
    expect(fusionInputsOf(f as NodeSnapshot<FusionData>, g).patches).toEqual([])
  })

  it('collectInputs 返回「原图在前、补丁在后」（执行层的顺序契约）', () => {
    const f = node('f', 'fusion', {})
    const g = graph(
      [producer('src', 'a'.repeat(64)), producer('p1', 'b'.repeat(64)), f],
      [edge('e0', 'src', 'f'), edge('e1', 'p1', 'f', FUSION_PATCH_PORT)],
    )
    const inputs = getSpec('fusion')!.collectInputs({ node: f as NodeSnapshot<FusionData>, graph: g })
    expect(inputs.map((i) => (i.kind === 'asset' ? i.assetHash : ''))).toEqual([
      'a'.repeat(64),
      'b'.repeat(64),
    ])
  })
})

describe('fusionSpec / 连线规则', () => {
  it('★ patch 口允许同一个上游连多条（同源多边 = 两张局部修改图）', () => {
    const f = node('f', 'fusion', {})
    const g = graph(
      [producer('p', 'a'.repeat(64)), f],
      [edge('e1', 'p', 'f', FUSION_PATCH_PORT)],
    )
    const check = canConnect(
      g.nodes[0],
      g.nodes[1],
      g,
      { targetPort: FUSION_PATCH_PORT },
    )
    expect(check).toEqual({ ok: true })
  })

  it('原图口仍然去重：同一条端到端第二条被拒', () => {
    const f = node('f', 'fusion', {})
    const g = graph([producer('p', 'a'.repeat(64)), f], [edge('e1', 'p', 'f')])
    expect(canConnect(g.nodes[0], g.nodes[1], g).ok).toBe(false)
  })

  it('★ 共用口**两个方向都吃**：既能接局部修改图，也能把结果连到下游', () => {
    const f = node('f', 'fusion', {})
    const g = graph([producer('p', 'a'.repeat(64)), f, node('down', 'generation', {})])
    // 入：上游 → 共用口
    expect(canConnect(g.nodes[0], g.nodes[1], g, { targetPort: FUSION_PATCH_PORT })).toEqual({ ok: true })
    // 出：共用口 → 下游
    expect(
      canConnect(g.nodes[1], g.nodes[2], g, { sourcePort: FUSION_PATCH_PORT, targetPort: 'input' }),
    ).toEqual({ ok: true })
  })

  it('★ 原图口不接受出边（不能从 input 往外连）', () => {
    const f = node('f', 'fusion', {})
    const g = graph([f, node('down', 'generation', {})])
    const check = canConnect(g.nodes[0], g.nodes[1], g, { sourcePort: 'input' })
    expect(check.ok).toBe(false)
  })

  it('融合结果可以喂给下游生成节点（从共用口出 → 下游 input）', () => {
    const f = node('f', 'fusion', {})
    const g = graph([f, node('down', 'generation', {})])
    expect(canConnect(g.nodes[0], g.nodes[1], g, { sourcePort: FUSION_PATCH_PORT })).toEqual({
      ok: true,
    })
    // 默认口（output）在融合节点上**不存在**了 —— 传默认值必须被拒，不能静默连上
    expect(canConnect(g.nodes[0], g.nodes[1], g).ok).toBe(false)
  })

  it('把生成节点接到融合节点的共用口上仍然只算「入」，不会反向成环', () => {
    const f = node('f', 'fusion', {})
    const gen = node('gen', 'generation', {})
    const g = graph([f, gen])
    const check = canConnect(gen, f, g, { targetPort: FUSION_PATCH_PORT })
    expect(check).toEqual({ ok: true })
  })
})
