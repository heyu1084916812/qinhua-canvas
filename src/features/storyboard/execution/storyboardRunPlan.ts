import { fingerprintHex } from '../../../domain/shared/hash'
import type { NodeInput, RunRequest } from '../../../domain/shared/execution/types'
import { runPlanWaves } from '../../../domain/shared/execution/plan'
import type {
  DramaAsset,
  StoryboardDoc,
  StoryboardShot,
} from '../../../domain/storyboard/storyboard'
import {
  assetBasePrompt,
  assetTurnaroundPrompt,
  shotPromptWithAssets,
  shotVideoPrompt,
  speechSettingsOf,
} from '../../../domain/storyboard/storyboard'
import {
  assertStoryboardRunTask,
  subjectKindOfAction,
  type StoryboardRunAction,
  type StoryboardRunPlan,
  type StoryboardRunSubject,
  type StoryboardRunTask,
} from '../../../domain/storyboard/runTypes'

export interface StoryboardRunTarget {
  channelId: string
  model: string
  /** true 表示调用方已把前端模型名映射成上游 ID；默认 false，由执行网关映射。 */
  modelIsUpstream?: boolean
  /** 模型配方里与本次媒体请求有关的参数。 */
  params?: Record<string, unknown>
  credentialGroupId?: string
  credentialGroupIds?: readonly string[]
}

interface StoryboardPlannerBase {
  doc: StoryboardDoc
  planId: string
  operationId: string
  parentRunId?: string
  target:
    | StoryboardRunTarget
    | ((task: {
        action: StoryboardRunAction
        subject: StoryboardRunSubject
      }) => StoryboardRunTarget)
  dependsOn?: (task: {
    action: StoryboardRunAction
    subject: StoryboardRunSubject
  }) => readonly string[]
}

export interface StoryboardAssetRunPlannerInput extends StoryboardPlannerBase {
  action: 'asset-base' | 'asset-turnaround'
  assetType: 'char' | 'scene'
  assetIds?: readonly string[]
  requireBaseReference?: boolean
}

export interface StoryboardShotRunPlannerInput extends StoryboardPlannerBase {
  action: 'shot-image' | 'shot-video'
  episodeId: string
  shotIds?: readonly string[]
  requireAssetBases?: boolean
  includeNextShotEndFrame?: boolean
  imageMime?: string
  nextImageMime?: string
  /**
   * 按镜头解析视频输入策略。整集并发时，每镜可能使用不同模型，因而是否支持
   * 首尾帧、输入 MIME 也可能不同；这里只返回中性输入事实，不接触画布节点。
   */
  shotVideoInputs?: (
    shot: StoryboardShot,
    nextShot: StoryboardShot | undefined,
  ) => StoryboardShotVideoInputPolicy
}

export interface StoryboardShotVideoInputPolicy {
  includeEndFrame?: boolean
  imageMime?: string
  endFrameMime?: string
}

export type StoryboardVideoPostprocessAction =
  | 'video-upscale'
  | 'video-fps'
  | 'video-erase'
  | 'video-edit'
  | 'video-extend'

export interface StoryboardVideoPostprocessPlannerInput
  extends StoryboardPlannerBase {
  action: StoryboardVideoPostprocessAction
  episodeId: string
  shotIds?: readonly string[]
  prompt?: string
  params?: Record<string, unknown>
  includeReferenceImage?: boolean
  videoMime?: string
  referenceImageMime?: string
}

export interface StoryboardSpeechRunPlannerInput extends StoryboardPlannerBase {
  action: 'speech'
  episodeId: string
  shotIds?: readonly string[]
  lineIds?: readonly string[]
  defaultVoice?: string
}

export interface StoryboardDigitalHumanPlannerInput
  extends StoryboardPlannerBase {
  action: 'digital-human'
  episodeId: string
  shotIds?: readonly string[]
  audioHash: string
  audioMime?: string
  imageMime?: string
  prompt?: string
  params?: Record<string, unknown>
}

