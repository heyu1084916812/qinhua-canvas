import { fingerprintHex } from './hash'
import type { WorkbenchId } from './workbench'

export type ContextMemoryKind = 'preference' | 'fact' | 'constraint' | 'decision'
export type ContextMemoryScope = 'global' | 'workbench' | 'project' | 'session'
export type ContextMemorySource = 'user' | 'agent'

export interface ContextMemory {
  id: string
  kind: ContextMemoryKind
  text: string
  /** 新记录显式保存作用域；旧记录缺省时按 workbench / global 推导。 */
  scope?: ContextMemoryScope
  /** 缺省 = 三个工作台都可读取。 */
  workbench?: WorkbenchId
  projectId?: string
  sessionId?: string
  /** 用于冲突检测的稳定主题键，例如 brand.primaryColor。 */
  key?: string
  expiresAt?: number
  source?: ContextMemorySource
  confidence?: number
  enabled: boolean
  currentRevision: number
  createdAt: number
  updatedAt: number
}

export interface ContextMemoryRevision {
  id: string
  memoryId: string
  revision: number
  kind: ContextMemoryKind
  text: string
  scope?: ContextMemoryScope
  workbench?: WorkbenchId
  projectId?: string
  sessionId?: string
  key?: string
  expiresAt?: number
  source: ContextMemorySource
  confidence: number
  createdAt: number
}

export type ContextKitKind = 'brand' | 'product' | 'role' | 'custom'

export interface ContextKit {
  id: string
  kind: ContextKitKind
  name: string
  description: string
  currentVersion: number
  createdAt: number
  updatedAt: number
}

export interface ContextKitFact {
  key: string
  value: string
}

export type ContextKitAssetRole = 'logo' | 'reference'

export interface ContextKitAsset {
  hash: string
  role: ContextKitAssetRole
  name: string
}

export interface ContextKitColor {
  id: string
  name: string
  value: string
}

export interface ContextKitFont {
  id: string
  name: string
  detail: string
  /** 引用本机 `fonts` 表中的真实字体文件；旧记录可以没有。 */
  fontId?: string
  format?: string
  size?: number
}

export interface ContextKitVersion {
  id: string
  kitId: string
  version: number
  guide: string
  facts: ContextKitFact[]
  assetHashes: string[]
  resources: ContextKitAsset[]
  colors: ContextKitColor[]
  fonts: ContextKitFont[]
  checksum: string
  createdAt: number
}

export interface ProjectContextBinding {
  id: string
  projectId: string
  kitId: string
  kitVersion: number
  /** locked = 永远不跟随新版本；prefer = 下次显式升级才移动，不会自动追。 */
  mode: 'locked' | 'prefer'
  createdAt: number
  updatedAt: number
}

export interface ContextBundleScope {
  workbench: WorkbenchId
  projectId: string
  sessionId?: string
  taskId?: string
}

export interface ContextBundle {
  request: string
  scope: ContextBundleScope
  hardConstraints: string[]
  facts: string[]
  softPreferences: string[]
  projectDecisions: string[]
  procedures: string[]
  sessionDecisions: string[]
  exclusions: string[]
  conflicts: ContextConflict[]
  memoryRefs: { id: string; revision: number }[]
  kitVersionRefs: { kitId: string; version: number }[]
  /** 当前项目绑定版本引用的素材；字节仍在 assets，由执行层读取。 */
  assetHashes: string[]
  budget: {
    maxMemoryChars: number
    usedMemoryChars: number
    omittedMemoryRefs: { id: string; revision: number; reason: string }[]
  }
  digest: string
}

export interface ContextConflict {
  key: string
  values: string[]
  sources: string[]
  message: string
}

export function normalizeContextMemoryScope(value: unknown): ContextMemoryScope {
  return value === 'workbench' || value === 'project' || value === 'session' || value === 'global'
    ? value
    : 'global'
}

export function contextMemoryScopeOf(
  memory: Pick<ContextMemory, 'scope' | 'workbench' | 'projectId' | 'sessionId'>,
): ContextMemoryScope {
  if (memory.scope) return normalizeContextMemoryScope(memory.scope)
  if (memory.sessionId) return 'session'
  if (memory.projectId) return 'project'
  if (memory.workbench) return 'workbench'
  return 'global'
}

export function normalizeContextMemoryKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '.')
        .replace(/[^a-z0-9._-]+/g, '')
        .replace(/^\.+|\.+$/g, '')
    : ''
}

export function contextMemorySecretReason(text: string): string | null {
  if (/\bsk-[a-z0-9_-]{16,}\b/i.test(text)) return '疑似 API Key'
  if (/\bBearer\s+[a-z0-9._~+/=-]{16,}\b/i.test(text)) return '疑似 Bearer Token'
  if (
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|cookie)\s*[:=]/i.test(
      text,
    )
  ) {
    return '疑似密钥、令牌、密码或 Cookie'
  }
  return null
}

