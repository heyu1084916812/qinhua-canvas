/**
 * 循环节点的**展开计划**（产品文档 §6.22，2026-09-22）。
 *
 * 纯函数：只回答「这个循环节点该跑几轮、每轮的输入是什么」，
 * 不碰执行引擎、不碰 store、不碰 DOM。展开结果由调用方翻译成 RunTask。
 *
 * 抄的是「大雄无限画布」`smart-loop` 的概念（用户 2026-09-22 指定参考），
 * 但按轻画的分层重写：那边把轮次上下文塞在全局 `smartLoopContext` 里，
 * 这里一律**显式出入参**，于是可单测、也不会有隐式串味。
 */

/**
 * 循环节点的参数（存在 `LoopData` 上）。
 *
 * 注意 `prompts` 是**数组**而不是单个字符串：多条提示词按轮次轮换是这套设计
 * 最实用的部分（写 3 条提示词跑 9 轮 = 1-2-3-1-2-3…）。
 */
export interface LoopParams {
  /** 循环几轮 */
  count: number
  /** 从上游素材的第几张开始（1 起） */
  loopStart: number
  /** 每轮取几张素材 */
  batch: number
  /** 本节点自带的提示词（多条） */
  prompts: string[]
}

/** 一轮的展开结果 */
export interface LoopRound {
  /** 轮次（从 loopStart 起，1 基） */
  index: number
  /** 本轮**会用到**的素材在「上游素材并集」里的下标区间（左闭右开） */
  imageFrom: number
  imageTo: number
  /** 本轮选中的提示词（已做变量替换） */
  prompt: string
}

/** 参数取值的安全钳制：坏数据不该让界面炸掉，也不该让循环跑飞 */
export const LOOP_LIMITS = {
  countMin: 1,
  countMax: 100,
  startMin: 1,
  startMax: 9999,
  batchMin: 1,
  batchMax: 100,
} as const

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(Math.floor(v), max))
}

/** 归一化循环参数（所有入口都该先过它，避免 NaN / 越界值散落到各处） */
export function normalizeLoopParams(raw: Partial<LoopParams> | undefined): LoopParams {
  const p = raw ?? {}
  return {
    count: clamp(Number(p.count ?? 1), LOOP_LIMITS.countMin, LOOP_LIMITS.countMax),
    loopStart: clamp(Number(p.loopStart ?? 1), LOOP_LIMITS.startMin, LOOP_LIMITS.startMax),
    batch: clamp(Number(p.batch ?? 1), LOOP_LIMITS.batchMin, LOOP_LIMITS.batchMax),
    prompts: Array.isArray(p.prompts) ? p.prompts.map((s) => String(s ?? '')) : [],
  }
}

/**
 * 变量替换（§6.22）。两种写法都认：全角书名号 `《计数》` 与半角方括号 `[计数]`。
 *
 * 为什么两种都认：中文输入法下打书名号要切标点，而方括号在英文键盘上更顺手；
 * 原实现（大雄）两种都支持，用户已经习惯了，移植时保留。
 */
export function applyLoopVariables(
  text: string,
  vars: { index: number; total: number },
): string {
  return String(text ?? '')
    .replaceAll('《计数》', String(vars.index))
    .replaceAll('[计数]', String(vars.index))
    .replaceAll('《总数》', String(vars.total))
    .replaceAll('[总数]', String(vars.total))
    .replaceAll('《进度》', `${vars.index}/${vars.total}`)
    .replaceAll('[进度]', `${vars.index}/${vars.total}`)
}

/**
 * 把循环展开成逐轮计划。
 *
 * `upstreamImages` 是「上游素材并集」——由调用方收集好（本模块不读图结构）。
 * `upstreamPrompts` 是上游提示词；它与 `params.prompts` 合并后**取模轮换**。
 *
 * ⚠️ **素材用切片、提示词用取模**（与原实现一致，且是有意的）：
 * - 素材取完就没有了：第 4 轮不该再拿第 1 张图（`slice` 越界自然是空）；
 * - 提示词可以循环复用：写 3 条跑 9 轮，第 4 轮回到第 1 条（`%` 取模）。
 *   统一成一种都会错：都切片则长循环后提示词为空；都取模则素材被重复使用。
 */
export function expandLoopRounds(input: {
  params: Partial<LoopParams> | undefined
  upstreamImages: number
  upstreamPrompts?: readonly string[]
  /** 关掉时本轮不带提示词（下游用各自的） */
  usePrompt?: boolean
  /** 关掉时本轮不带素材（只循环提示词） */
  useImageInput?: boolean
}): LoopRound[] {
  const params = normalizeLoopParams(input.params)
  const total = params.count
  const usePrompt = input.usePrompt !== false
  const useImageInput = input.useImageInput !== false

  // 提示词池：上游在前、本节点在后（与「上游是上下文、本节点是本次指令」的直觉一致）
  const promptPool = usePrompt
    ? [...(input.upstreamPrompts ?? []), ...params.prompts].map((s) => String(s ?? '').trim()).filter(Boolean)
    : []

  const rounds: LoopRound[] = []
  for (let i = 0; i < total; i += 1) {
    const index = params.loopStart + i

    /**
     * 素材切片：第 i 轮从 `(loopStart-1) + i*batch` 开始取 batch 张。
     * `imageTo` 允许超过总数——调用方按实际长度截断即可，
     * 这样「最后一轮不够取」是**正常的空位**，而不是需要特殊处理的边界。
     */
    const from = useImageInput ? params.loopStart - 1 + i * params.batch : 0
    const to = useImageInput ? from + params.batch : 0

    const rawPrompt = promptPool.length ? promptPool[i % promptPool.length] : ''
    rounds.push({
      index,
      imageFrom: Math.max(0, Math.min(from, input.upstreamImages)),
      imageTo: Math.max(0, Math.min(to, input.upstreamImages)),
      prompt: applyLoopVariables(rawPrompt, { index, total }),
    })
  }
  return rounds
}
