import { useMemo, useSyncExternalStore } from 'react'
import type { Channel } from '../../domain/project/channel'
import {
  resolveChatTarget,
  resolveSpeechTarget,
  type ChatTarget,
  type SpeechTarget,
} from '../../domain/shared/chatTarget'
import { VIDEO_ERASE_MODEL_IDS } from '../../domain/storyboard/videoErase'
import {
  VIDEO_EDIT_MODEL_IDS,
  videoEditRequiresReferenceImage,
  videoEditResolutionsOf,
} from '../../domain/storyboard/videoEdit'
import {
  VIDEO_EXTEND_MODEL_IDS,
  videoExtendDurationsOf,
  videoExtendResolutionsOf,
} from '../../domain/storyboard/videoExtend'
import {
  VIDEO_UPSCALE_MODEL_IDS,
  videoUpscaleOptionsOf,
} from '../../domain/storyboard/videoUpscale'
import type { ChannelStore } from '../../state/channel/channelStore'
import type {
  VideoEraseTarget,
  VideoEditTarget,
  VideoExtendTarget,
  VideoUpscaleTarget,
} from '../../workbenches/storyboard/useStoryboardVideoExecutionController'

const DIGITAL_HUMAN_MODEL_IDS = [
  'Kling V2 数字人口播 Std',
  'Kling V2 数字人口播 Pro',
] as const

export interface StoryboardDigitalHumanTarget {
  channelId: string
  channelName: string
  model: (typeof DIGITAL_HUMAN_MODEL_IDS)[number]
}

export interface StoryboardTargets {
  digitalHumanTarget: StoryboardDigitalHumanTarget | null
  videoUpscaleTargets: VideoUpscaleTarget[]
  videoEditTargets: VideoEditTarget[]
  videoEraseTargets: VideoEraseTarget[]
  videoExtendTargets: VideoExtendTarget[]
  chatTarget: ChatTarget | null
  speechTarget: SpeechTarget | null
}

export function resolveStoryboardTargets(
  channels: readonly Channel[],
): StoryboardTargets {
  let digitalHumanTarget: StoryboardDigitalHumanTarget | null = null
  for (const modelId of DIGITAL_HUMAN_MODEL_IDS) {
    const channel = channels.find(
      (item) =>
        item.enabled &&
        item.models.some(
          (model) => model.id === modelId && model.category === 'video',
        ),
    )
    if (channel) {
      digitalHumanTarget = {
        channelId: channel.id,
        channelName: channel.name,
        model: modelId,
      }
      break
    }
  }

  const videoUpscaleTargets: VideoUpscaleTarget[] = []
  const videoEditTargets: VideoEditTarget[] = []
  const videoEraseTargets: VideoEraseTarget[] = []
  const videoExtendTargets: VideoExtendTarget[] = []

  for (const channel of channels) {
    if (!channel.enabled) continue

    for (const model of VIDEO_UPSCALE_MODEL_IDS) {
      const capability = channel.models.find(
        (item) =>
          item.id === model &&
          item.category === 'video' &&
          item.inputTypes.includes('video'),
      )
      const options = videoUpscaleOptionsOf(model)
      if (!capability || !options) continue
      videoUpscaleTargets.push({
        channelId: channel.id,
        channelName: channel.name,
        model,
        label: `${model} · ${channel.name}`,
        resolutions: options.resolutions,
        frameRates: options.frameRates,
      })
    }

    for (const model of VIDEO_EDIT_MODEL_IDS) {
      const capability = channel.models.find(
        (item) =>
          item.id === model &&
          item.category === 'video' &&
          item.inputTypes.includes('video'),
      )
      if (!capability) continue
      videoEditTargets.push({
        channelId: channel.id,
        channelName: channel.name,
        model,
        label: `${model} · ${channel.name}`,
        resolutions: videoEditResolutionsOf(model),
        supportsReferenceImage: capability.inputTypes.includes('image'),
        requiresReferenceImage: videoEditRequiresReferenceImage(model),
      })
    }

    for (const model of VIDEO_ERASE_MODEL_IDS) {
      const capability = channel.models.find(
        (item) =>
          item.id === model &&
          item.category === 'video' &&
          item.inputTypes.includes('video'),
      )
      if (!capability) continue
      videoEraseTargets.push({
        channelId: channel.id,
        channelName: channel.name,
        model,
        label: `${model} · ${channel.name}`,
      })
    }

    for (const model of VIDEO_EXTEND_MODEL_IDS) {
      const capability = channel.models.find(
        (item) =>
          item.id === model &&
          item.category === 'video' &&
          item.inputTypes.includes('video'),
      )
      if (!capability) continue
      videoExtendTargets.push({
        channelId: channel.id,
        channelName: channel.name,
        model,
        label: `${model} · ${channel.name}`,
        resolutions: videoExtendResolutionsOf(model),
        durations: videoExtendDurationsOf(model),
      })
    }
  }

  return {
    digitalHumanTarget,
    videoUpscaleTargets,
    videoEditTargets,
    videoEraseTargets,
    videoExtendTargets,
    chatTarget: resolveChatTarget(channels),
    speechTarget: resolveSpeechTarget(channels),
  }
}

export function useStoryboardTargets(
  channels: Pick<ChannelStore, 'subscribe' | 'getState'>,
): StoryboardTargets {
  const channelList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  return useMemo(() => resolveStoryboardTargets(channelList), [channelList])
}