export function contextMemoryScopeMatches(
  memory: ContextMemory,
  scope: ContextBundleScope,
  now = Date.now(),
): boolean {
  if (!memory.enabled) return false
  if (memory.expiresAt !== undefined && memory.expiresAt <= now) return false
  const memoryScope = contextMemoryScopeOf(memory)
  if (memoryScope === 'global') return true
  if (memoryScope === 'workbench') return memory.workbench === scope.workbench
  if (memoryScope === 'project') {
    return (
      memory.projectId === scope.projectId &&
      (!memory.workbench || memory.workbench === scope.workbench)
    )
  }
  return (
    Boolean(scope.sessionId) &&
    memory.sessionId === scope.sessionId &&
    (!memory.projectId || memory.projectId === scope.projectId) &&
    (!memory.workbench || memory.workbench === scope.workbench)
  )
}

export function normalizeContextMemoryKind(value: unknown): ContextMemoryKind {
  return value === 'fact' ||
    value === 'constraint' ||
    value === 'decision' ||
    value === 'preference'
    ? value
    : 'preference'
}

export function normalizeContextKitKind(value: unknown): ContextKitKind {
  return value === 'brand' || value === 'product' || value === 'role' || value === 'custom'
    ? value
    : 'custom'
}

export function contextKitVersionChecksum(input: {
  kitId: string
  version: number
  guide: string
  facts: readonly ContextKitFact[]
  assetHashes: readonly string[]
  resources?: readonly ContextKitAsset[]
  colors?: readonly ContextKitColor[]
  fonts?: readonly ContextKitFont[]
}): string {
  return fingerprintHex(
    JSON.stringify({
      kitId: input.kitId,
      version: input.version,
      guide: input.guide.trim(),
      facts: input.facts
        .map((fact) => ({ key: fact.key.trim(), value: fact.value.trim() }))
        .filter((fact) => fact.key && fact.value)
        .sort((left, right) => left.key.localeCompare(right.key)),
      assetHashes: [...new Set(input.assetHashes.filter(Boolean))].sort(),
      resources: (input.resources ?? [])
        .map((resource) => ({
          hash: resource.hash.trim(),
          role: resource.role,
          name: resource.name.trim(),
        }))
        .filter((resource) => resource.hash)
        .sort((left, right) => left.role.localeCompare(right.role) || left.hash.localeCompare(right.hash)),
      colors: (input.colors ?? [])
        .map((color) => ({
          id: color.id.trim(),
          name: color.name.trim(),
          value: color.value.trim().toLowerCase(),
        }))
        .filter((color) => color.id && color.value)
        .sort((left, right) => left.id.localeCompare(right.id)),
      fonts: (input.fonts ?? [])
        .map((font) => ({
          id: font.id.trim(),
          name: font.name.trim(),
          detail: font.detail.trim(),
          fontId: font.fontId?.trim() ?? '',
          format: font.format?.trim() ?? '',
          size: font.size ?? 0,
        }))
        .filter((font) => font.id && font.name)
        .sort((left, right) => left.id.localeCompare(right.id)),
    }),
  )
}

function normalizedFactLines(version: ContextKitVersion): string[] {
  return version.facts
    .map((fact) => ({
      key: fact.key.trim(),
      value: fact.value.trim(),
    }))
    .filter((fact) => fact.key && fact.value)
    .map((fact) => `${fact.key}：${fact.value}`)
}

