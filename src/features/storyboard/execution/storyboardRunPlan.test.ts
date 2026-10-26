import { describe, expect, it } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../../domain/storyboard/storyboard'
import { buildStoryboardRunPlan } from './storyboardRunPlan'

function fixture(): StoryboardDoc {
  let doc = emptyStoryboard('project-1')
  doc = addCharacter(doc)
  const character = doc.characters[0]!
  doc = {
    ...doc,
    characters: doc.characters.map((item) => ({
      ...item,
      name: '林轩',
      description: '黑色长发，白色外套',
      baseHash: 'character-base',
    })),
  }
  doc = addEpisode(doc)
  const episode = doc.episodes[0]!
  doc = addShot(doc, episode.id)
  doc = addShot(doc, episode.id)
  doc = {
    ...doc,
    shots: doc.shots.map((shot, index) => ({
      ...shot,
      scene: `镜头 ${index + 1}`,
      characterIds: [character.id],
      imageHash: index === 0 ? 'shot-1-image' : undefined,
      durationSec: 5,
    })),
  }
  return doc
}

const target = {
  channelId: 'channel-1',
  model: 'storyboard-model',
}

describe('buildStoryboardRunPlan', () => {
  it('镜头出图按业务镜头生成稳定任务，并把资产基准图作为中性输入', () => {
    const doc = fixture()
    const input = {
      doc,
      planId: 'plan-shot-images',
      operationId: 'op-1',
      target,
      action: 'shot-image' as const,
      episodeId: doc.episodes[0]!.id,
    }
    const first = buildStoryboardRunPlan(input)
    const second = buildStoryboardRunPlan({ ...input, doc: { ...doc } })

    expect(first).toEqual(second)
    expect(first.tasks.map((task) => task.id)).toEqual([
      `plan-shot-images:shot-image:shot:${doc.shots[0]!.id}`,
      `plan-shot-images:shot-image:shot:${doc.shots[1]!.id}`,
    ])
    expect(first.tasks[0]).toMatchObject({
      nodeId: `shot:${doc.shots[0]!.id}`,
      action: 'shot-image',
      subject: {
        kind: 'shot-image',
        scopeId: `episode:${doc.episodes[0]!.id}`,
      },
      request: {
        kind: 'image',
        inputs: [
          {
            kind: 'asset',
            nodeId: `asset:char:${doc.characters[0]!.id}`,
            assetHash: 'character-base',
          },
        ],
      },
    })
  })

  it('同一计划可按镜头解析不同渠道 / 模型，并带上各自配方参数', () => {
    const doc = fixture()
    const plan = buildStoryboardRunPlan({
      doc,
      planId: 'plan-mixed-targets',
      operationId: 'op-mixed',
      action: 'shot-image',
      episodeId: doc.episodes[0]!.id,
      target: ({ subject }) => ({
        channelId:
          subject.kind === 'shot-image' && subject.shotId === doc.shots[0]!.id
            ? 'channel-1'
            : 'channel-2',
        model: 'image-model',
        params: {
          ratio: subject.id.endsWith(doc.shots[0]!.id) ? '16:9' : '9:16',
          quality: 'high',
        },
      }),
    })

    expect(plan.tasks.map((task) => task.request.channelId)).toEqual([
      'channel-1',
      'channel-2',
    ])
    expect(plan.tasks[0]!.request.params).toMatchObject({
      ratio: '16:9',
      quality: 'high',
    })
    expect(plan.tasks[1]!.request.params).toMatchObject({
      ratio: '9:16',
      quality: 'high',
    })
  })

  it('镜头视频必须有画面，缺少时在发请求前失败', () => {
    const doc = fixture()
    expect(() =>
      buildStoryboardRunPlan({
        doc,
        planId: 'plan-shot-videos',
        operationId: 'op-2',
        target,
        action: 'shot-video',
        episodeId: doc.episodes[0]!.id,
        shotIds: [doc.shots[1]!.id],
      }),
    ).toThrow('还没有画面')
  })

  it('要求资产基准图时，缺图在规划阶段失败', () => {
    let doc = fixture()
    doc = {
      ...doc,
      characters: doc.characters.map((item) => {
        const { baseHash: _baseHash, ...rest } = item
        return rest
      }),
    }
    expect(() =>
      buildStoryboardRunPlan({
        doc,
        planId: 'plan-images-required-assets',
        operationId: 'op-3',
        target,
        action: 'shot-image',
        episodeId: doc.episodes[0]!.id,
        requireAssetBases: true,
      }),
    ).toThrow('还没有基准图')
  })

  it('资产多视角可把已有基准图作为输入，并保持零依赖', () => {
    const doc = fixture()
    const plan = buildStoryboardRunPlan({
      doc,
      planId: 'plan-turnaround',
      operationId: 'op-4',
      target,
      action: 'asset-turnaround',
      assetType: 'char',
      assetIds: [doc.characters[0]!.id],
      requireBaseReference: true,
    })
    expect(plan.tasks[0]).toMatchObject({
      action: 'asset-turnaround',
      dependsOn: [],
      subject: {
        kind: 'asset',
        id: `char:${doc.characters[0]!.id}:turnaround`,
      },
      request: {
        kind: 'image',
        inputs: [
          {
            assetHash: 'character-base',
          },
        ],
      },
    })
  })

  it('计划外依赖在规划阶段直接失败，不把假拓扑留到执行器', () => {
    const doc = fixture()
    expect(() =>
      buildStoryboardRunPlan({
        doc,
        planId: 'plan-dangling-dependency',
        operationId: 'op-dangling',
        target,
        action: 'asset-turnaround',
        assetType: 'char',
        assetIds: [doc.characters[0]!.id],
        requireBaseReference: true,
        dependsOn: () => ['asset-base-task'],
      }),
    ).toThrow('依赖不存在')
  })

  it('模型或渠道为空时不生成计划', () => {
    const doc = fixture()
    expect(() =>
      buildStoryboardRunPlan({
        doc,
        planId: 'plan-missing-model',
        operationId: 'op-5',
        target: { channelId: 'channel-1', model: ' ' },
        action: 'shot-image',
        episodeId: doc.episodes[0]!.id,
      }),
    ).toThrow('缺少模型')
  })
})
