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
  credentialGroupId?: string
  credentialGroupIds?: readonly string[]
}

interface StoryboardPlannerBase {
  doc: StoryboardDoc
  planId: string
  operationId: string
  target: StoryboardRunTarget
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
}

export type StoryboardRunPlannerInput =
  | StoryboardAssetRunPlannerInput
  | StoryboardShotRunPlannerInput

function assertTarget(target: StoryboardRunTarget): void {
  if (!target.channelId.trim()) throw new Error('漫剧执行计划缺少渠道')
  if (!target.model.trim()) throw new Error('漫剧执行计划缺少模型')
}

function requestOf(
  kind: 'image' | 'video',
  input: StoryboardRunPlannerInput,
  prompt: string,
  inputs: readonly NodeInput[],
  params: Record<string, unknown>,
): RunRequest {
  return {
    kind,
    channelId: input.target.channelId,
    model: input.target.model,
    prompt,
    inputs: [...inputs],
    params,
    ...(input.target.credentialGroupId
      ? { credentialGroupId: input.target.credentialGroupId }
      : {}),
    ...(input.target.credentialGroupIds?.length
      ? { credentialGroupIds: [...input.target.credentialGroupIds] }
      : {}),
  }
}

function taskOf(input: {
  planId: string
  operationId: string
  action: StoryboardRunAction
  subject: StoryboardRunSubject
  request: RunRequest
  params: Record<string, unknown>
  dependsOn: readonly string[]
}): StoryboardRunTask {
  const id = `${input.planId}:${input.action}:${input.subject.id}`
  return assertStoryboardRunTask({
    id,
    nodeId: input.subject.id,
    planId: input.planId,
    workbench: 'storyboard',
    operationId: input.operationId,
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
    const prompt =
      action === 'asset-base'
        ? assetBasePrompt(asset, kind)
        : assetTurnaroundPrompt(asset)
    const inputs =
      action === 'asset-turnaround'
        ? assetReferenceInput(kind, asset, input.requireBaseReference === true)
        : []
    const params = {
      action,
      assetType: kind,
      assetId: asset.id,
    }
    return taskOf({
      planId: input.planId,
      operationId: input.operationId,
      action,
      subject,
      request: requestOf('image', input, prompt, inputs, params),
      params,
      dependsOn: dependenciesOf(input, action, subject),
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
    if (action === 'shot-image') {
      const prompt = shotPromptWithAssets(input.doc, shot)
      const inputs = shotAssetInputs(
        input.doc,
        shot,
        input.requireAssetBases === true,
      )
      const params = {
        action,
        episodeId: shot.episodeId,
        shotId: shot.id,
      }
      return taskOf({
        planId: input.planId,
        operationId: input.operationId,
        action,
        subject,
        request: requestOf('image', input, prompt, inputs, params),
        params,
        dependsOn: dependenciesOf(input, action, subject),
      })
    }

    if (!shot.imageHash) {
      throw new Error(`镜头 ${index + 1} 还没有画面，不能先出视频`)
    }
    const sameEpisode = input.doc.shots.filter(
      (item) => item.episodeId === shot.episodeId,
    )
    const currentIndex = sameEpisode.findIndex((item) => item.id === shot.id)
    const nextShot =
      input.includeNextShotEndFrame === true
        ? sameEpisode[currentIndex + 1]
        : undefined
    const inputs: NodeInput[] = [
      {
        kind: 'asset',
        nodeId: `shot:${shot.id}`,
        assetHash: shot.imageHash,
        mime: 'image/png',
      },
    ]
    if (nextShot?.imageHash) {
      inputs.push({
        kind: 'asset',
        nodeId: `shot:${nextShot.id}`,
        assetHash: nextShot.imageHash,
        mime: 'image/png',
      })
    }
    const prompt = shotVideoPrompt(input.doc, shot, nextShot)
    const params = {
      action,
      episodeId: shot.episodeId,
      shotId: shot.id,
      durationSec: shot.durationSec,
      ...(nextShot?.imageHash ? { endFrameHash: nextShot.imageHash } : {}),
    }
    return taskOf({
      planId: input.planId,
      operationId: input.operationId,
      action,
      subject,
      request: requestOf('video', input, prompt, inputs, params),
      params,
      dependsOn: dependenciesOf(input, action, subject),
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
  assertTarget(input.target)
  let plan: StoryboardRunPlan
  if (input.action === 'asset-base' || input.action === 'asset-turnaround') {
    plan = assetPlan(input as StoryboardAssetRunPlannerInput)
  } else {
    plan = shotPlan(input as StoryboardShotRunPlannerInput)
  }
  if (plan.tasks.length === 0) throw new Error('漫剧执行计划为空')
  // 依赖必须能由同一计划完整证明；计划外 task id 不是“外部状态”，执行器
  // 无法判断它是否成功，继续执行只会制造假拓扑。
  runPlanWaves(plan.tasks)
  return plan
}
