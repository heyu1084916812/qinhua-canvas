/**
 * 提示词技能（Skill）。
 *
 * ## 它是什么
 *
 * 提示词节点上那排「优化 / 翻译 / 反推」走的是同一条链路：
 *
 * ```
 * 系统指令 + 节点正文 → 文本模型 → 结果写回
 * ```
 *
 * 三个动作的**唯一区别就是那段系统指令**（见 `promptTools.PROMPT_TOOL_SYSTEM`）。
 * 技能就是把这段指令**从写死改成用户可管理**：用户自己写一份指令，
 * 起个名字、点一下就用。所以技能不是新机制，是这条链路的参数化。
 *
 * ## 为什么正文只当系统指令（不做变量替换）
 *
 * 用户 2026-09-24 确认先做这一版。理由：项目里**已经有一个天然的「填内容」位置** ——
 * 节点正文本身，以及从上游连过来的输入。技能里再放 `{{产品名}}` 会让「指令」与
 * 「内容」混在一起，换个产品这份技能就不能用了。
 *
 * 真需要「值来自别处」时，画布上应该用**连线**表达（那正是本项目的模型），
 * 而不是在字符串里挖空。
 */

/** 技能要求的输入类型：决定按钮能不能点（与 `promptToolGuard` 同一口径） */
export type SkillInputMode = 'text' | 'image' | 'any'

export interface Skill {
  id: string
  /** 显示名，出现在面板按钮上 */
  name: string
  /** 一句话说明，悬停提示用；可空 */
  description: string
  /** 技能正文 = 系统指令 */
  content: string
  /** 需要的输入；不满足时按钮禁用并说明原因 */
  inputMode: SkillInputMode
  tags: string[]
  /** 记录时间，仅用于排序与诊断 */
  updatedAt: number
}

/** 随应用内置、只读的技能。 */
export interface BuiltinSkill extends Skill {
  source: 'builtin'
}

/** 用户新建、导入，或从内置技能复制而来的技能。 */
export interface UserSkill extends Skill {
  source: 'user'
  /** 若该条来自内置技能，记录来源内置 id；用于恢复默认与去重复制。 */
  builtinId?: string
}

export type SkillEntity = BuiltinSkill | UserSkill

/**
 * 硬限制（用户 2026-09-24 定的规格）。
 *
 * 每一条都有理由，且都会在**导入与保存时**检查 —— 只在界面拦是不够的，
 * 导入 md 是另一条入口，漏掉就会存进超限数据。
 */
export const SKILL_LIMITS = {
  /** 正文上限：系统指令占 token，再长就该拆成多个技能 */
  /** 内置技能来自外部工作流文档，允许较长；用户技能同样沿用此上限。 */
  contentMax: 128000,
  /** 名称上限：按钮上要放得下 */
  nameMax: 24,
  /** 说明上限：tooltip 不该变成一段文章 */
  descriptionMax: 80,
  /** 单个导入文件上限 */
  fileSizeMax: 256 * 1024,
} as const

export type SkillParseResult =
  | { ok: true; skill: Omit<Skill, 'id' | 'updatedAt'> }
  | { ok: false; error: string }

/**
 * 解析一份 markdown 成技能（用户 2026-09-24：「上传 md 文件然后自动加载解析」）。
 *
 * 支持两种写法，**都接受**：
 *
 * 1. **带 frontmatter**（推荐，与 Codex 自己的 SKILL.md 格式一致，
 *    从别处拿到的 skill 能直接导入）：
 *
 *    ```markdown
 *    ---
 *    name: 详情页策划
 *    description: 按母婴产品特性生成详情页结构
 *    inputMode: text
 *    tags: [电商, 策划]
 *    ---
 *    你是资深电商详情页策划……
 *    ```
 *
 * 2. **不带 frontmatter**：整份文件当正文，**文件名当名称**。
 *    这样随手写的 md 也能直接导入，不必先学格式。
 *
 * 只认最简单的 `key: value` 与 `tags: [a, b]`，**不引入 YAML 依赖** ——
 * 为这点语法拉一个解析库不划算，而复杂 YAML 也不是这里要支持的用法。
 * 解析不出来的字段用默认值，**不报错**；只有「正文为空」才算失败。
 */
