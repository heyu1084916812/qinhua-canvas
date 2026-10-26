import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../../domain/storyboard/storyboard'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import { createRunRecord } from '../../../domain/shared/execution/runRecord'
import { fingerprintBytes } from '../../../domain/shared/hash'
import type {
  StoryboardRunAction,
  StoryboardRunSubject,
  StoryboardRunTask,
} from '../../../domain/storyboard/runTypes'
import { createMemoryPlatform } from '../../../platform/memory'
import { createStoryboardStore } from '../../../state/project/storyboardStore'
import type { GeneratedAsset } from '../../../platform/channels/types'
import type { StoryboardExecutionCommand } from './storyboardCommands'
import { createStoryboardCommandExecutor } from './storyboardCommandExecutor'
import { createStoryboardPlacement } from './storyboardPlacement'

function fixture(): {
  doc: StoryboardDoc
  characterId: string
  episodeId: string
  shotId: string
  lineId: string
} {
  let doc = emptyStoryboard('project-1', 1)
  doc = addCharacter(doc)
  const characterId = doc.characters[0]!.id
  doc = addEpisode(doc)
  const episodeId = doc.episodes[0]!.id
  doc = addShot(doc, episodeId)
  const shotId = doc.shots[0]!.id
  doc = addShotLine(doc, shotId, {
    text: '你好',
    speakerId: characterId,
  })
  const lineId = doc.shots[0]!.lines[0]!.id
  return { doc, characterId, episodeId, shotId, lineId }
}

async function generatedAsset(
  bytes = new Uint8Array([1, 2, 3]),
  mime = 'image/png',
): Promise<GeneratedAsset> {
  return {
    hash: await fingerprintBytes(bytes),
    mime,
    bytes,
  }
}

function taskFor(
  action: StoryboardRunAction,
  subject: StoryboardRunSubject,
  params: Record<string, unknown>,
): StoryboardRunTask {
  return {
    id: `plan-1:${action}:${subject.id}`,
    nodeId: subject.id,
    planId: 'plan-1',
    workbench: 'storyboard',
    operationId: 'op-1',
    action,
    subject,
    request: {
      kind: action === 'speech' ? 'text' : action === 'shot-image' ||
        action === 'asset-base' ||
        action === 'asset-turnaround'
        ? 'image'
        : 'video',
      channelId: 'channel-1',
      model: 'model-1',
      prompt: 'prompt',
      inputs: [],
      params,
    },
    dependsOn: [],
    fingerprint: 'fingerprint-1',
    params,
  }
}

function recordFor(task: StoryboardRunTask): RunRecord {
  return createRunRecord({
    id: `record-${task.id}`,
    nodeId: task.subject.id,
    projectId: 'project-1',
    version: 1,
    createdAt: 1,
    status: 'succeeded',
    inputs: [],
    params: task.params,
    outputHashes: ['generated'],
    fingerprint: task.fingerprint,
    taskId: task.id,
    durationMs: 1,
    scope: {
      scopeVersion: 1,
      workbench: 'storyboard',
      subjectId: task.subject.id,
      scopeId: task.subject.scopeId,
      operationId: task.operationId,
    },
  })
}

