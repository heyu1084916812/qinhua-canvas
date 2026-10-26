import { describe, expect, it } from 'vitest'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  shotsOf,
} from '../../domain/storyboard/storyboard'
import { createMemoryPlatform } from '../../platform/memory'
import { createStoryboardExportController } from './useStoryboardExportController'

describe('Storyboard export controller', () => {
  it('导出分镜表，不依赖页面组件', async () => {
    const platform = createMemoryPlatform()
    const saved: string[] = []
    platform.files.saveFile = async (name) => {
      saved.push(name)
    }
    const doc = emptyStoryboard('p1')
    let status = ''
    const controller = createStoryboardExportController({
      doc,
      projectName: '测试漫剧',
      episodes: doc.episodes,
      selected: null,
      timelineSrt: '',
      timelineSrtCues: 0,
      platform,
      flush: async () => undefined,
      setStatus: (text) => {
        status = text
      },
      setRendering: () => undefined,
    })

    await controller.onExport()

    expect(saved).toEqual(['未命名漫剧-分镜表.md'])
    expect(status).toBe('已导出分镜表')
  })

  it('用当前集的真实素材元数据导出合成包', async () => {
    const platform = createMemoryPlatform()
    const saved: string[] = []
    platform.files.saveFile = async (name) => {
      saved.push(name)
    }
    await platform.storage.put('assets', {
      id: 'a1',
      hash: 'a1',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      width: 64,
      height: 64,
    } as never)

    let doc = addEpisode(emptyStoryboard('p1'))
    const episode = doc.episodes[0]!
    doc = addShot(doc, episode.id)
    const shot = doc.shots[0]!
    doc = {
      ...doc,
      shots: doc.shots.map((item) =>
        item.id === shot.id
          ? { ...item, imageHash: 'a1', prompt: '测试画面', durationSec: 3 }
          : item,
      ),
    }
    expect(shotsOf(doc, episode.id)).toHaveLength(1)
    expect(shotsOf(doc, episode.id)[0]).toMatchObject({ imageHash: 'a1' })
    const selected = doc.episodes[0]!
    let status = ''
    const controller = createStoryboardExportController({
      doc,
      projectName: '测试漫剧',
      episodes: doc.episodes,
      selected,
      timelineSrt: '',
      timelineSrtCues: 0,
      platform,
      flush: async () => undefined,
      setStatus: (text) => {
        status = text
      },
      setRendering: () => undefined,
    })

    await controller.onExportPack()

    expect(status).not.toBe('正在准备合成包…')
    expect(saved).toEqual(['未命名漫剧-第1集-合成包.md'])
  })
})
