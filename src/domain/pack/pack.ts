/**
 * 扩展包（Extension Pack）的解析与校验 —— 对账 #386 的阶段一（用户 2026-10-09：
 * 「有个东西我很有兴趣，toonflow 的那个插件市场这种」）。
 *
 * ## 阶段一的边界（安全线，先划死）
 *
 * **只允许数据**：技能正文、功能预设词、平台规则。**不执行任何代码**。
 * 所以：
 *   - `permissions` 必须是空数组 —— 带权限声明的包直接拒收（那是阶段三的事，
 *     而且必须先有权限声明与用户授权界面）；
 *   - 包里出现脚本字段（`code` / `main` / `entry`）一律拒收，不做"忽略它就行"的将就 ——
 *     "忽略"意味着同一份文件在别的实现里可能被执行，边界不能靠实现自觉。
 *
 * ## 为什么纯函数 + 逐条报错
 *
 * 装的是一份**别人发来的文件**。解析器唯一的职责是：能读就说清里面有什么，
 * 不能读就说清哪一行不对。静默丢弃字段是最坏的选择 —— 用户以为装了 20 个技能、实际 8 个。
 */
import { SKILL_LIMITS } from '../prompt/skill'

export const PACK_FORMAT = 'qinghua.pack'
/** 本实现认识的格式版本（比它高 = 需要更新的轻画） */
export const PACK_VERSION = 1

export interface PackSkill {
  /** 包内 id（装进库里时会加包前缀，避免两个包撞车） */
  id: string
  name: string
  description?: string
  content: string
  inputMode?: 'text' | 'image' | 'any'
  tags?: string[]
}

export interface PackPlatform {
  id: string
  name: string
  group: 'cross-border' | 'china'
  ratios: string[]
  languages: string[]
  countHint?: string
  rules: string
  updatedAt: string
  sourceNote: string
}

export interface ExtensionPack {
  format: typeof PACK_FORMAT
  version: number
  id: string
  displayName: string
  publisher?: string
  /** 需要的最低应用版本（`x.y.z`）；缺省 = 不限制 */
  minAppVersion?: string
  contents: {
    skills: PackSkill[]
    ecommercePlatforms: PackPlatform[]
  }
  /** 阶段一必须为空数组（数据包没有运行权限） */
  permissions: string[]
}

export interface PackParseResult {
  ok: boolean
  pack?: ExtensionPack
  /** 逐条中文错误；`ok === false` 时至少有一条 */
  errors: string[]
}

const ID_RE = /^[a-z0-9][a-z0-9.-]{2,63}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/
/** 阶段一明确拒收的字段名（出现即拒，不做"忽略"） */
const CODE_KEYS = ['code', 'main', 'entry', 'script', 'runtime']

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** `a` 比 `b` 新返回正数；相等返回 0；不认识的两串按字典序（调用方只在能解析时用） */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION_RE.exec(a)
  const pb = VERSION_RE.exec(b)
  if (!pa || !pb) return a === b ? 0 : a > b ? 1 : -1
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d
  }
  return 0
}

function readSkill(raw: unknown, index: number, errors: string[]): PackSkill | null {
  const at = `contents.skills[${index}]`
  if (!isRecord(raw)) {
    errors.push(`${at} 不是一个对象`)
    return null
  }
  const { id, name, content } = raw
  if (!nonEmptyString(id) || !ID_RE.test(id)) {
    errors.push(`${at}.id 不合法（小写字母 / 数字 / . / -，3–64 位）`)
    return null
  }
  if (!nonEmptyString(name)) {
    errors.push(`${at}.name 不能为空`)
    return null
  }
  if (!nonEmptyString(content)) {
    errors.push(`${at}.content 不能为空`)
    return null
  }
  /* 与技能库同一把尺子（`SKILL_LIMITS.contentMax`）：包里装进来的技能也不许超 */
  if (content.length > SKILL_LIMITS.contentMax) {
    errors.push(`${at}.content 超过技能正文上限（${SKILL_LIMITS.contentMax} 字符）`)
    return null
  }
  if (String(name).length > SKILL_LIMITS.nameMax) {
    errors.push(`${at}.name 超过 ${SKILL_LIMITS.nameMax} 字（按钮上放不下）`)
    return null
  }
  const inputMode = raw.inputMode
  if (inputMode !== undefined && !['text', 'image', 'any'].includes(String(inputMode))) {
    errors.push(`${at}.inputMode 只支持 text / image / any`)
    return null
  }
  return {
    id,
    name: name.trim(),
    content,
    ...(nonEmptyString(raw.description) ? { description: raw.description.trim() } : {}),
    ...(inputMode ? { inputMode: inputMode as PackSkill['inputMode'] } : {}),
    ...(stringArray(raw.tags).length ? { tags: stringArray(raw.tags) } : {}),
  }
}