describe('StoryboardCommandExecutor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('镜头图先落素材，再把业务 hash 写进最新文档，最后落一条成功记录', async () => {
    const platform = createMemoryPlatform()
    const store = createStoryboardStore(platform.storage)
    const { doc, episodeId, shotId } = fixture()
    await store.save(doc)
    const asset = await generatedAsset()
    const subject: StoryboardRunSubject = {
      kind: 'shot-image',
      id: `shot:${shotId}`,
      scopeId: `episode:${episodeId}`,
      episodeId,
      shotId,
    }
    const task = taskFor('shot-image', subject, {
      action: 'shot-image',
      episodeId,
      shotId,
    })
    const placement = createStoryboardPlacement('project-1')
    const commands: StoryboardExecutionCommand[] = [
      ...placement.commit(task, subject.id, [asset]),
      placement.record(task, subject.id, recordFor(task))!,
    ]
    const executor = createStoryboardCommandExecutor({
      storage: platform.storage,
      assets: platform.assets,
      documents: store,
      now: () => 10,
    })

    const result = await executor.execute(commands)

    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
    expect((await store.load('project-1')).shots[0]!.imageHash).toBe(asset.hash)
    expect(await platform.storage.query('runRecords', { id: `record-${task.id}` })).toHaveLength(1)
  })

  it('业务写回失败时保留一次付费记录，但记录必须收口为 failed 而不是 succeeded', async () => {
    const platform = createMemoryPlatform()
    const store = createStoryboardStore(platform.storage)
    const { doc, episodeId, shotId } = fixture()
    await store.save(doc)
    const wrongType = await generatedAsset(new Uint8Array([4, 5, 6]), 'video/mp4')
    const subject: StoryboardRunSubject = {
      kind: 'shot-image',
      id: `shot:${shotId}`,
      scopeId: `episode:${episodeId}`,
      episodeId,
      shotId,
    }
    const task = taskFor('shot-image', subject, {
      action: 'shot-image',
      episodeId,
      shotId,
    })
    const placement = createStoryboardPlacement('project-1')
    const executor = createStoryboardCommandExecutor({
      storage: platform.storage,
      assets: platform.assets,
      documents: store,
      now: () => 10,
    })

    const result = await executor.execute([
      ...placement.commit(task, subject.id, [wrongType]),
      placement.record(task, subject.id, recordFor(task))!,
    ])
    const stored = (await platform.storage.query('runRecords', {
      id: `record-${task.id}`,
    }))[0] as unknown as RunRecord

    expect(result.failures).toHaveLength(1)
    expect((await store.load('project-1')).shots[0]!.imageHash).toBeUndefined()
    expect(stored.status).toBe('failed')
    expect(stored.outputHashes).toEqual([])
    expect(stored.errorText).toContain('业务保存失败')
  })

  it('资产、台词和视频写回各自更新业务真相', async () => {
    const platform = createMemoryPlatform()
    const store = createStoryboardStore(platform.storage)
    const { doc, characterId, episodeId, shotId, lineId } = fixture()
    await store.save(doc)
    const executor = createStoryboardCommandExecutor({
      storage: platform.storage,
      assets: platform.assets,
      documents: store,
      now: () => 20,
    })
    const placement = createStoryboardPlacement('project-1')
    const base = await generatedAsset(new Uint8Array([10]))
    const speech = await generatedAsset(new Uint8Array([11]), 'audio/mpeg')
    const video = await generatedAsset(new Uint8Array([12]), 'video/mp4')
    const baseSubject: StoryboardRunSubject = {
      kind: 'asset',
      id: `char:${characterId}:base`,
      scopeId: 'project:project-1',
      assetId: characterId,
      assetType: 'char',
    }
    const speechSubject: StoryboardRunSubject = {
      kind: 'speech',
      id: `line:${lineId}`,
      scopeId: `episode:${episodeId}`,
      episodeId,
      shotId,
      lineId,
    }
    const videoSubject: StoryboardRunSubject = {
      kind: 'shot-video',
      id: `shot:${shotId}`,
      scopeId: `episode:${episodeId}`,
      episodeId,
      shotId,
    }
    const baseTask = taskFor('asset-base', baseSubject, {
      action: 'asset-base',
      assetId: characterId,
      assetType: 'char',
    })
    const speechTask = taskFor('speech', speechSubject, {
      action: 'speech',
      episodeId,
      shotId,
      lineId,
      audioName: '林轩-你好.mp3',
    })
    const videoTask = taskFor('shot-video', videoSubject, {
      action: 'shot-video',
      episodeId,
      shotId,
    })

    const result = await executor.execute([
      ...placement.commit(baseTask, baseSubject.id, [base]),
      ...placement.commit(speechTask, speechSubject.id, [speech]),
      ...placement.commit(videoTask, videoSubject.id, [video]),
    ])
    const persisted = await store.load('project-1')

    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
    expect(persisted.characters[0]!.baseHash).toBe(base.hash)
    expect(persisted.shots[0]!.lines[0]).toMatchObject({
      audioHash: speech.hash,
      audioName: '林轩-你好.mp3',
    })
    expect(persisted.shots[0]!.videoHash).toBe(video.hash)
  })
})