export function parseSkillMarkdown(raw: string, fallbackName: string): SkillParseResult {
  const text = String(raw ?? '').replace(/^\uFEFF/, '') // 去掉 UTF-8 BOM（Windows 记事本会加）
  if (text.length > SKILL_LIMITS.fileSizeMax) {
    return { ok: false, error: `文件过大（上限 ${SKILL_LIMITS.fileSizeMax / 1024}KB）` }
  }

  let name = fallbackName.trim()
  let description = ''
  let inputMode: SkillInputMode = 'text'
  let tags: string[] = []
  let body = text

  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (fm) {
    body = text.slice(fm[0].length)
    const fmLines = fm[1].split(/\r?\n/)
    for (let i = 0; i < fmLines.length; i += 1) {
      const line = fmLines[i]!
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line.trim())
      if (!m) continue
      const key = m[1].toLowerCase()
      let value = m[2].trim().replace(/^["']|["']$/g, '')
      if (key === 'description' && (value === '>' || value === '|')) {
        const continuation: string[] = []
        let j = i + 1
        while (j < fmLines.length) {
          const next = fmLines[j]!
          if (/^\s+\S/.test(next)) {
            continuation.push(next.trim())
            j += 1
            continue
          }
          break
        }
        value = continuation.join(' ').trim()
        i = j - 1
      }
      if (key === 'name' && value) name = value
      else if (key === 'description' && value) description = value
      else if (key === 'inputmode' && value) {
        inputMode = value === 'image' || value === 'any' ? value : 'text'
      } else if (key === 'tags') {
        tags = value
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((t) => t.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      }
    }
  }

  const content = body.trim()
  if (!content) return { ok: false, error: '技能正文是空的（frontmatter 之后没有内容）' }
  if (content.length > SKILL_LIMITS.contentMax) {
    return { ok: false, error: `技能正文超长（${content.length} 字，上限 ${SKILL_LIMITS.contentMax}）` }
  }

  return {
    ok: true,
    skill: {
      name: clampName(name || fallbackName),
      description: description.slice(0, SKILL_LIMITS.descriptionMax),
      content,
      inputMode,
      tags: tags.slice(0, 8),
    },
  }
}

/** 名称超长时截断（导入时不该因为名字长就整份拒绝） */
function clampName(name: string): string {
  const n = name.trim() || '未命名技能'
  return n.length > SKILL_LIMITS.nameMax ? n.slice(0, SKILL_LIMITS.nameMax) : n
}

/**
 * 校验一份技能能不能保存（手动新建 / 编辑走这条）。
 *
 * 与导入共用同一组限制常量 —— 两处各写一套数字，迟早分叉。
 */
export function validateSkill(input: {
  name: string
  content: string
  description?: string
}): string | null {
  if (!input.name.trim()) return '请填写技能名称'
  if (input.name.trim().length > SKILL_LIMITS.nameMax) {
    return `名称太长（上限 ${SKILL_LIMITS.nameMax} 字）`
  }
  if (!input.content.trim()) return '请填写技能正文'
  if (input.content.length > SKILL_LIMITS.contentMax) {
    return `正文太长（${input.content.length} 字，上限 ${SKILL_LIMITS.contentMax}）`
  }
  if ((input.description ?? '').length > SKILL_LIMITS.descriptionMax) {
    return `说明太长（上限 ${SKILL_LIMITS.descriptionMax} 字）`
  }
  return null
}

/**
 * 技能能不能在这个输入条件下执行（与 `promptToolGuard` 同一口径）。
 *
 * 返回不可执行的原因；可执行返回 null。文案要说清**缺什么**，
 * 而不是笼统的「无法使用」（本项目反复出现的一类反馈缺陷）。
 */
export function skillGuard(skill: Skill, input: { text: string; imageCount: number }): string | null {
  if (skill.inputMode === 'image' && input.imageCount === 0) {
    return `「${skill.name}」需要图片：先把一个已出图的生成节点连到本节点`
  }
  if (skill.inputMode === 'text' && !input.text.trim()) return '没有可处理的文本'
  if (skill.inputMode === 'any' && !input.text.trim() && input.imageCount === 0) {
    return `「${skill.name}」需要文本或图片`
  }
  return null
}
