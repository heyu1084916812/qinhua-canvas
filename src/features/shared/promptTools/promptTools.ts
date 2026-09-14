/**
 * 提示词 LLM 工具（优化 / 翻译）的纯逻辑（产品文档 §6.7「LLM 行为」）。
 * 与 React 解耦：hook（usePromptTools）只做状态包装，这里可独立单测。
 */

export type PromptToolAction = 'optimize' | 'translate' | 'describe'

/**
 * 系统指令：优化 = 提升清晰度/结构/可执行性；翻译 = 中英互译，无法判断时就地说明。
 *
 * `describe` = **反推提示词**（§6.7）：把上游图片当素材一起发给模型，让它描述画面、
 * 产出可复用的绘画提示词。它与另两个动作的关键差别是**必须带图**——
 * 没图时的反推只会得到一段凭空编造的描述，所以守卫里单独卡这一条。
 */
export const PROMPT_TOOL_SYSTEM: Record<PromptToolAction, string> = {
  optimize:
    '你是一名专业的 AI 绘画提示词工程师。请优化用户提供的提示词，提升其清晰度、结构与可执行性，保留核心意图与关键细节，不要解释，只输出优化后的提示词本身。',
  translate:
    '判断用户提供文本的主要语言：若为中文则翻译为英文，若为英文则翻译为中文；若无法判断，用一句话就地说明原因。只输出最终结果，不要解释。',
  describe:
    '你是一名专业的 AI 绘画提示词工程师。请根据用户提供的图片，反推出一段可以直接用于 AI 绘画的英文提示词：描述主体、构图、光线、风格与质感，不要解释、不要复述要求，只输出提示词本身。若用户文本里另有补充要求，把它并入提示词。',
}

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
