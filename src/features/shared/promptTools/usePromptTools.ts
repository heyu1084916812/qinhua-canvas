import { useCallback, useRef, useState } from 'react'
import type { NodeInput } from '../../../domain/shared/execution/types'
import {
  PROMPT_TOOL_SYSTEM,
  promptToolGuard,
  trimToolResult,
  type PromptToolAction,
} from './promptTools'

/** 文本 LLM 调用契约（由宿主提供，如 CanvasExecutionApi.completeText） */
export type PromptToolCompleteText = (req: {
  channelId: string
  model: string
  system: string
  text: string
  /** 随请求一起送出的素材（反推提示词要把上游图片发给模型） */
  inputs?: NodeInput[]
  signal: AbortSignal
}) => Promise<string>

export interface UsePromptToolsOptions {
  completeText: PromptToolCompleteText
  channelId?: string
  model?: string
  /** 上游图片素材（反推用）；不带即纯文本动作 */
  imageInputs?: NodeInput[]
  /** 结果回写（覆盖文本并保留撤销记录由调用方决定 transient） */
  onResult: (text: string) => void
}

export interface UsePromptToolsResult {
  /** 点击入口：先过守卫（不通过则直接置 error），再发起请求 */
  run: (text: string, action: PromptToolAction) => void
  cancel: () => void
  status: 'idle' | 'running' | 'error'
  error: string | null
}

/**
 * 提示词节点「优化 / 翻译」的共享 hook（架构 §3 features/shared/promptTools）。
 * 请求期间可取消（AbortController）；取消 = 回到 idle 不算失败；
 * 失败保留原文，错误文案可重试（再次 run 即重试）。
 */
export function usePromptTools(opts: UsePromptToolsOptions): UsePromptToolsResult {
  // opts 每渲染都是新对象，run/cancel 用 ref 取最新值，避免闭包陈旧
  const optsRef = useRef(opts)
  optsRef.current = opts

  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback((text: string, action: PromptToolAction) => {
    const o = optsRef.current
    const guard = promptToolGuard({
      channelId: o.channelId,
      model: o.model,
      text,
      action,
      imageCount: o.imageInputs?.length ?? 0,
    })
    if (guard) {
      setError(guard)
      setStatus('error')
      return
    }
    const ac = new AbortController()
    abortRef.current?.abort() // 连点时取消上一次
    abortRef.current = ac
    setStatus('running')
    setError(null)
    o
      .completeText({
        channelId: o.channelId!,
        model: o.model!,
        system: PROMPT_TOOL_SYSTEM[action],
        text,
        // 只有反推带图：给「优化 / 翻译」也带上图既浪费带宽，
        // 也可能让模型去描述一张与任务无关的图。
        inputs: action === 'describe' ? (o.imageInputs ?? []) : [],
        signal: ac.signal,
      })
      .then((result) => {
        if (ac.signal.aborted) return
        o.onResult(trimToolResult(result))
        setStatus('idle')
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) {
          setStatus('idle')
          return
        }
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus('idle')
    setError(null)
  }, [])

  return { run, cancel, status, error }
}