export type StoryboardRunPlannerInput =
  | StoryboardAssetRunPlannerInput
  | StoryboardShotRunPlannerInput
  | StoryboardVideoPostprocessPlannerInput
  | StoryboardSpeechRunPlannerInput
  | StoryboardDigitalHumanPlannerInput

function assertTarget(target: StoryboardRunTarget): void {
  if (!target.channelId.trim()) throw new Error('漫剧执行计划缺少渠道')
  if (!target.model.trim()) throw new Error('漫剧执行计划缺少模型')
}

function requestOf(
  kind: 'image' | 'video',
  target: StoryboardRunTarget,
  prompt: string,
  inputs: readonly NodeInput[],
  params: Record<string, unknown>,
): RunRequest {
  return {
    kind,
    channelId: target.channelId,
    model: target.model,
    prompt,
    inputs: [...inputs],
    params,
    ...(target.credentialGroupId
      ? { credentialGroupId: target.credentialGroupId }
      : {}),
    ...(target.credentialGroupIds?.length
      ? { credentialGroupIds: [...target.credentialGroupIds] }
      : {}),
  }
}

function targetOf(
  input: StoryboardRunPlannerInput,
  action: StoryboardRunAction,
  subject: StoryboardRunSubject,
): StoryboardRunTarget {
  const target =
    typeof input.target === 'function'
      ? input.target({ action, subject })
      : input.target
  assertTarget(target)
  return target
}

function taskOf(input: {
  planId: string
  operationId: string
  action: StoryboardRunAction
  subject: StoryboardRunSubject
  request: RunRequest
  params: Record<string, unknown>
  dependsOn: readonly string[]
  parentRunId?: string
}): StoryboardRunTask {
  const id = `${input.planId}:${input.action}:${input.subject.id}`
  return assertStoryboardRunTask({
    id,
    nodeId: input.subject.id,
    planId: input.planId,
    workbench: 'storyboard',
    operationId: input.operationId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    action: input.action,
    subject: input.subject,
    request: input.request,
    dependsOn: [...input.dependsOn],
    fingerprint: fingerprintHex(
      JSON.stringify({
        planId: input.planId,
        operationId: input.operationId,
        action: input.action,
        subject: input.subject,
        request: input.request,
      }),
    ),
    params: input.params,
  })
}

function assetReferenceInput(
  kind: 'char' | 'scene',
  asset: DramaAsset,
  required: boolean,
): NodeInput[] {
  if (!asset.baseHash) {
    if (required) {
      throw new Error(`资产「${asset.name}」还没有基准图，不能作为参考图执行`)
    }
    return []
  }
  return [
    {
      kind: 'asset',
      nodeId: `asset:${kind}:${asset.id}`,
      assetHash: asset.baseHash,
      mime: 'image/png',
    },
  ]
}

function shotAssetInputs(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  required: boolean,
): NodeInput[] {
  const inputs: NodeInput[] = []
  if (shot.sceneId) {
    const scene = doc.scenes.find((item) => item.id === shot.sceneId)
    if (scene) inputs.push(...assetReferenceInput('scene', scene, required))
  }
  for (const characterId of shot.characterIds ?? []) {
    const character = doc.characters.find((item) => item.id === characterId)
    if (character) {
      inputs.push(...assetReferenceInput('char', character, required))
    }
  }
  return inputs
}

function assetsForPlan(input: StoryboardAssetRunPlannerInput): {
  kind: 'char' | 'scene'
  asset: DramaAsset
}[] {
  const source =
    input.assetType === 'char' ? input.doc.characters : input.doc.scenes
  const selected = input.assetIds ? new Set(input.assetIds) : null
  const assets = source
    .filter((asset) => !selected || selected.has(asset.id))
    .map((asset) => ({ kind: input.assetType, asset }))
  if (assets.length === 0) throw new Error('漫剧执行计划没有匹配的资产')
  return assets
}

function selectedShots(input: StoryboardShotRunPlannerInput): StoryboardShot[] {
  const episode = input.doc.episodes.find((item) => item.id === input.episodeId)
  if (!episode) throw new Error(`漫剧分集不存在：${input.episodeId}`)
  const selected = input.shotIds ? new Set(input.shotIds) : null
  const shots = input.doc.shots.filter(
    (shot) =>
      shot.episodeId === input.episodeId &&
      (!selected || selected.has(shot.id)),
  )
  if (shots.length === 0) throw new Error('漫剧执行计划没有匹配的镜头')
  return shots
}

