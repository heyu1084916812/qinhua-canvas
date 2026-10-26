import { describe, expect, it } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
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

  it('整集视频用一个零依赖计划承载每镜独立模型和首尾帧 MIME', () => {
    const base = fixture()
    const doc: StoryboardDoc = {
      ...base,
      shots: base.shots.map((shot, index) => ({
        ...shot,
        imageHash: `image-${index + 1}`,
      })),
    }
    const [firstShot, secondShot] = doc.shots
    const plan = buildStoryboardRunPlan({
      doc,
      planId: 'plan-episode-videos',
      operationId: 'op-episode-videos',
      target: ({ subject }) => ({
        channelId:
          subject.kind === 'shot-video' && subject.shotId === firstShot!.id
            ? 'channel-first-last'
            : 'channel-image-only',
        model: 'video-model',
      }),
      action: 'shot-video',
      episodeId: doc.episodes[0]!.id,
      shotIds: [firstShot!.id, secondShot!.id],
      shotVideoInputs: (shot) => ({
        includeEndFrame: shot.id === firstShot!.id,
        imageMime: shot.id === firstShot!.id ? 'image/webp' : 'image/jpeg',
        endFrameMime: 'image/png',
      }),
    })

    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks.map((task) => task.dependsOn)).toEqual([[], []])
    expect(plan.tasks.every((task) => task.parentRunId === undefined)).toBe(
      true,
    )
    expect(plan.tasks[0]).toMatchObject({
      action: 'shot-video',
      subject: {
        kind: 'shot-video',
        episodeId: doc.episodes[0]!.id,
        shotId: firstShot!.id,
      },
      request: {
        channelId: 'channel-first-last',
        inputs: [
          { assetHash: 'image-1', mime: 'image/webp' },
          { assetHash: 'image-2', mime: 'image/png' },
        ],
      },
    })
    expect(plan.tasks[1]).toMatchObject({
      request: {
        channelId: 'channel-image-only',
        inputs: [{ assetHash: 'image-2', mime: 'image/jpeg' }],
      },
    })
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

  it('视频后处理以已有视频为输入，并按动作写入独立参数', () => {
    const doc = fixture()
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => ({
        ...shot,
        videoHash: `video-${shot.id}`,
      })),
    }
    const plan = buildStoryboardRunPlan({
      doc: withVideo,
      planId: 'plan-video-edit',
      operationId: 'op-video-edit',
      target: {
        channelId: 'channel-video',
        model: 'video-edit-model',
        params: { quality: 'high' },
      },
      action: 'video-edit',
      episodeId: withVideo.episodes[0]!.id,
      shotIds: [withVideo.shots[0]!.id],
      prompt: '把天空改成黄昏',
      params: { resolution: '1080p' },
      includeReferenceImage: true,
    })

    expect(plan.tasks[0]).toMatchObject({
      action: 'video-edit',
      subject: {
        kind: 'video-postprocess',
        shotId: withVideo.shots[0]!.id,
      },
      request: {
        kind: 'video',
        prompt: '把天空改成黄昏',
        inputs: [
          { assetHash: `video-${withVideo.shots[0]!.id}`, mime: 'video/mp4' },
          { assetHash: 'shot-1-image', mime: 'image/png' },
        ],
        params: {
          quality: 'high',
          resolution: '1080p',
          action: 'video-edit',
        },
      },
    })
  })

  it('视频后处理缺少视频时在规划阶段失败', () => {
    const doc = fixture()
    expect(() =>
      buildStoryboardRunPlan({
        doc,
        planId: 'plan-erase',
        operationId: 'op-erase',
        target,
        action: 'video-erase',
        episodeId: doc.episodes[0]!.id,
        shotIds: [doc.shots[0]!.id],
      }),
    ).toThrow('还没有视频')
  })

  it('台词配音生成 speech task，带音色 / 语速并写业务主体', () => {
    let doc = fixture()
    doc = addShotLine(doc, doc.shots[0]!.id, {
      speakerId: doc.characters[0]!.id,
      text: '你好，世界',
    })
    const lineId = doc.shots[0]!.lines[0]!.id
    const plan = buildStoryboardRunPlan({
      doc,
      planId: 'plan-speech',
      operationId: 'op-speech',
      target: {
        channelId: 'speech-channel',
        model: 'speech-model',
        params: { speed: 1.2 },
      },
      action: 'speech',
      episodeId: doc.episodes[0]!.id,
      lineIds: [lineId],
    })

    expect(plan.tasks[0]).toMatchObject({
      action: 'speech',
      subject: {
        kind: 'speech',
        episodeId: doc.episodes[0]!.id,
        shotId: doc.shots[0]!.id,
        lineId,
      },
      request: {
        kind: 'speech',
        prompt: '你好，世界',
        timeoutMs: 120_000,
        params: {
          voice: 'alloy',
          speed: 1.2,
          responseFormat: 'mp3',
          audioName: expect.stringContaining('你好，世界'),
        },
      },
    })
  })

  it('数字人计划同时携带当前画面与合并音轨，并继承父记录', () => {
    const doc = fixture()
    const plan = buildStoryboardRunPlan({
      doc,
      planId: 'plan-digital-human',
      operationId: 'op-digital-human',
      parentRunId: 'record-speech-parent',
      target: {
        channelId: 'digital-channel',
        model: 'digital-model',
      },
      action: 'digital-human',
      episodeId: doc.episodes[0]!.id,
      shotIds: [doc.shots[0]!.id],
      audioHash: 'merged-audio',
      audioMime: 'audio/wav',
      imageMime: 'image/webp',
    })

    expect(plan.tasks[0]).toMatchObject({
      action: 'digital-human',
      parentRunId: 'record-speech-parent',
      subject: {
        kind: 'digital-human',
        shotId: doc.shots[0]!.id,
      },
      request: {
        kind: 'video',
        inputs: [
          { assetHash: 'shot-1-image', mime: 'image/webp' },
          { assetHash: 'merged-audio', mime: 'audio/wav' },
        ],
        params: {
          action: 'digital-human',
          durationSec: 5,
        },
      },
    })
  })
})
