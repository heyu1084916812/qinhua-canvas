import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot, PromptData } from '../../../domain/canvas/model/node'
import type { NodeInput } from '../../../domain/shared/execution/types'
import { promptSpec } from '../../../domain/canvas/nodeSpecs/prompt'
import {
  PROMPT_COMPOSE_TEXT,
  effectivePresetText,
  type PromptToolAction,
} from '../../../domain/prompt/presetText'
import { trimToolResult } from '../../shared/promptTools/promptTools'
import { asAppError, describeError } from '../../../shared/result'

/**
 * 面板草稿 → LLM → 提示词节点正文（用户 2026-10-23）。
 *
 * 三种入口都收敛到这里：
 * 1. 面板写了「反推图片」+ 上游图片 → 多模态反推；
 * 2. 面板写了纯文本需求（如「写一个小乌龟的故事」）→ 文本模型生成；
 * 3. 面板有草稿但节点正文为空 → 先补正文，再跑下游。
 *
 * 关键边界：
 * - 只在 `text` 为空时运行；已有正文（无论是手写还是上次生成）一律不覆盖，
 *   否则用户改完草稿再点生成会把节点里已经满意的结果冲掉；
 * - 有上游图片才把图片发给模型；纯文本需求不强行带图；
 * - 模型返回空 / 请求失败都算失败，不写空正文、不继续跑下游。
 */

export interface ComposePromptRequest {
  channelId: string
  model: string
  system: string
  text: string
  inputs: NodeInput[]
  signal: AbortSignal
}

export type ComposePromptResult =
  | { kind: 'skip'; reason: 'has-text' | 'no-draft' }
  | { kind: 'failed'; message: string }
  | { kind: 'applied'; text: string }

export interface ComposePromptOptions {
  node: NodeSnapshot<PromptData>
  graph: GraphSnapshot
  completeText: (request: ComposePromptRequest) => Promise<string>
  presetOverrides?: Partial<Record<PromptToolAction, string>>
  signal?: AbortSignal
}

export async function composePromptFromDraft(
  options: ComposePromptOptions,
): Promise<ComposePromptResult> {
  const { node, graph, completeText, presetOverrides, signal } = options
  const data = node.data

  if ((data.text ?? '').trim()) return { kind: 'skip', reason: 'has-text' }
  const draft = (data.draft ?? '').trim()
  if (!draft) return { kind: 'skip', reason: 'no-draft' }

  const channelId = data.channelId
  const model = data.model
  if (!channelId || !model) {
    return {
      kind: 'failed',
      message: '生成提示词需要文本模型：请先在创作面板选择平台与模型',
    }
  }

  /**
   * 与「反推」按钮共用同一份输入收集：上游生成节点 → 图片素材。
   * 不在这里另扫一遍图，否则「按钮反推」和「点生成」会各有一套口径。
   */
  const imageInputs = promptSpec
    .collectInputs({ node, graph })
    .filter((input) => input.kind === 'asset')

  /**
   * 有图时沿用后台可编辑的「反推」指令（用户能在中枢改它）；
   * 纯文本需求则用内部 compose 指令，避免把「优化」的改写语义硬套过来。
   */
  const system = imageInputs.length
    ? effectivePresetText('describe', presetOverrides)
    : PROMPT_COMPOSE_TEXT

  const ac = new AbortController()
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await completeText({
      channelId,
      model,
      system,
      text: draft,
      inputs: imageInputs,
      signal: ac.signal,
    })
    const text = trimToolResult(result)
    if (!text) {
      return { kind: 'failed', message: '提示词生成失败：模型没有返回内容' }
    }
    return { kind: 'applied', text }
  } catch (error) {
    if (ac.signal.aborted || signal?.aborted) {
      return { kind: 'failed', message: '提示词生成已取消' }
    }
    const appError = asAppError(error)
    return {
      kind: 'failed',
      message: appError
        ? `提示词生成失败：${describeError(appError)}`
        : `提示词生成失败：${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