function selectedPostprocessShots(
  input: StoryboardVideoPostprocessPlannerInput,
): StoryboardShot[] {
  const episode = input.doc.episodes.find((item) => item.id === input.episodeId)
  if (!episode) throw new Error(`漫剧分集不存在：${input.episodeId}`)
  const selected = input.shotIds ? new Set(input.shotIds) : null
  const shots = input.doc.shots.filter(
    (shot) =>
      shot.episodeId === input.episodeId &&
      (!selected || selected.has(shot.id)),
  )
  if (shots.length === 0) throw new Error('漫剧执行计划没有匹配的镜头')
  return shots
}

function dependenciesOf(
  input: StoryboardRunPlannerInput,
  action: StoryboardRunAction,
  subject: StoryboardRunSubject,
): readonly string[] {
  return input.dependsOn?.({ action, subject }) ?? []
}

function assetPlan(input: StoryboardAssetRunPlannerInput): StoryboardRunPlan {
  const tasks = assetsForPlan(input).map(({ kind, asset }) => {
    const action = input.action
    const subject: StoryboardRunSubject = {
      kind: 'asset',
      id:
        action === 'asset-base'
          ? `${kind}:${asset.id}:base`
          : `${kind}:${asset.id}:turnaround`,
      scopeId: `project:${input.doc.projectId}`,
      assetId: asset.id,
      assetType: kind,
    }
    const resolvedTarget = targetOf(input, action, subject)
    const prompt =
      action === 'asset-base'
        ? assetBasePrompt(asset, kind)
        : assetTurnaroundPrompt(asset)
    const inputs =
      action === 'asset-turnaround'
        ? assetReferenceInput(kind, asset, input.requireBaseReference === true)
        : []
    const params = {
      ...(resolvedTarget.params ?? {}),
      count: 1,
      action,
      assetType: kind,
      assetId: asset.id,
      modelIsUpstream: resolvedTarget.modelIsUpstream === true,
    }
    return taskOf({
      planId: input.planId,
      operationId: input.operationId,
      action,
      subject,
      request: requestOf('image', resolvedTarget, prompt, inputs, params),
      params,
      dependsOn: dependenciesOf(input, action, subject),
      parentRunId: input.parentRunId,
    })
  })
  return {
    id: input.planId,
    workbench: 'storyboard',
    tasks,
    scope: tasks.length === 1 ? 'node' : 'global',
    mode: 'single',
  }
}

