import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { solidPng } from '../../platform/channels/mockPng'
import { importEcommerceAsset } from './importEcommerceAsset'

describe('importEcommerceAsset', () => {
  it('图片直接写 assets，不依赖画布节点', async () => {
    const platform = createMemoryPlatform()
    const bytes = solidPng(2, 3, [10, 20, 30] as const, 'ecommerce-upload')
    const file = new Blob([bytes as unknown as BlobPart], { type: 'image/png' })

    const imported = await importEcommerceAsset({
      platform,
      projectId: 'p1',
      file,
    })

    expect(imported).toMatchObject({
      mime: 'image/png',
      width: 2,
      height: 3,
    })
    const row = (await platform.storage.query('assets', {
      id: imported!.hash,
    }))[0]
    expect(row).toMatchObject({
      id: imported!.hash,
      projectId: 'p1',
      mime: 'image/png',
    })
  })

  it('非图片直接拒绝', async () => {
    const platform = createMemoryPlatform()
    const result = await importEcommerceAsset({
      platform,
      projectId: 'p1',
      file: new Blob(['text'], { type: 'text/plain' }),
    })
    expect(result).toBeNull()
  })
})
