import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { PlatformKit } from '../../platform/ports'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import {
  forgetActiveCanvas,
  rememberActiveCanvas,
} from '../../state/project/activeCanvas'
import {
  NoActiveCanvasError,
  sendAssetToActiveCanvas,
} from './sendToActiveCanvas'

let platform: PlatformKit

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
  forgetActiveCanvas()
  platform = createMemoryPlatform()
})

describe('sendAssetToActiveCanvas', () => {
  it('没有当前画布时明确拒绝', async () => {
    await expect(
      sendAssetToActiveCanvas(platform, {
        hash: 'h1',
        mime: 'image/png',
        bytes: 3,
        savedAt: 1,
      }),
    ).rejects.toBeInstanceOf(NoActiveCanvasError)
  })

  it('把素材作为一个新节点写入当前画布并落库', async () => {
    rememberActiveCanvas('p1')
    await platform.storage.put('projects', {
      id: 'p1',
      name: '画布 A',
      workbench: 'canvas',
      createdAt: 1,
      updatedAt: 1,
      extra: {},
    } as never)
    await platform.storage.put('assets', {
      id: 'h1',
      hash: 'h1',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      width: 20,
      height: 10,
    } as never)

    const result = await sendAssetToActiveCanvas(platform, {
      hash: 'h1',
      mime: 'image/png',
      bytes: 3,
      width: 20,
      height: 10,
      savedAt: 1,
    })

    expect(result.projectId).toBe('p1')
    expect(result.projectName).toBe('画布 A')
    const nodes = await platform.storage.query('nodes', { projectId: 'p1' })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      id: result.nodeId,
      type: 'generation',
      data: { assetHash: 'h1', assetMime: 'image/png' },
    })
  })
})
