import { fingerprintHex } from './hash'
import type { WorkbenchId } from './workbench'

export type ContextMemoryKind = 'preference' | 'fact' | 'constraint' | 'decision'

export interface ContextMemory {
  id: string
  kind: ContextMemoryKind
  text: string
  /** 缺省 = 三个工作台都可读取。 */
  workbench?: WorkbenchId
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
  workbench?: WorkbenchId
  source: 'user' | 'agent'
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
  softPreferences: string[]
  procedures: string[]
  sessionDecisions: string[]
  exclusions: string[]
  conflicts: ContextConflict[]
  memoryRefs: { id: string; revision: number }[]
  kitVersionRefs: { kitId: string; version: number }[]
  /** 当前项目绑定版本引用的素材；字节仍在 assets，由执行层读取。 */
  assetHashes: string[]
  digest: string
}

export interface ContextConflict {
  key: string
  values: string[]
  sources: string[]
  message: string
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
      `品牌素材：Logo ${logoCount} 张，参考素材 ${referenceCount} 张`,
    )
  }
  return lines
}

export function contextConflictsOf(
  versions: readonly ContextKitVersion[],
  kitNameOf: (kitId: string) => string = (kitId) => kitId,
): ContextConflict[] {
  const byKey = new Map<
    string,
    { values: Set<string>; sources: Set<string> }
  >()
  for (const version of versions) {
    for (const fact of version.facts) {
      const key = fact.key.trim().toLowerCase()
      const value = fact.value.trim()
      if (!key || !value) continue
      const entry = byKey.get(key) ?? {
        values: new Set<string>(),
        sources: new Set<string>(),
      }
      entry.values.add(value)
      entry.sources.add(`${kitNameOf(version.kitId)} v${version.version}`)
      byKey.set(key, entry)
    }
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
}): ContextBundle {
  const revisionByIdentity = new Map(
    input.memoryRevisions.map((revision) => [
      `${revision.memoryId}\u0000${revision.revision}`,
      revision,
    ]),
  )
  const activeMemories = input.memories
    .filter(
      (memory) =>
        memory.enabled &&
        (!memory.workbench || memory.workbench === input.scope.workbench),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const hardConstraints: string[] = []
  const softPreferences: string[] = []
  const sessionDecisions: string[] = []
  const memoryRefs: ContextBundle['memoryRefs'] = []

  for (const memory of activeMemories) {
    const revision =
      revisionByIdentity.get(`${memory.id}\u0000${memory.currentRevision}`) ?? null
    const text = (revision?.text ?? memory.text).trim()
    if (!text) continue
    memoryRefs.push({ id: memory.id, revision: memory.currentRevision })
    if (memory.kind === 'constraint') hardConstraints.push(text)
    else if (memory.kind === 'decision') sessionDecisions.push(text)
    else softPreferences.push(text)
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

  const conflicts = contextConflictsOf(
    selectedVersions,
    (kitId) => kitById.get(kitId)?.name ?? kitId,
  )
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
    softPreferences,
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
  if (bundle.softPreferences.length > 0) {
    parts.push(['## 个人偏好（可优先采用）', ...bundle.softPreferences.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.sessionDecisions.length > 0) {
    parts.push(['## 已确认决定', ...bundle.sessionDecisions.map((item) => `- ${item}`)].join('\n'))
  }
  if (bundle.procedures.length > 0) {
    parts.push(['## 工作流程', ...bundle.procedures].join('\n'))
  }
  if (bundle.assetHashes.length > 0) {
    parts.push(
      [
        '## 套件参考素材',
        `本轮附带 ${bundle.assetHashes.length} 张品牌 / 产品参考素材。`,
        '先用这些素材核对 Logo、产品结构和视觉身份，再写生成提示词。',
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
  return parts.join('\n\n')
}