function readPlatform(raw: unknown, index: number, errors: string[]): PackPlatform | null {
  const at = `contents.ecommercePlatforms[${index}]`
  if (!isRecord(raw)) {
    errors.push(`${at} 不是一个对象`)
    return null
  }
  if (!nonEmptyString(raw.id) || !ID_RE.test(raw.id)) {
    errors.push(`${at}.id 不合法（小写字母 / 数字 / . / -，3–64 位）`)
    return null
  }
  if (!nonEmptyString(raw.name)) {
    errors.push(`${at}.name 不能为空`)
    return null
  }
  if (raw.group !== 'cross-border' && raw.group !== 'china') {
    errors.push(`${at}.group 只支持 cross-border / china`)
    return null
  }
  if (!nonEmptyString(raw.rules)) {
    errors.push(`${at}.rules 不能为空（这就是会拼进提示词的规则正文）`)
    return null
  }
  const ratios = stringArray(raw.ratios)
  const languages = stringArray(raw.languages)
  if (ratios.length === 0) {
    errors.push(`${at}.ratios 至少要有一个比例`)
    return null
  }
  if (languages.length === 0) {
    errors.push(`${at}.languages 至少要有一个语言代码`)
    return null
  }
  if (!nonEmptyString(raw.updatedAt) || !DATE_RE.test(raw.updatedAt)) {
    errors.push(`${at}.updatedAt 要写成 YYYY-MM-DD（规则会过期，必须能看见它是什么时候写的）`)
    return null
  }
  if (!nonEmptyString(raw.sourceNote)) {
    errors.push(`${at}.sourceNote 不能为空（未核实就必须写"通用建议"）`)
    return null
  }
  return {
    id: raw.id,
    name: raw.name.trim(),
    group: raw.group,
    ratios,
    languages,
    rules: raw.rules,
    updatedAt: raw.updatedAt,
    sourceNote: raw.sourceNote,
    ...(nonEmptyString(raw.countHint) ? { countHint: raw.countHint } : {}),
  }
}

/**
 * 解析一份扩展包文件。
 *
 * `appVersion` 由调用方给（通常是 `package.json` 的版本）：给了才校验 `minAppVersion`，
 * 不给就跳过 —— 领域层不认识"当前应用版本"这件事，别在这里写死。
 */
export function parsePack(raw: unknown, options: { appVersion?: string } = {}): PackParseResult {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['这不是一个 JSON 对象'] }

  if (raw.format !== PACK_FORMAT) {
    errors.push(`format 必须是 "${PACK_FORMAT}"（现在是 ${JSON.stringify(raw.format)}）`)
  }
  const version = typeof raw.version === 'number' ? raw.version : NaN
  if (!Number.isInteger(version) || version < 1) {
    errors.push('version 必须是正整数')
  } else if (version > PACK_VERSION) {
    errors.push(`这个包是 v${version} 的格式，当前轻画只认到 v${PACK_VERSION} —— 先升级应用`)
  }
  if (!nonEmptyString(raw.id) || !ID_RE.test(raw.id)) {
    errors.push('id 不合法（小写字母 / 数字 / . / -，3–64 位）')
  }
  if (!nonEmptyString(raw.displayName)) errors.push('displayName 不能为空')

  const minAppVersion = raw.minAppVersion
  if (minAppVersion !== undefined) {
    if (!nonEmptyString(minAppVersion) || !VERSION_RE.test(minAppVersion)) {
      errors.push('minAppVersion 要写成 x.y.z')
    } else if (options.appVersion && compareVersions(minAppVersion, options.appVersion) > 0) {
      errors.push(`这个包需要轻画 ${minAppVersion} 或更高（当前 ${options.appVersion}）`)
    }
  }

  /* 安全线：带代码字段 / 带权限声明的包一律拒收（不是"忽略"） */
  for (const key of CODE_KEYS) {
    if (raw[key] !== undefined) errors.push(`阶段一的扩展包只允许数据，不能带 ${key} 字段`)
  }
  const permissions = raw.permissions
  if (!Array.isArray(permissions)) {
    errors.push('permissions 必须是数组（阶段一只能是空数组）')
  } else if (permissions.length > 0) {
    errors.push('阶段一的扩展包不允许声明权限（带权限的包属于运行时插件，尚未支持）')
  }

  const contents = raw.contents
  if (!isRecord(contents)) {
    errors.push('contents 必须是一个对象')
    return { ok: false, errors }
  }
  const skills: PackSkill[] = []
  const platforms: PackPlatform[] = []
  const rawSkills = contents.skills
  if (rawSkills !== undefined) {
    if (!Array.isArray(rawSkills)) errors.push('contents.skills 必须是数组')
    else rawSkills.forEach((s, i) => {
      const skill = readSkill(s, i, errors)
      if (skill) skills.push(skill)
    })
  }
  const rawPlatforms = contents.ecommercePlatforms
  if (rawPlatforms !== undefined) {
    if (!Array.isArray(rawPlatforms)) errors.push('contents.ecommercePlatforms 必须是数组')
    else rawPlatforms.forEach((p, i) => {
      const platform = readPlatform(p, i, errors)
      if (platform) platforms.push(platform)
    })
  }
  if (skills.length === 0 && platforms.length === 0) {
    errors.push('这个包是空的：至少要带技能或电商平台规则')
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    errors: [],
    pack: {
      format: PACK_FORMAT,
      version,
      id: raw.id as string,
      displayName: (raw.displayName as string).trim(),
      ...(nonEmptyString(raw.publisher) ? { publisher: raw.publisher.trim() } : {}),
      ...(nonEmptyString(minAppVersion) ? { minAppVersion } : {}),
      contents: { skills, ecommercePlatforms: platforms },
      permissions: [],
    },
  }
}

/** 给"安装前先看内容清单"用的摘要（界面直接显示这句话） */
export function packSummary(pack: ExtensionPack): string {
  const parts: string[] = []
  if (pack.contents.skills.length) parts.push(`${pack.contents.skills.length} 个技能`)
  if (pack.contents.ecommercePlatforms.length) {
    parts.push(`${pack.contents.ecommercePlatforms.length} 条电商平台规则`)
  }
  const by = pack.publisher ? `，来自 ${pack.publisher}` : ''
  return `${pack.displayName}：${parts.join(' + ')}${by}。纯数据包，不执行任何代码。`
}
