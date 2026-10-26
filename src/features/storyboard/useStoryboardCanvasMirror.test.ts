import { describe, expect, it } from 'vitest'
import {
  emptyStoryboard,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import type { StoryboardCanvasNode } from './canvasPort'
import { mirrorStoryboardCanvasDocument } from './useStoryboardCanvasMirror'

const shot: StoryboardShot = {
  id: 'shot-1',
  episodeId: 'episode-1',
  scene: '',
  lines: [],
  durationSec: 3,
  prompt: '',
  nodeId: 'image-node',
  imageHash: 'old-image',
  videoNodeId: 'video-node',
  videoHash: 'old-video',
}

const doc: StoryboardDoc = {
  ...emptyStoryboard('project-1'),
  episodes: [{ id: 'episode-1', title: '第一集', summary: '' }],
  shots: [shot],
  characters: [
    {
      id: 'character-1',
      name: '角色',
      description: '',
      aliases: [],
      nodeId: 'character-base-node',
      baseHash: 'old-character',
      turnaroundNodeId: 'character-turnaround-node',
      turnaroundHash: 'old-turnaround',
    },
  ],
  scenes: [
    {
      id: 'scene-1',
      name: '场景',
      description: '',
      aliases: [],
      nodeId: 'scene-base-node',
      baseHash: 'old-scene',
    },
  ],
}

const nodes: StoryboardCanvasNode[] = [
  { id: 'image-node', x: 0, y: 0, data: { assetHash: 'new-image' } },
  { id: 'video-node', x: 0, y: 0, data: { assetHash: 'new-video' } },
  { id: 'character-base-node', x: 0, y: 0, data: { assetHash: 'new-character' } },
  {
    id: 'character-turnaround-node',
    x: 0,
    y: 0,
    data: { assetHash: 'new-turnaround' },
  },
  { id: 'scene-base-node', x: 0, y: 0, data: { assetHash: 'new-scene' } },
]

describe('mirrorStoryboardCanvasDocument', () => {
  it('一次投影镜头图、镜头视频和角色 / 场景资产 hash', () => {
    const next = mirrorStoryboardCanvasDocument(doc, nodes)

    expect(next.shots[0]?.imageHash).toBe('new-image')
    expect(next.shots[0]?.videoHash).toBe('new-video')
    expect(next.characters[0]?.baseHash).toBe('new-character')
    expect(next.characters[0]?.turnaroundHash).toBe('new-turnaround')
    expect(next.scenes[0]?.baseHash).toBe('new-scene')
  })

  it('画布 hash 与文档一致时返回原对象，不触发无意义写回', () => {
    const current = mirrorStoryboardCanvasDocument(doc, nodes)

    expect(mirrorStoryboardCanvasDocument(current, nodes)).toBe(current)
  })

  it('非字符串 hash 与悬空节点都不写入', () => {
    expect(
      mirrorStoryboardCanvasDocument(doc, [
        { id: 'image-node', x: 0, y: 0, data: { assetHash: 42 } },
        { id: 'video-node', x: 0, y: 0, data: {} },
      ]),
    ).toBe(doc)
  })
})
