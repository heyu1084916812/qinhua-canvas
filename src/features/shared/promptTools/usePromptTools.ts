import { useCallback, useRef, useState } from 'react'
import type { NodeInput } from '../../../domain/shared/execution/types'
import {
  PROMPT_TOOL_SYSTEM,
  promptToolGuard,
  trimToolResult,
  type PromptToolAction,
} from './promptTools'
import { skillGuard, type Skill } from '../../../domain/prompt/skill'

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
  /** 用用户自己的技能跑一次（用户 2026-09-24） */
  runSkill: (text: string, skill: Skill) => void
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

  /**
   * 发起一次 LLM 调用（`run` 与 `runSkill` 共用）。
   *
   * 抽出来的原因：技能与内置动作**只差一段系统指令**。若各写一遍，
   * 取消、错误处理、trim、并发保护这些细节迟早分叉 ——
   * 表现就是「技能能跑但取消不了」这类只有一边做了的差异。
   */
  const invoke = useCallback((args: { system: string; text: string; withImages: boolean }) => {
    const o = optsRef.current
    const ac = new AbortController()
    abortRef.current?.abort() // 连点时取消上一次
    abortRef.current = ac
    setStatus('running')
    setError(null)
    o
      .completeText({
        channelId: o.channelId!,
        model: o.model!,
        system: args.system,
        text: args.text,
        // 只有需要图的动作才带图：给纯文本任务也带图既浪费带宽，
        // 也可能让模型去描述一张与任务无关的图。
        inputs: args.withImages ? (o.imageInputs ?? []) : [],
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

  const run = useCallback(
    (text: string, action: PromptToolAction) => {
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
      invoke({
        system: PROMPT_TOOL_SYSTEM[action],
        text,
        withImages: action === 'describe',
      })
    },
    [invoke],
  )

  /**
   * 用**用户自己的技能**跑一次（用户 2026-09-24）。
   *
   * 与 `run` 唯一的差别是 `system` 来自技能正文，而不是内置常量；
   * 可行性判断也换成 `skillGuard`（它读技能自己声明的输入要求）。
   */
  const runSkill = useCallback(
    (text: string, skill: Skill) => {
      const o = optsRef.current
      if (!o.channelId || !o.model) {
        setError('暂无可用文本模型：请先在创作面板选择平台与模型')
        setStatus('error')
        return
      }
      const guard = skillGuard(skill, { text, imageCount: o.imageInputs?.length ?? 0 })
      if (guard) {
        setError(guard)
        setStatus('error')
        return
      }
      invoke({
        system: skill.content,
        text,
        // 技能声明需要图时才带图（`any` 也带上：那类技能通常要用图才发挥得出来）
        withImages: skill.inputMode !== 'text',
      })
    },
    [invoke],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus('idle')
    setError(null)
  }, [])

  return { run, runSkill, cancel, status, error }
}
