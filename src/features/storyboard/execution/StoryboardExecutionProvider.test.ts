import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../../domain/storyboard/storyboard'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'
import type { Channel } from '../../../domain/project/channel'
import { createChannel } from '../../../domain/project/channel'
import { fingerprintBytesSync } from '../../../domain/shared/hash'
import type {
  ChannelAdapter,
  GeneratedAsset,
} from '../../../platform/channels/types'
import type { GenerationClient } from '../../../platform/generation'
import { createMemoryPlatform } from '../../../platform/memory'
import {
  clearGuardedChannelRuns,
  interruptGuardedRunsForRemovedChannels,
} from '../../../state/shared/runChannelGuard'
import {
  StoryboardExecutionProvider,
  useStoryboardExecution,
  type StoryboardExecutionApi,
  type StoryboardExecutionProviderProps,
} from './StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from './storyboardCommandExecutor'
import { clearStoryboardExecutionStatus } from './storyboardExecutionStatus'

function fixture(): {
  doc: StoryboardDoc
  channel: Channel
  plan: StoryboardRunPlan
} {
  let doc = addEpisode(emptyStoryboard('project-1', 1))
  doc = addShot(doc, doc.episodes[0]!.id)
  const channel: Channel = {
    ...createChannel({
      name: 'Storyboard test channel',
      protocol: 'mock',
      baseUrl: '',
    }),
    id: 'channel-1',
    enabled: true,
    hasToken: true,
  }
  const episode = doc.episodes[0]!
  const shot = doc.shots[0]!
  const planId = 'plan-1'
  return {
    doc,
    channel,
    plan: {
      id: planId,
      workbench: 'storyboard',
      scope: 'node',
      mode: 'single',
      tasks: [
        {
          id: `${planId}:shot-image:shot:${shot.id}`,
          nodeId: `shot:${shot.id}`,
          planId,
          workbench: 'storyboard',
          operationId: 'operation-1',
          action: 'shot-image',
          subject: {
            kind: 'shot-image',
            id: `shot:${shot.id}`,
            scopeId: `episode:${episode.id}`,
            episodeId: episode.id,
            shotId: shot.id,
          },
          request: {
            kind: 'image',
            channelId: channel.id,
            model: 'image-model',
            prompt: 'test image',
            inputs: [],
            params: {},
          },
          dependsOn: [],
          fingerprint: 'shot-image-1',
          params: {
            action: 'shot-image',
            episodeId: episode.id,
            shotId: shot.id,
          },
        },
      ],
    },
  }
}

function documentPort(initial: StoryboardDoc): {
  port: StoryboardDocumentPort
  current: () => StoryboardDoc
} {
  let current = initial
  return {
    port: {
      load: vi.fn(async () => current),
      save: vi.fn(async (next) => {
        current = next
      }),
    },
    current: () => current,
  }
}

function adapter(
  generateImage: ChannelAdapter['generateImage'],
): ChannelAdapter {
  return {
    protocol: 'mock',
    verify: async () => ({ ok: true, models: [] }),
    listModels: async () => [],
    generateImage,
    generateVideo: async () => [],
    completeText: async () => ({ text: '' }),
  }
}

function generationClient(
  channel: Channel,
  channelAdapter: ChannelAdapter,
): GenerationClient {
  return {
    resolve: vi.fn(async () => ({
      channelId: channel.id,
      channelName: channel.name,
      protocol: channel.protocol,
      upstreamModel: 'image-model',
      config: {},
      adapter: channelAdapter,
    })),
  } as unknown as GenerationClient
}

function renderApi(
  props: Omit<StoryboardExecutionProviderProps, 'children'>,
): StoryboardExecutionApi {
  let api: StoryboardExecutionApi | null = null
  function CaptureApi() {
    api = useStoryboardExecution()
    return createElement('div')
  }

  renderToStaticMarkup(
    createElement(
      StoryboardExecutionProvider,
      props,
      createElement(CaptureApi),
    ),
  )
  if (!api) throw new Error('Storyboard execution API was not rendered')
  return api
}

describe('StoryboardExecutionProvider R8 acceptance', () => {
  beforeEach(() => {
    clearStoryboardExecutionStatus()
    clearGuardedChannelRuns()
  })

  afterEach(() => {
    clearStoryboardExecutionStatus()
    clearGuardedChannelRuns()
  })

  it('persists a successful business hash and RunRecord without any projection port', async () => {
    const { doc, channel, plan } = fixture()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const hash = fingerprintBytesSync(bytes)
    const generated: GeneratedAsset = {
      hash,
      mime: 'image/png',
      bytes,
    }
    const generateImage = vi.fn(async () => [generated])
    const channelAdapter = adapter(generateImage)
    const generation = generationClient(channel, channelAdapter)
    const platform = createMemoryPlatform()
    const documents = documentPort(doc)
    const api = renderApi({
      projectId: 'project-1',
      storage: platform.storage,
      assets: platform.assets,
      documents: documents.port,
      generation,
      channels: () => [channel],
    })

    const outcome = await api.run(plan)

    expect(outcome.summary.succeeded).toBe(1)
    expect(outcome.failures).toEqual([])
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(generation.resolve).toHaveBeenCalledTimes(1)
    expect(documents.current().shots[0]?.imageHash).toBe(hash)

    const records = await platform.storage.query('runRecords', {
      projectId: 'project-1',
    })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      status: 'succeeded',
      outputHashes: [hash],
      scope: {
        workbench: 'storyboard',
        action: 'shot-image',
        subjectId: `shot:${doc.shots[0]!.id}`,
      },
    })
    expect(
      api.subjectStateOf(`shot:${doc.shots[0]!.id}`, 'shot-image'),
    ).toEqual({ kind: 'succeeded', duration: expect.any(Number), result: [] })
    expect(
      api.subjectStateOf(`shot:${doc.shots[0]!.id}`, 'shot-video'),
    ).toBeUndefined()
  })

  it('cancels an active run when its channel is removed and never resends it', async () => {
    const { doc, channel, plan } = fixture()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const generateImage = vi.fn(
      (_request: Parameters<ChannelAdapter['generateImage']>[0], signal: AbortSignal) =>
        new Promise<GeneratedAsset[]>((_resolve, reject) => {
          markStarted()
          const abort = () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        }),
    )
    const channelAdapter = adapter(generateImage)
    const generation = generationClient(channel, channelAdapter)
    const platform = createMemoryPlatform()
    const documents = documentPort(doc)
    const api = renderApi({
      projectId: 'project-1',
      storage: platform.storage,
      assets: platform.assets,
      documents: documents.port,
      generation,
      channels: () => [channel],
    })

    const running = api.run(plan)
    await started
    expect(
      interruptGuardedRunsForRemovedChannels(new Set([channel.id])),
    ).toBe(1)
    const outcome = await running

    expect(outcome.summary.canceled).toBe(1)
    expect(outcome.summary.succeeded).toBe(0)
    expect(generation.resolve).toHaveBeenCalledTimes(1)
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(documents.current().shots[0]?.imageHash).toBeUndefined()
    expect(
      api.subjectStateOf(`shot:${doc.shots[0]!.id}`, 'shot-image'),
    ).toEqual({ kind: 'canceled' })

    const records = await platform.storage.query('runRecords', {
      projectId: 'project-1',
    })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'canceled' })
  })
})