function normalizedStructuredLines(version: ContextKitVersion): string[] {
  const lines = [
    ...version.colors
      .filter((color) => color.name.trim() && /^#[0-9a-f]{6}$/i.test(color.value))
      .map((color) => `颜色 ${color.name.trim()}：${color.value.toLowerCase()}`),
    ...version.fonts
      .filter((font) => font.name.trim())
      .map(
        (font) =>
          `字体 ${font.name.trim()}：${font.detail.trim() || font.name.trim()}`,
      ),
  ]
  const logoCount = version.resources.filter((resource) => resource.role === 'logo').length
  const referenceCount = version.resources.filter(
    (resource) => resource.role === 'reference',
  ).length
  if (logoCount > 0 || referenceCount > 0) {
    lines.push(
      `套件素材：主素材 ${logoCount} 张，参考素材 ${referenceCount} 张`,
    )
  }
  return lines
}

export function contextConflictsOf(
  versions: readonly ContextKitVersion[],
  kitNameOf: (kitId: string) => string = (kitId) => kitId,
): ContextConflict[] {
  return conflictsFromEntries(
    versions.flatMap((version) =>
      version.facts.map((fact) => ({
        key: fact.key,
        value: fact.value,
        source: `${kitNameOf(version.kitId)} v${version.version}`,
      })),
    ),
  )
}

function conflictsFromEntries(
  entries: readonly { key: string; value: string; source: string }[],
): ContextConflict[] {
  const byKey = new Map<
    string,
    { values: Set<string>; sources: Set<string> }
  >()
  for (const candidate of entries) {
    const key = candidate.key.trim().toLowerCase()
    const value = candidate.value.trim()
    if (!key || !value) continue
    const entry = byKey.get(key) ?? {
      values: new Set<string>(),
      sources: new Set<string>(),
    }
    entry.values.add(value)
    entry.sources.add(candidate.source)
    byKey.set(key, entry)
  }
  return [...byKey.entries()]
    .filter(([, entry]) => entry.values.size > 1)
    .map(([key, entry]) => ({
      key,
      values: [...entry.values].sort(),
      sources: [...entry.sources].sort(),
      message: `${key} 存在冲突：${[...entry.values].sort().join(' / ')}`,
    }))
}

function memoryConflictsOf(
  memories: readonly { memory: ContextMemory; text: string }[],
): ContextConflict[] {
  return conflictsFromEntries(
    memories.flatMap(({ memory, text }) => {
      const key = normalizeContextMemoryKey(memory.key)
      if (!key) return []
      const scope = contextMemoryScopeOf(memory)
      return [{
        key,
        value: text,
        source: `个人记忆 · ${scope} · ${memory.source ?? 'user'}`,
      }]
    }),
  )
}

const DEFAULT_MEMORY_CHAR_BUDGET = 12_000
const SCOPE_RANK: Record<ContextMemoryScope, number> = {
  session: 4,
  project: 3,
  workbench: 2,
  global: 1,
}

export function assembleContextBundle(input: {
  request: string
  scope: ContextBundleScope
  memories: readonly ContextMemory[]
  memoryRevisions: readonly ContextMemoryRevision[]
  kits: readonly ContextKit[]
  kitVersions: readonly ContextKitVersion[]
  bindings: readonly ProjectContextBinding[]
  skill?: { name: string; content: string }
  exclusions?: readonly string[]
  memoryCharBudget?: number
}): ContextBundle {
  const revisionByIdentity = new Map(
    input.memoryRevisions.map((revision) => [
      `${revision.memoryId}\u0000${revision.revision}`,
      revision,
    ]),
  )
  const now = Date.now()
  const activeMemories = input.memories
    .filter((memory) => contextMemoryScopeMatches(memory, input.scope, now))
    .sort(
      (left, right) =>
        SCOPE_RANK[contextMemoryScopeOf(right)] -
          SCOPE_RANK[contextMemoryScopeOf(left)] ||
        right.updatedAt - left.updatedAt,
    )
  const resolvedMemories = activeMemories
    .flatMap((memory) => {
      const revision =
        revisionByIdentity.get(`${memory.id}\u0000${memory.currentRevision}`) ?? null
      const text = (revision?.text ?? memory.text).trim()
      return text ? [{ memory, text }] : []
    })
  const hardConstraints: string[] = []
  const facts: string[] = []
  const softPreferences: string[] = []
  const projectDecisions: string[] = []
  const sessionDecisions: string[] = []
  const memoryRefs: ContextBundle['memoryRefs'] = []
  const omittedMemoryRefs: ContextBundle['budget']['omittedMemoryRefs'] = []
  const maxMemoryChars =
    typeof input.memoryCharBudget === 'number' &&
    Number.isFinite(input.memoryCharBudget) &&
    input.memoryCharBudget > 0
      ? Math.trunc(input.memoryCharBudget)
      : DEFAULT_MEMORY_CHAR_BUDGET
  let usedMemoryChars = 0

  for (const { memory, text } of resolvedMemories) {
    const memoryScope = contextMemoryScopeOf(memory)
    const mustKeep =
      memory.kind === 'constraint' ||
      memory.kind === 'fact' ||
      memoryScope === 'project'
    if (!mustKeep && usedMemoryChars + text.length > maxMemoryChars) {
      omittedMemoryRefs.push({
        id: memory.id,
        revision: memory.currentRevision,
        reason: 'memory_budget',
      })
      continue
    }
    usedMemoryChars += text.length
    memoryRefs.push({ id: memory.id, revision: memory.currentRevision })
    if (memory.kind === 'constraint') hardConstraints.push(text)
    else if (memory.kind === 'fact') facts.push(text)
    else if (memory.kind === 'decision' && memoryScope === 'session') {
      sessionDecisions.push(text)
    } else if (memory.kind === 'decision' && memoryScope === 'project') {
      projectDecisions.push(text)
    } else if (memory.kind === 'decision') {
      hardConstraints.push(`已确认决定：${text}`)
    } else softPreferences.push(text)
  }

  const kitById = new Map(input.kits.map((kit) => [kit.id, kit]))
  const versionByRef = new Map(
    input.kitVersions.map((version) => [
      `${version.kitId}\u0000${version.version}`,
      version,
    ]),
  )
  const bindings = input.bindings.filter(
    (binding) => binding.projectId === input.scope.projectId,
  )
  const selectedVersions: ContextKitVersion[] = []
  const exclusions = [...(input.exclusions ?? [])]
  for (const binding of bindings) {
    const version = versionByRef.get(`${binding.kitId}\u0000${binding.kitVersion}`)
    if (!version) {
      exclusions.push(
        `${kitById.get(binding.kitId)?.name ?? binding.kitId} v${binding.kitVersion} 已不存在`,
      )
      continue
    }
    selectedVersions.push(version)
  }

  for (const version of selectedVersions) {
    const kit = kitById.get(version.kitId)
    const name = kit?.name ?? version.kitId
    if (version.guide.trim()) {
      hardConstraints.push(`【${name} v${version.version}】${version.guide.trim()}`)
    }
    const lines = normalizedFactLines(version)
    if (lines.length > 0) {
      hardConstraints.push(`【${name} v${version.version}】${lines.join('；')}`)
    }
    const structuredLines = normalizedStructuredLines(version)
    if (structuredLines.length > 0) {
      hardConstraints.push(`【${name} v${version.version}】${structuredLines.join('；')}`)
    }
  }

  const conflicts = conflictsFromEntries([
    ...contextConflictsOf(
      selectedVersions,
      (kitId) => kitById.get(kitId)?.name ?? kitId,
    ).flatMap((conflict) =>
      conflict.values.flatMap((value) =>
        conflict.sources.map((source) => ({
          key: conflict.key,
          value,
          source,
        })),
      ),
    ),
    ...memoryConflictsOf(resolvedMemories).flatMap((conflict) =>
      conflict.values.flatMap((value) =>
        conflict.sources.map((source) => ({
          key: conflict.key,
          value,
          source,
        })),
      ),
    ),
  ])
  if (conflicts.length > 0) {
    exclusions.push(...conflicts.map((conflict) => conflict.message))
  }

  const procedures = input.skill?.content.trim()
    ? [`技能：${input.skill.name}\n${input.skill.content.trim()}`]
    : []
  const stable = {
    request: input.request.trim(),
    scope: input.scope,
    hardConstraints,
    facts,
    softPreferences,
    projectDecisions,
    procedures,
    sessionDecisions,
    exclusions,
    conflicts,
    memoryRefs,
    kitVersionRefs: selectedVersions.map((version) => ({
      kitId: version.kitId,
      version: version.version,
    })),
    assetHashes: [
      ...new Set(selectedVersions.flatMap((version) => version.assetHashes)),
    ],
    budget: {
      maxMemoryChars,
      usedMemoryChars,
      omittedMemoryRefs,
    },
  }
  return {
    ...stable,
    digest: fingerprintHex(JSON.stringify(stable)),
  }
}

export function formatContextBundleForPrompt(bundle: ContextBundle): string {
  const parts: string[] = []
  if (bundle.hardConstraints.length > 0) {
    parts.push(['## 硬约束（不得违反）', ...bundle.hardConstraints.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.facts.length > 0) {
    parts.push(['## 已确认事实', ...bundle.facts.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.softPreferences.length > 0) {
    parts.push(['## 个人偏好（可优先采用）', ...bundle.softPreferences.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.projectDecisions.length > 0) {
    parts.push(['## 项目决定', ...bundle.projectDecisions.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.sessionDecisions.length > 0) {
    parts.push(['## 本会话已确认决定', ...bundle.sessionDecisions.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.procedures.length > 0) {
    parts.push(['## 工作流程', ...bundle.procedures].join('\n'))
  }
  if (bundle.assetHashes.length > 0) {
    parts.push(
      [
        '## 套件参考素材',
        `本轮附带 ${bundle.assetHashes.length} 张品牌 / 产品 / 角色 / 自定义套件素材。`,
        '先用这些素材核对标志、产品结构、角色身份和视觉规范，再写生成提示词。',
      ].join('\n'),
    )
  }
  if (bundle.conflicts.length > 0) {
    parts.push(
      [
        '## 上下文冲突（先说明，不得猜）',
        ...bundle.conflicts.map((conflict) => `- ${conflict.message}`),
      ].join('\n'),
    )
  }
  if (bundle.exclusions.length > 0) {
    parts.push(['## 未采用的上下文', ...bundle.exclusions.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.budget.omittedMemoryRefs.length > 0) {
    parts.push(
      `另有 ${bundle.budget.omittedMemoryRefs.length} 条低优先级记忆因上下文预算未载入。`,
    )
  }
  return parts.join('\n\n')
}