function shotPlan(input: StoryboardShotRunPlannerInput): StoryboardRunPlan {
  const shots = selectedShots(input)
  const tasks = shots.map((shot, index) => {
    const action = input.action
    const subject: StoryboardRunSubject = {
      kind: subjectKindOfAction(action),
      id: `shot:${shot.id}`,
      scopeId: `episode:${shot.episodeId}`,
      episodeId: shot.episodeId,
      shotId: shot.id,
    }
    const resolvedTarget = targetOf(input, action, subject)
    if (action === 'shot-image') {
      const prompt = shotPromptWithAssets(input.doc, shot)
      const inputs = shotAssetInputs(
        input.doc,
        shot,
        input.requireAssetBases === true,
      )
      const params = {
        ...(resolvedTarget.params ?? {}),
        count: 1,
        action,
        episodeId: shot.episodeId,
        shotId: shot.id,
        modelIsUpstream: resolvedTarget.modelIsUpstream === true,
      }
      return taskOf({
        planId: input.planId,
        operationId: input.operationId,
        action,
        subject,
        request: requestOf('image', resolvedTarget, prompt, inputs, params),
        params,
        dependsOn: dependenciesOf(input, action, subject),
        parentRunId: input.parentRunId,
      })
    }

    if (!shot.imageHash) {
      throw new Error(`镜头 ${index + 1} 还没有画面，不能先出视频`)
    }
    const sameEpisode = input.doc.shots.filter(
      (item) => item.episodeId === shot.episodeId,
    )
    const currentIndex = sameEpisode.findIndex((item) => item.id === shot.id)
    const nextCandidate = sameEpisode[currentIndex + 1]
    const videoInputPolicy = input.shotVideoInputs?.(
      shot,
      nextCandidate,
    )
    const nextShot =
      (videoInputPolicy?.includeEndFrame ??
        input.includeNextShotEndFrame === true)
        ? nextCandidate
        : undefined
    const inputs: NodeInput[] = [
      {
        kind: 'asset',
        nodeId: `shot:${shot.id}`,
        assetHash: shot.imageHash,
        mime: videoInputPolicy?.imageMime ?? input.imageMime ?? 'image/png',
      },
    ]
    if (nextShot?.imageHash) {
      inputs.push({
        kind: 'asset',
        nodeId: `shot:${nextShot.id}`,
        assetHash: nextShot.imageHash,
        mime:
          videoInputPolicy?.endFrameMime ??
          input.nextImageMime ??
          'image/png',
      })
    }
    const prompt = shotVideoPrompt(input.doc, shot, nextShot)
    const params = {
      ...(resolvedTarget.params ?? {}),
      action,
      episodeId: shot.episodeId,
      shotId: shot.id,
      durationSec: shot.durationSec,
      modelIsUpstream: resolvedTarget.modelIsUpstream === true,
      ...(nextShot?.imageHash ? { endFrameHash: nextShot.imageHash } : {}),
    }
    return taskOf({
      planId: input.planId,
      operationId: input.operationId,
      action,
      subject,
      request: requestOf('video', resolvedTarget, prompt, inputs, params),
      params,
      dependsOn: dependenciesOf(input, action, subject),
      parentRunId: input.parentRunId,
    })
  })

  return {
    id: input.planId,
    workbench: 'storyboard',
    tasks,
    scope: tasks.length === 1 ? 'node' : 'global',
    mode: 'single',
  }
}

function postprocessPrompt(action: StoryboardVideoPostprocessAction): string {
  switch (action) {
    case 'video-upscale':
      return '视频超清'
    case 'video-fps':
      return '视频补帧'
    case 'video-erase':
      return ''
    case 'video-edit':
      return '视频编辑'
    case 'video-extend':
      return '延续当前镜头内容与运动，保持人物、场景和画风一致'
  }
}

function videoPostprocessPlan(
  input: StoryboardVideoPostprocessPlannerInput,
): StoryboardRunPlan {
  const shots = selectedPostprocessShots(input)
  const tasks = shots.map((shot, index) => {
    if (!shot.videoHash) {
      throw new Error(`镜头 ${index + 1} 还没有视频，不能执行 ${input.action}`)
    }
    const subject: StoryboardRunSubject = {
      kind: 'video-postprocess',
      id: `shot:${shot.id}`,
      scopeId: `episode:${shot.episodeId}`,
      episodeId: shot.episodeId,
      shotId: shot.id,
    }
    const resolvedTarget = targetOf(input, input.action, subject)
    const inputs: NodeInput[] = [
      {
        kind: 'asset',
        nodeId: `shot:${shot.id}`,
        assetHash: shot.videoHash,
        mime: input.videoMime ?? 'video/mp4',
      },
    ]
    if (
      input.action === 'video-edit' &&
      input.includeReferenceImage === true
    ) {
      if (!shot.imageHash) {
        throw new Error(`镜头 ${index + 1} 没有可引用的画面`)
      }
      inputs.push({
        kind: 'asset',
        nodeId: `shot:${shot.id}:image`,
        assetHash: shot.imageHash,
        mime: input.referenceImageMime ?? 'image/png',
      })
    }
    const prompt = input.prompt?.trim() || postprocessPrompt(input.action)
    const params = {
      ...(resolvedTarget.params ?? {}),
      ...(input.params ?? {}),
      action: input.action,
      episodeId: shot.episodeId,
      shotId: shot.id,
      modelIsUpstream: resolvedTarget.modelIsUpstream === true,
    }
    return taskOf({
      planId: input.planId,
      operationId: input.operationId,
      action: input.action,
      subject,
      request: requestOf('video', resolvedTarget, prompt, inputs, params),
      params,
      dependsOn: dependenciesOf(input, input.action, subject),
      parentRunId: input.parentRunId,
    })
  })
  return {
    id: input.planId,
    workbench: 'storyboard',
    tasks,
    scope: tasks.length === 1 ? 'node' : 'global',
    mode: 'single',
  }
}

