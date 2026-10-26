import type { Dispatch, SetStateAction } from 'react'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import type { ChannelStore } from '../../state/channel/channelStore'
import type {
  StoryboardDoc,
  StoryboardEpisode,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  breakdownGuard,
  breakdownText,
  buildBreakdownResult,
  buildBreakdownSystem,
  parseBreakdownReply,
  replaceEpisodeShots,
} from '../../domain/storyboard/breakdown'
import {
  applySplit,
  buildSplitSystem,
  buildSplitText,
  parseSplitReply,
  planSplitBatches,
  splitSource,
  type EpisodeEnrichment,
} from '../../domain/storyboard/episodes'
import {
  buildMergeSystem,
  buildMergeText,
  parseMergeReply,
  withoutDismissed,
  type MergeSuggestion,
} from '../../domain/storyboard/mergeSuggest'
import { dismissMerge, mergeAsset } from '../../domain/storyboard/storyboard'
import { asAppError, describeError } from '../../shared/result'

interface ChatTarget {
  channelId: string
  model: string
  label: string
}

interface AbortRef {
  current: AbortController | null
}

export interface StoryboardAuthoringControllerArgs {
  doc: StoryboardDoc
  currentDoc: () => StoryboardDoc | null
  selected: StoryboardEpisode | null
  shots: readonly StoryboardShot[]
  chatTarget: ChatTarget | null
  breakdownSkillContent?: string
  channels: ChannelStore
  projectId: string
  directTrace: (args: {
    subjectId: string
    kind: 'text' | 'video' | 'speech'
    channelId: string
    model: string
    payload: unknown
    inputs?: DirectRunTraceInput['inputs']
    params?: Record<string, unknown>
  }) => DirectRunTraceInput
  apply: (doc: StoryboardDoc) => void
  split: { kind: 'idle' | 'running' | 'done' | 'error'; text: string }
  setSplit: Dispatch<
    SetStateAction<{ kind: 'idle' | 'running' | 'done' | 'error'; text: string }>
  >
  splitConfirm: boolean
  setSplitConfirm: Dispatch<SetStateAction<boolean>>
  splitAbort: AbortRef
  breaking: 'idle' | 'running' | 'done' | 'error'
  setBreaking: Dispatch<
    SetStateAction<'idle' | 'running' | 'done' | 'error'>
  >
  setBreakMsg: Dispatch<SetStateAction<string>>
  breakConfirm: boolean
  setBreakConfirm: Dispatch<SetStateAction<boolean>>
  breakAbort: AbortRef
  setMergeScan: Dispatch<
    SetStateAction<{
      kind: 'idle' | 'running' | 'done' | 'error'
      text: string
    }>
  >
  setMerges: Dispatch<SetStateAction<MergeSuggestion[]>>
  setMergeConfirmId: Dispatch<SetStateAction<string>>
}

