import { useCallback, useRef, useState } from 'react'
import type { NodeInput } from '../../../domain/shared/execution/types'
import {
  promptToolGuard,
  trimToolResult,
  type PromptToolAction,
} from './promptTools'
import { effectivePresetText } from '../../../domain/prompt/presetText'
import { asAppError, describeError } from '../../../shared/result'

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
  /**
   * 用户在后台改过的预设词（后台中枢，用户 2026-09-25）。
   *
   * 由调用方从 `PresetTextProvider` 取来传进来，而不是 hook 自己去 useContext ——
   * 这个 hook 住 `features/shared`，不该反向依赖 `app/providers`。
   * 缺省（`{}` 或 undefined）= 三个动作全按出厂默认跑。
   */
  presetOverrides?: Partial<Record<PromptToolAction, string>>
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
        /**
         * 归一化成**人话**再显示（用户 2026-09-24 截图报「面板里出现 `[channel] channel`」）。
         *
         * 渠道层抛的是 `ChannelError`，它的 `message` 是给开发者看的调试串
         * （`[channel] channel`），直接 `e.message` 就把内部术语糊到用户脸上，
         * 而且没有说明**该怎么办**。
         *
         * `asAppError` 会把 ChannelError 拆到它真正的 `appError` 载荷上，
         * `describeError` 再翻成「渠道错误：…」这类可读文案 —— 别的地方
         * （节点报错、画布提示条）都走这一对，这里此前是漏网的一处。
         *
         * 拿不到 AppError 结构时**仍要兜底**：抛的可能是任意异常（编程错误、
         * 第三方库），那时把 message 原样显示比吞掉更有用。
         */
        const appError = asAppError(e)
        setError(appError ? describeError(appError) : e instanceof Error ? e.message : String(e))
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
        /**
         * 用**生效值**而不是常量：用户在后台改过预设词就按改过的跑。
         * `effectivePresetText` 在覆盖缺失 / 空白 / 超限时一律回落出厂默认，
         * 所以「从没进过后台」与「刚点了恢复默认」是同一条路径。
         */
        system: effectivePresetText(action, o.presetOverrides),
        text,
        withImages: action === 'describe',
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

  return { run, cancel, status, error }
}