function speechPlan(
  input: StoryboardSpeechRunPlannerInput,
): StoryboardRunPlan {
  const episode = input.doc.episodes.find((item) => item.id === input.episodeId)
  if (!episode) throw new Error(`漫剧分集不存在：${input.episodeId}`)
  const selectedShots = input.shotIds ? new Set(input.shotIds) : null
  const selectedLines = input.lineIds ? new Set(input.lineIds) : null
  const tasks: StoryboardRunTask[] = []

  for (const shot of input.doc.shots) {
    if (shot.episodeId !== input.episodeId) continue
    if (selectedShots && !selectedShots.has(shot.id)) continue
    for (const line of shot.lines) {
      if (selectedLines && !selectedLines.has(line.id)) continue
      if (!line.text.trim()) {
        throw new Error(`台词 ${line.id} 为空，不能生成配音`)
      }
      const subject: StoryboardRunSubject = {
        kind: 'speech',
        id: `line:${line.id}`,
        scopeId: `episode:${shot.episodeId}`,
        episodeId: shot.episodeId,
        shotId: shot.id,
        lineId: line.id,
      }
      const resolvedTarget = targetOf(input, 'speech', subject)
      const speech = speechSettingsOf(input.doc, line)
      const character = input.doc.characters.find(
        (item) => item.id === line.speakerId,
      )
      const characterSpeed = character?.speed
      const targetVoice =
        typeof resolvedTarget.params?.voice === 'string'
          ? resolvedTarget.params.voice
          : undefined
      const voice =
        speech.voice || targetVoice || input.defaultVoice || 'alloy'
      const targetSpeed =
        typeof resolvedTarget.params?.speed === 'number' &&
        Number.isFinite(resolvedTarget.params.speed)
          ? resolvedTarget.params.speed
          : undefined
      const speed = line.speed ?? characterSpeed ?? targetSpeed ?? speech.speed
      const speaker =
        character?.name ?? '旁白'
      const audioName = `${speaker}-${line.text.trim().slice(0, 16)}.mp3`
      const params = {
        ...(resolvedTarget.params ?? {}),
        action: 'speech' as const,
        episodeId: shot.episodeId,
        shotId: shot.id,
        lineId: line.id,
        voice,
        speed,
        responseFormat: 'mp3',
        audioName,
        modelIsUpstream: resolvedTarget.modelIsUpstream === true,
      }
      tasks.push(
        taskOf({
          planId: input.planId,
          operationId: input.operationId,
          action: 'speech',
          subject,
          request: {
            kind: 'speech',
            channelId: resolvedTarget.channelId,
            model: resolvedTarget.model,
            prompt: line.text,
            inputs: [],
            params,
            timeoutMs: 120_000,
            ...(resolvedTarget.credentialGroupId
              ? { credentialGroupId: resolvedTarget.credentialGroupId }
              : {}),
            ...(resolvedTarget.credentialGroupIds?.length
              ? {
                  credentialGroupIds: [
                    ...resolvedTarget.credentialGroupIds,
                  ],
                }
              : {}),
          },
          params,
          dependsOn: dependenciesOf(input, 'speech', subject),
          parentRunId: input.parentRunId,
        }),
      )
    }
  }
  if (tasks.length === 0) throw new Error('漫剧执行计划没有匹配的台词')
  return {
    id: input.planId,
    workbench: 'storyboard',
    tasks,
    scope: tasks.length === 1 ? 'node' : 'global',
    mode: 'single',
  }
}

