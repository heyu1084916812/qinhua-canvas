/**
 * 提示词 LLM 工具（优化 / 翻译）的纯逻辑（产品文档 §6.7「LLM 行为」）。
 * 与 React 解耦：hook（usePromptTools）只做状态包装，这里可独立单测。
 *
 * ⚠️ 2026-09-25：三个动作的**默认系统指令**与动作类型已上移到
 * `domain/prompt/presetText.ts`（后台中枢要做成可编辑，而 domain 不许反向依赖 features）。
 * 这里重新导出，**既有 import 路径零改动**；`PROMPT_TOOL_SYSTEM` 保留为「出厂默认」的别名，
 * 执行链路应改取 `effectivePresetText(action, stored)` 以获得用户改过的那一份。
 */

import {
  DEFAULT_PRESET_TEXT,
  type PromptToolAction,
} from '../../../domain/prompt/presetText'

/**
 * 出厂默认系统指令：优化 = 提升清晰度/结构/可执行性；翻译 = 中英互译，无法判断时就地说明。
 *
 * `describe` = **反推提示词**（§6.7）：把上游图片当素材一起发给模型，让它描述画面、
 * 产出可复用的绘画提示词。它与另两个动作的关键差别是**必须带图**——
 * 没图时的反推只会得到一段凭空编造的描述，所以守卫里单独卡这一条。
 *
 * 用户在后台改过之后，**实际发出去的是改过的那份**（见 `effectivePresetText`）；
 * 这个常量仍代表「没改过时是什么」，供界面显示「恢复默认」与单测钉行为契约。
 */
export const PROMPT_TOOL_SYSTEM: Record<PromptToolAction, string> = DEFAULT_PRESET_TEXT

export type { PromptToolAction }

/**
 * 按钮可执行性守卫：返回错误文案（不可执行）或 null（可执行）。
 * 未配置文本模型 / 文本为空是最常见的两种失效。
 *
 * `describe` 是唯一**不要求原文**的动作（图就是输入），但反过来**必须有图**——
 * 所以这里按动作分支，而不是给所有动作套同一套前置条件。
 */
export function promptToolGuard(input: {
  channelId?: string
  model?: string
  text: string
  action: PromptToolAction
  /** 本次会随请求发出的图片素材数量（反推用） */
  imageCount?: number
}): string | null {
  if (!input.channelId || !input.model) return '暂无可用文本模型：请先在创作面板选择平台与模型'
  if (input.action === 'describe') {
    if (!input.imageCount) return '反推需要上游图片：先把一个已出图的生成节点连到本节点'
    return null
  }
  if (!input.text.trim()) return '没有可处理的文本'
  return null
}

/** LLM 输出可能带首尾空白 / 包裹引号，写回前清理 */
export function trimToolResult(text: string): string {
  return text.trim().replace(/^["“”]+|["“”]+$/g, '')
}
