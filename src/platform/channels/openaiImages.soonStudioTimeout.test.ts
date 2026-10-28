import { describe, expect, it } from 'vitest'
import { createMemoryNetwork, createMemoryPlatform } from '../memory'
import { createOpenAiImagesAdapter } from './openaiImages'
import {
  IMAGE_GENERATE_TIMEOUT_MS,
  IMAGE_TASK_POLL_TIMEOUT_MS,
} from './openaiCommon'
import { solidPng } from './mockPng'
import type { ResolvedChannelConfig } from './registry'
import type { ImageRunRequest } from './types'

const cfg: ResolvedChannelConfig = {
  id: 'soon',
  protocol: 'soonstudio',
  baseUrl: 'https://soonstudio.ai',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

const signal = new AbortController().signal
const request: ImageRunRequest = {
  kind: 'image',
  channelId: 'soon',
  model: 'gemini-nano-banana-2.1',
  prompt: 'model portrait',
  inputs: [],
  params: { count: 1 },
}

function response(status: number, body: unknown) {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(body)
    },
    async json<T>() {
      return body as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

function dataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/png;base64,${btoa(binary)}`
}

describe('SoonStudio image task timeouts', () => {
  it('uses the image submit timeout instead of the 10 second verification timeout', async () => {
    const tiny = solidPng(3, 2, [0x20, 0x40, 0x60])
    let submitTimeout = 0
    const adapter = createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            submitTimeout = req.timeoutMs ?? 0
            return response(200, { task_id: 'task_submit_timeout' })
          }
          if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_submit_timeout') {
            return response(200, {
              data: {
                status: 'SUCCESS',
                data: { url: [dataUrl(tiny)] },
              },
            })
          }
          return response(404, {})
        },
      }),
      assets: createMemoryPlatform().assets,
    })

    await adapter.generateImage(request, signal)
    expect(submitTimeout).toBe(IMAGE_GENERATE_TIMEOUT_MS)
  })

  it('treats a poll timeout as transient and uses the longer poll timeout', async () => {
    const tiny = solidPng(3, 2, [0x30, 0x50, 0x70])
    const pollTimeouts: number[] = []
    let polls = 0
    const adapter = createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            return response(200, { task_id: 'task_poll_timeout' })
          }
          if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_poll_timeout') {
            pollTimeouts.push(req.timeoutMs ?? 0)
            polls += 1
            if (polls === 1) throw { kind: 'network', detail: 'timeout' }
            return response(200, {
              data: {
                status: 'SUCCESS',
                data: { url: [dataUrl(tiny)] },
              },
            })
          }
          return response(404, {})
        },
      }),
      assets: createMemoryPlatform().assets,
    })

    const assets = await adapter.generateImage(request, signal)
    expect(polls).toBe(2)
    expect(pollTimeouts).toEqual([
      IMAGE_TASK_POLL_TIMEOUT_MS,
      IMAGE_TASK_POLL_TIMEOUT_MS,
    ])
    expect(assets[0]?.bytes).toEqual(tiny)
  })
})