function digitalHumanPlan(
  input: StoryboardDigitalHumanPlannerInput,
): StoryboardRunPlan {
  const episode = input.doc.episodes.find((item) => item.id === input.episodeId)
  if (!episode) throw new Error(`漫剧分集不存在：${input.episodeId}`)
  if (!input.audioHash.trim()) throw new Error('数字人执行缺少音频产物')
  const selected = input.shotIds ? new Set(input.shotIds) : null
  const shots = input.doc.shots.filter(
    (shot) =>
      shot.episodeId === input.episodeId &&
      (!selected || selected.has(shot.id)),
  )
  if (shots.length === 0) throw new Error('漫剧执行计划没有匹配的镜头')
  const prompt =
    input.prompt?.trim() ||
    '生成单人数字人口播视频，保持人物身份、服装、构图与画面风格一致，口型自然贴合配音，避免夸张动作和镜头跳变。'
  const tasks = shots.map((shot) => {
    if (!shot.imageHash) {
      throw new Error(`镜头 ${shot.id} 没有可用于数字人的画面`)
    }
    const subject: StoryboardRunSubject = {
      kind: 'digital-human',
      id: `shot:${shot.id}`,
      scopeId: `episode:${shot.episodeId}`,
      episodeId: shot.episodeId,
      shotId: shot.id,
    }
    const resolvedTarget = targetOf(input, 'digital-human', subject)
    const params = {
      ...(resolvedTarget.params ?? {}),
      ...(input.params ?? {}),
      action: 'digital-human',
      episodeId: shot.episodeId,
      shotId: shot.id,
      durationSec: shot.durationSec,
      modelIsUpstream: resolvedTarget.modelIsUpstream === true,
    }
    return taskOf({
      planId: input.planId,
      operationId: input.operationId,
      action: 'digital-human',
      subject,
      request: requestOf(
        'video',
        resolvedTarget,
        prompt,
        [
          {
            kind: 'asset',
            nodeId: `shot:${shot.id}:image`,
            assetHash: shot.imageHash,
            mime: input.imageMime ?? 'image/png',
          },
          {
            kind: 'asset',
            nodeId: `shot:${shot.id}:speech`,
            assetHash: input.audioHash,
            mime: input.audioMime ?? 'audio/mpeg',
          },
        ],
        params,
      ),
      params,
      dependsOn: dependenciesOf(input, 'digital-human', subject),
      parentRunId: input.parentRunId,
    })
  })
  return {
    id: input.planId,
    workbench: 'storyboard',
    tasks,
    scope: tasks.length === 1 ? 'node' : 'global',
    mode: 'single',
  }
}

/**
 * 从当前漫剧文档生成稳定 RunPlan。
 *
 * 这一版负责资产基准 / 多视角、镜头出图和镜头视频；视频后处理、配音与数字人
 * 在后续 R5/R6 接入同一契约。生成前会校验模型、分集、镜头、所需参考图和前置视频，
 * 不把缺条件留到付费请求发出之后。
 */
export function buildStoryboardRunPlan(
  input: StoryboardRunPlannerInput,
): StoryboardRunPlan {
  if (!input.planId.trim()) throw new Error('漫剧执行计划缺少 planId')
  if (!input.operationId.trim()) throw new Error('漫剧执行计划缺少 operationId')
  let plan: StoryboardRunPlan
  if (input.action === 'asset-base' || input.action === 'asset-turnaround') {
    plan = assetPlan(input as StoryboardAssetRunPlannerInput)
  } else if (input.action === 'shot-image' || input.action === 'shot-video') {
    plan = shotPlan(input as StoryboardShotRunPlannerInput)
  } else if (input.action === 'speech') {
    plan = speechPlan(input as StoryboardSpeechRunPlannerInput)
  } else if (input.action === 'digital-human') {
    plan = digitalHumanPlan(input as StoryboardDigitalHumanPlannerInput)
  } else {
    plan = videoPostprocessPlan(
      input as StoryboardVideoPostprocessPlannerInput,
    )
  }
  if (plan.tasks.length === 0) throw new Error('漫剧执行计划为空')
  // 依赖必须能由同一计划完整证明；计划外 task id 不是“外部状态”，执行器
  // 无法判断它是否成功，继续执行只会制造假拓扑。
  runPlanWaves(plan.tasks)
  return plan
}