export function createStoryboardAuthoringController(
  args: StoryboardAuthoringControllerArgs,
) {
  const {
    doc,
    currentDoc,
    selected,
    shots,
    chatTarget,
    breakdownSkillContent,
    channels,
    projectId,
    directTrace,
    apply,
    split,
    setSplit,
    splitConfirm,
    setSplitConfirm,
    splitAbort,
    breaking,
    setBreaking,
    setBreakMsg,
    breakConfirm,
    setBreakConfirm,
    breakAbort,
    setMergeScan,
    setMerges,
    setMergeConfirmId,
  } = args
  const humanError = (error: unknown) => {
    const appError = asAppError(error)
    return appError
      ? describeError(appError)
      : error instanceof Error
        ? error.message
        : String(error)
  }

  /**
   * **查一遍重复**（对账 #437；研究稿 §370「归并去重，别省」）。
   *
   * 三条纪律与其它 LLM 入口一致：
   * ① **点之前就说清会花一次对话额度**（界面那行小字）；
   * ② 模型只给候选 + 理由，**一个字都不自动改文档**；
   * ③ 解析不过如实报错，不改任何状态。
   */
  const scanMerges = async () => {
    if (!chatTarget) {
      setMergeScan({
        kind: 'error',
        text: '没有可用的对话模型 —— 先去「设置 → 模型服务」给一条服务勾上对话模型',
      })
      return
    }
    setMergeScan({ kind: 'running', text: '' })
    setMerges([])
    setMergeConfirmId('')
    const ac = new AbortController()
    /* 30 秒兜底：这是一次"看一眼清单"的小请求，卡住不该让按钮一直转 */
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const system = buildMergeSystem()
      const user = buildMergeText(doc)
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal: ac.signal,
        trace: directTrace({
          subjectId: `project:${projectId}:merge-scan`,
          kind: 'text',
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          payload: { system, user },
        }),
      })
      const parsed = parseMergeReply(result.text, doc)
      if (!parsed.ok) {
        setMergeScan({ kind: 'error', text: parsed.error })
        return
      }
      /* 用户已经说过"不是同一个"的那些不再提（#437 的第四条口径） */
      const fresh = withoutDismissed(doc, parsed.suggestions)
      setMerges(fresh)
      setMergeScan(
        fresh.length === 0
          ? { kind: 'done', text: '没发现还没确认过的重复' }
          : { kind: 'done', text: `找到 ${fresh.length} 组疑似重复 —— 逐条看过再决定` },
      )
    } catch (e) {
      if (ac.signal.aborted) {
        setMergeScan({ kind: 'error', text: '查重超时（30 秒没回）。稍后再试。' })
      } else {
        const err = asAppError(e)
        setMergeScan({ kind: 'error', text: err ? describeError(err) : '查重失败：这次没拿到结果' })
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 确认合并这一组（一次合并组里其余每一条；`mergeAsset` 一次只吃一个 drop） */
  const acceptMerge = (suggestion: MergeSuggestion) => {
    let next = doc
    for (const dropId of suggestion.dropIds) {
      next = mergeAsset(next, suggestion.kind, suggestion.keepId, dropId, 0)
    }
    apply(next)
    setMerges((list) => list.filter((item) => item !== suggestion))
    setMergeConfirmId('')
    setMergeScan({ kind: 'done', text: '已合并 —— 别名与引用都跟着过来了' })
  }

  /** 「不是同一个」：记进文档，以后不再问这一对 */
  const dismissMergeSuggestion = (suggestion: MergeSuggestion) => {
    let next = doc
    for (const dropId of suggestion.dropIds) {
      next = dismissMerge(next, suggestion.kind, suggestion.keepId, dropId, 0)
    }
    apply(next)
    setMerges((list) => list.filter((item) => item !== suggestion))
    setMergeConfirmId('')
  }

  /**
   * 「拆成多集」（对账 #417；调研稿 M7-2）。
   *
   * 分工是刻意的：**切分点由结构决定，模型只起名**。
   * - 没配对话模型 ⇒ 照样拆（章节标记 / 字数兜底都是确定性的），只是标题用结构值；
   * - 模型回错 / 超时 ⇒ **先落地结构切分**再如实报错 —— 切分不该因为模型挂了就一集都拆不出来；
   * - 已有分集 ⇒ 两下确认，第二下说清"会替换 N 集（含 M 个镜头）"（`applySplit` 会清镜头）。
   */
  const runSplit = async () => {
    if (split.kind === 'running') return
    const chunks = splitSource(doc.sourceText)
    if (chunks.length === 0) {
      setSplit({ kind: 'error', text: '还没有原文可拆：先把小说 / 大纲粘进上面的「原文」' })
      setSplitConfirm(false)
      return
    }
    if (doc.episodes.length > 0 && !splitConfirm) {
      setSplitConfirm(true)
      setSplit({ kind: 'idle', text: '' })
      return
    }
    setSplitConfirm(false)
    if (!chatTarget) {
      apply(applySplit(doc, chunks, null, 0))
      setSplit({
        kind: 'done',
        text: `按结构拆出 ${chunks.length} 集（没配对话模型，标题用章节名 / 第 N 集）`,
      })
      return
    }
    const ac = new AbortController()
    splitAbort.current = ac
    setSplit({ kind: 'running', text: '' })
    try {
      const batches = planSplitBatches(chunks)
      const enrichment: EpisodeEnrichment[] = []
      let named = 0
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i]!
        const system = buildSplitSystem()
        const user = buildSplitText(batch, i, batches.length)
        const result = await channels.completeWithTools({
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          tools: [],
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          signal: ac.signal,
          trace: directTrace({
            subjectId: `project:${projectId}:split:${i + 1}`,
            kind: 'text',
            channelId: chatTarget.channelId,
            model: chatTarget.model,
            payload: { system, user },
          }),
        })
        if (ac.signal.aborted) return
        const parsed = parseSplitReply(result.text, batch.length)
        if (parsed) {
          enrichment.push(...parsed)
          named += parsed.length
        } else {
          /* 这一批没按契约来：整批回落结构标题（不硬对，免得标题整体错位） */
          for (let k = 0; k < batch.length; k += 1) {
            enrichment.push({ title: '', summary: '', hookOpen: '', hookEnd: '' })
          }
        }
      }
      const base = currentDoc()
      if (!base) return
      apply(applySplit(base, chunks, enrichment, 0))
      setSplit({
        kind: 'done',
        text:
          named === chunks.length
            ? `已拆出 ${chunks.length} 集（标题 / 梗概 / 钩子由模型给）`
            : named === 0
              ? `已拆出 ${chunks.length} 集 —— 模型这次没按契约返回，标题用章节名 / 第 N 集`
              : `已拆出 ${chunks.length} 集（${named} 集有模型命名，其余用结构标题）`,
      })
    } catch (e) {
      if (ac.signal.aborted) return
      const base = currentDoc() ?? doc
      apply(applySplit(base, chunks, null, 0))
      setSplit({ kind: 'error', text: `${humanError(e)} —— 已按结构先拆出 ${chunks.length} 集` })
    } finally {
      if (splitAbort.current === ac) splitAbort.current = null
    }
  }

  const cancelSplit = () => {
    splitAbort.current?.abort()
    splitAbort.current = null
    setSplit({ kind: 'idle', text: '' })
    setSplitConfirm(false)
  }

  /**
   * 「用模型拆这一集」（#414）。
   *
   * 四道门，一道都不省：**有对话模型** → **这一集有内容可拆** → **已有镜头时两下确认**
   * → **解析校验通过才落库**。任何一道没过都只改界面上的说明，绝不写文档。
   */
  const runBreakdown = async () => {
    if (!selected || breaking === 'running') return
    const guard = breakdownGuard(doc, selected)
    if (guard) {
      setBreaking('error')
      setBreakMsg(guard)
      setBreakConfirm(false)
      return
    }
    if (!chatTarget) {
      setBreaking('error')
      setBreakMsg('还没有可用的对话模型 —— 去「全局设置 → 模型服务」给一条服务勾上对话模型')
      setBreakConfirm(false)
      return
    }
    if (shots.length > 0 && !breakConfirm) {
      setBreakConfirm(true)
      setBreaking('idle')
      setBreakMsg('')
      return
    }
    setBreakConfirm(false)
    const ac = new AbortController()
    breakAbort.current = ac
    setBreaking('running')
    setBreakMsg('')
    try {
      /* 系统指令取**内置技能**正文（改技能即改行为），后面接机器契约（见 breakdown.ts） */
      const system = buildBreakdownSystem(breakdownSkillContent)
      const user = breakdownText(doc, selected)
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal: ac.signal,
        trace: directTrace({
          subjectId: `episode:${selected.id}:breakdown`,
          kind: 'text',
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          payload: { system, user },
        }),
      })
      if (ac.signal.aborted) return
      const parsed = parseBreakdownReply(result.text)
      if (!parsed.ok) {
        setBreaking('error')
        setBreakMsg(parsed.error)
        return
      }
      const base = currentDoc()
      if (!base) return
      /**
       * 拆镜 + 资产提取一起落（对账 #416）：模型给的是**名字**，先归并进资产库
       * （同名 / 别名合成一条、已有资产只增不减），再把名字翻成 id 绑到这一集的镜头上。
       */
      const built = buildBreakdownResult(base, selected.id, parsed)
      apply(replaceEpisodeShots(built.doc, selected.id, built.shots, 0))
      setBreaking('done')
      setBreakMsg(`已拆出 ${built.shots.length} 镜`)
    } catch (e) {
      if (ac.signal.aborted) return
      setBreaking('error')
      setBreakMsg(humanError(e))
    } finally {
      if (breakAbort.current === ac) breakAbort.current = null
    }
  }

  const cancelBreakdown = () => {
    breakAbort.current?.abort()
    breakAbort.current = null
    setBreaking('idle')
    setBreakMsg('')
    setBreakConfirm(false)
  }


  return {
    scanMerges,
    acceptMerge,
    dismissMergeSuggestion,
    runSplit,
    cancelSplit,
    runBreakdown,
    cancelBreakdown,
  }
}
