import { normalizeLoopParams } from './loopPlan'
import type { LoopData } from '../model/node'

/**
 * 「这套参数实际会怎么跑」——把三个数字翻译成一句人话（用户 2026-09-23）。
 *
 * ## 为什么必须做这件事
 *
 * 循环节点的核心是三个数字互相配合：起始计数决定从第几张取、次数决定跑几轮、
 * 批次决定每轮取几张。但界面上它们只是三个孤立的小方框，用户**看不出它们的关系**——
 * 「起始 2 / 次数 3 / 批次 1」到底会跑哪几张？只能自己心算。
 *
 * 参考项目（大雄）也没做这件事；用户给的 AI 设计稿里同样是三个孤立数字。
 * 这是本轮补上的关键信息：**参数改完，界面直接说出结果**。
 *
 * 抽成纯函数而不是写在视图里：文案分叉很多（超范围 / 素材不够 / 无素材 / 未开启），
 * 正是最容易写错的那类逻辑，必须能在 node 下逐个断言。
 */

export interface LoopSummary {
  /** 主体那句：会跑第几轮、每轮取哪些图 */
  text: string
  /**
   * 语气：`ok` 正常 / `warn` 能跑但要提醒（如上游不够） / `blocked` 跑不起来。
   * 视图据此决定用哪个颜色 token——**不在这里定颜色**（主题由 CSS 变量管）。
   */
  tone: 'ok' | 'warn' | 'blocked'
}

/** 把 1 基的区间写成「第 2–4 张」/「第 2 张」 */
function rangeLabel(from: number, to: number): string {
  return from === to ? `第 ${from} 张` : `第 ${from}–${to} 张`
}

export function loopSummary(
  data: Pick<LoopData, 'count' | 'loopStart' | 'batch' | 'useImageInput' | 'usePrompt'> & {
    /**
     * 本节点自带的提示词。**可选**：只有「只开提示词通道」那一档需要它来数池子，
     * 其余档（图片为主）根本不读。要求必填会逼所有调用方多传一个用不上的字段。
     */
    prompts?: string[]
  },
  upstream: { images: number; prompts: number },
): LoopSummary {
  const p = normalizeLoopParams(data)
  const useImage = data.useImageInput
  const usePrompt = data.usePrompt

  // 两个通道都关掉 ⇒ 无事可做。这一档要明确说「跑不起来」，
  // 否则用户点运行会以为是坏了（本项目「点了没反应」那类缺陷的固定来源）。
  if (!useImage && !usePrompt) {
    return { text: '两个通道都关着，打开后才能运行', tone: 'blocked' }
  }

  const roundText = `${p.count} 轮`
  const first = p.loopStart
  const last = p.loopStart + p.count - 1

  /** 只开提示词：提示词是**取模轮换**的，取不完，所以不必担心「不够」 */
  if (!useImage) {
    const pool = upstream.prompts + (data.prompts ?? []).filter((s) => s.trim()).length
    if (pool === 0) {
      return { text: '还没有可用的提示词', tone: 'blocked' }
    }
    return { text: `跑 ${roundText}，提示词按轮次轮换`, tone: 'ok' }
  }

  /** 只开图片 / 两个都开：主体是「跑几轮、取哪几张图」 */
  if (upstream.images === 0) {
    return { text: '上游还没有图片', tone: 'blocked' }
  }

  /**
   * 起始计数越界：用户把起始调到比素材总数还大，一张都取不到。
   *
   * 这是**最容易发生又最不容易发现**的错误——三个数字各自都在合法范围内，
   * 组合起来却跑空。所以单独一档，并直接给出可行范围。
   */
  if (first > upstream.images) {
    return {
      text: `起始 ${first} 超过上游 ${upstream.images} 张，没有可取的图`,
      tone: 'blocked',
    }
  }

  /**
   * 实际能跑几轮：素材**取完就没有了**（与提示词的取模轮换不同）。
   *
   * 每轮吃 batch 张，所以能覆盖的轮数 = 从起始位置起剩余素材能撑几轮。
   * 取整用 ceil：最后一轮哪怕只剩 1 张也照跑（`expandLoopRounds` 就是这么切的）。
   */
  const remaining = upstream.images - (first - 1)
  const roundsCanRun = Math.ceil(remaining / p.batch)
  const actualRounds = Math.min(p.count, roundsCanRun)

  if (actualRounds < p.count) {
    return {
      text: `素材只够跑 ${actualRounds} 轮（设了 ${p.count} 轮）`,
      tone: 'warn',
    }
  }

  /** 每轮取几张的范围：第 1 轮从起始取，之后依次往后推 */
  const firstTo = Math.min(first + p.batch - 1, upstream.images)
  const lastFrom = first + (p.count - 1) * p.batch
  const lastTo = Math.min(lastFrom + p.batch - 1, upstream.images)

  if (p.batch === 1) {
    return { text: `跑 ${roundText}：${rangeLabel(first, last)}`, tone: 'ok' }
  }
  return {
    text: `跑 ${roundText}：每轮 ${p.batch} 张，${rangeLabel(first, firstTo)} 起至 ${rangeLabel(lastFrom, lastTo)}`,
    tone: 'ok',
  }
}
