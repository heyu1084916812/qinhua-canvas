import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { DEFAULT_ECOMMERCE_FORM_DRAFT } from '../../domain/ecommerce/draft'
import { readEcommerceFormDraft } from '../../domain/ecommerce/draft'
import { loadEcommerceDraft, saveEcommerceDraft } from './ecommerceDraft'

describe('电商左侧草稿落库（内存存储）', () => {
  const putProject = async (
    storage: ReturnType<typeof createMemoryStorage>,
    id: string,
    extra: Record<string, unknown> = {},
  ) => {
    await storage.put('projects', {
      id,
      name: '电商项目',
      workbench: 'ecommerce',
      createdAt: 1,
      updatedAt: 7,
      extra,
    })
  }

  it('写进去之后能完整读回', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    const draft = {
      ...DEFAULT_ECOMMERCE_FORM_DRAFT,
      usage: 'detail' as const,
      count: 4,
      ratio: '3:4',
      note: '突出防水材质',
      productNodeId: 'node_product',
      referenceNodeIds: ['node_ref'],
    }
    expect(await saveEcommerceDraft(storage, 'p1', draft)).toBe(true)
    expect(await loadEcommerceDraft(storage, 'p1')).toEqual(draft)
  })

  it('不碰 updatedAt / name，也不吞 ecommerce.batchId', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1', { ecommerce: { batchId: 'ecb_keep' } })
    await saveEcommerceDraft(storage, 'p1', { ...DEFAULT_ECOMMERCE_FORM_DRAFT, model: 'GPT Image 2' })
    const rows = await storage.query('projects', { id: 'p1' })
    expect(rows[0].updatedAt).toBe(7)
    expect(rows[0].name).toBe('电商项目')
    const extra = rows[0].extra as { ecommerce: { batchId: string } }
    expect(extra.ecommerce.batchId).toBe('ecb_keep')
    expect(readEcommerceFormDraft(rows[0].extra)?.model).toBe('GPT Image 2')
  })

  it('同一份草稿不重复写；项目不在 / demo 不造脏行', async () => {
    const storage = createMemoryStorage()
    await putProject(storage, 'p1')
    expect(await saveEcommerceDraft(storage, 'p1', DEFAULT_ECOMMERCE_FORM_DRAFT)).toBe(true)
    expect(await saveEcommerceDraft(storage, 'p1', DEFAULT_ECOMMERCE_FORM_DRAFT)).toBe(false)
    expect(await saveEcommerceDraft(storage, 'missing', DEFAULT_ECOMMERCE_FORM_DRAFT)).toBe(false)
    expect(await saveEcommerceDraft(storage, 'demo', DEFAULT_ECOMMERCE_FORM_DRAFT)).toBe(false)
    expect(await storage.query('projects', {})).toHaveLength(1)
  })
})
