/**
 * 功能预设词（后台「中枢」的一区，用户 2026-09-25）。
 *
 * ## 它是什么
 *
 * 提示词节点的「优化 / 翻译 / 反推」是三个**内置动作**，走的是同一条链路：
 *
 * ```
 * 系统指令 + 节点正文 → 文本模型 → 结果写回
 * ```
 *
 * 三者的唯一差别就是那段系统指令。此前它**写死在代码常量** `PROMPT_TOOL_SYSTEM` 里 ——
 * 用户能看到这三个按钮，却改不了它们的行为（「我想让优化多保留一点我的原话」这类
 * 需求无法表达）。本模块把这段指令变成**可编辑、可落库**的内容。
 *
 * ## 为什么类型定义搬到这里
 *
 * `PromptToolAction` 原本住在 `features/shared/promptTools/`。但预设词要落库、
 * 要出现在后台设置页（`pages/`），而 `domain` 不许反向依赖 `features` —— 所以
 * 「有哪三个动作、默认指令是什么」这个**领域事实**上移到 domain；
 * `features/shared/promptTools` 改为从本文件取默认值并重新导出该类型，
 * 既有引用点因此零改动。
 *
 * ## 与「技能」的分工（别混）
 *
 * | | 预设词（本文件） | 技能（`skill.ts`） |
 * | --- | --- | --- |
 * | 数量 | **固定三条**（优化 / 翻译 / 反推） | 用户想加多少加多少 |
 * | 入口 | 面板上那三个固定按钮 | 面板上的技能选择器 |
 * | 语义 | 改写这三个按钮**做什么** | 新增一个**自己的**动作 |
 *
 * 一句话：预设词是「改造内置动作」，技能是「增加自定义动作」。
 */

/** 内置动作标识。顺序即面板上按钮的顺序。 */
export const PRESET_TEXT_ACTIONS = ['optimize', 'translate', 'describe'] as const

export type PromptToolAction = (typeof PRESET_TEXT_ACTIONS)[number]

/** 预设词正文的长度上限：它是系统指令，占 token；再长就该改用技能 */
export const PRESET_TEXT_MAX = 2000

export interface PresetTextEntry {
  id: PromptToolAction
  /** 界面上这个动作叫什么（不可改，改的是「它做什么」而不是「它叫什么」） */
  label: string
  /** 这段指令是干什么的（界面上的说明，不可改） */
  hint: string
  /** 当前生效的指令正文（用户可改） */
  content: string
  /** 是否仍是出厂默认（界面据此显示「已改」与「恢复默认」） */
  isDefault: boolean
}

/**
 * 出厂默认指令。
 *
 * 这些文案**有断言钉着**（`promptTools.test.ts` 检查 optimize 提到「清晰度」、
 * translate 提到「英文」「无法判断」等）——它们描述的是行为契约，不是随便写的提示。
 * 因此在设置页提供了「恢复默认」，让用户改坏之后有退路。
 */
export const DEFAULT_PRESET_TEXT: Record<PromptToolAction, string> = {
  optimize:
    '你是一名专业的 AI 绘画提示词工程师。请优化用户提供的提示词，提升其清晰度、结构与可执行性，保留核心意图与关键细节，不要解释，只输出优化后的提示词本身。',
  translate:
    '判断用户提供文本的主要语言：若为中文则翻译为英文，若为英文则翻译为中文；若无法判断，用一句话就地说明原因。只输出最终结果，不要解释。',
  describe:
    '你是一名专业的 AI 绘画提示词工程师。请根据用户提供的图片，反推出一段可以直接用于 AI 绘画的英文提示词：描述主体、构图、光线、风格与质感，不要解释、不要复述要求，只输出提示词本身。若用户文本里另有补充要求，把它并入提示词。',
}

/** 界面上的元信息（名称与说明不可改，与默认指令一同维护） */
export const PRESET_TEXT_META: Record<PromptToolAction, { label: string; hint: string }> = {
  optimize: {
    label: '优化',
    hint: '把节点正文改写得更清晰、更结构化 —— 不改原意，只提升可执行性',
  },
  translate: {
    label: '翻译',
    hint: '中英互译；判断不出语言时如实说明，而不是猜一个方向',
  },
  describe: {
    label: '反推',
    hint: '把上游图片反推成可复用的绘画提示词（唯一需要图片的动作）',
  },
}

/** 校验一段预设词能否保存；返回错误文案或 null */
export function validatePresetText(content: string): string | null {
  const text = content.trim()
  if (!text) return '预设词不能为空 —— 留空会让这个动作发出一条没有指令的请求'
  if (text.length > PRESET_TEXT_MAX) {
    return `预设词最多 ${PRESET_TEXT_MAX} 字（当前 ${text.length} 字）`
  }
  return null
}

/**
 * 把「库里存的那一份」组装成界面用的完整条目列表。
 *
 * `stored` 是落库的覆盖值（可能缺项、可能有坏值）——缺失或空白一律**回落默认**，
 * 不产出半份数据：预设词读坏了不该让那三个按钮消失，而是回到出厂行为。
 */
export function presetTextEntries(
  stored: Partial<Record<PromptToolAction, string>> | null | undefined,
): PresetTextEntry[] {
  return PRESET_TEXT_ACTIONS.map((id) => {
    const raw = stored?.[id]
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    // 空白与超限都视为「没有有效覆盖」→ 回落默认
    const usable = trimmed.length > 0 && trimmed.length <= PRESET_TEXT_MAX ? trimmed : ''
    const content = usable || DEFAULT_PRESET_TEXT[id]
    return {
      id,
      label: PRESET_TEXT_META[id].label,
      hint: PRESET_TEXT_META[id].hint,
      content,
      isDefault: content === DEFAULT_PRESET_TEXT[id],
    }
  })
}

/**
 * 取**生效值**（执行链路用）：给了覆盖就用覆盖，否则用默认。
 *
 * 与 `presetTextEntries` 分开：那个返回界面要的完整条目（含 label / isDefault），
 * 这个只要一个字符串。执行侧不该为了拿到一段指令而去组装界面模型。
 */
export function effectivePresetText(
  action: PromptToolAction,
  stored: Partial<Record<PromptToolAction, string>> | null | undefined,
): string {
  const raw = stored?.[action]
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed && trimmed.length <= PRESET_TEXT_MAX) return trimmed
  return DEFAULT_PRESET_TEXT[action]
}
