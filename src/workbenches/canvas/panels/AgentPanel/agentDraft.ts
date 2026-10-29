const STORAGE_KEY = 'qinghua.canvas.agentDrafts.v1'
const MAX_DRAFTS = 100

interface AgentDraftEntry {
  text: string
  updatedAt: number
}

export interface AgentDraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): AgentDraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function readEntries(storage: AgentDraftStorage | null): Record<string, AgentDraftEntry> {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, AgentDraftEntry] => {
        const value = entry[1]
        return (
          !!value &&
          typeof value === 'object' &&
          typeof (value as AgentDraftEntry).text === 'string' &&
          typeof (value as AgentDraftEntry).updatedAt === 'number'
        )
      }),
    )
  } catch {
    return {}
  }
}

export function loadAgentDraft(
  sessionId: string,
  storage: AgentDraftStorage | null = browserStorage(),
): string | null {
  if (!sessionId) return null
  const entry = readEntries(storage)[sessionId]
  return typeof entry?.text === 'string' ? entry.text : null
}

export function saveAgentDraft(
  sessionId: string,
  text: string,
  storage: AgentDraftStorage | null = browserStorage(),
): void {
  if (!sessionId || !storage) return
  const entries = readEntries(storage)
  entries[sessionId] = { text, updatedAt: Date.now() }
  const bounded = Object.fromEntries(
    Object.entries(entries)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_DRAFTS),
  )
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bounded))
  } catch {
    // localStorage can be unavailable or full; draft persistence is best-effort.
  }
}

export function clearAgentDraft(
  sessionId: string,
  storage: AgentDraftStorage | null = browserStorage(),
): void {
  if (!sessionId || !storage) return
  const entries = readEntries(storage)
  if (!(sessionId in entries)) return
  delete entries[sessionId]
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Best-effort cleanup only.
  }
}

export function draftNodeIds(text: string): string[] {
  const ids: string[] = []
  const pattern = /@\[[^\]]*\]\(node:([^)]+)\)/g
  for (const match of text.matchAll(pattern)) {
    const id = match[1]?.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function pendingAssetIdsAfterDraft(
  pendingAssetIds: readonly string[],
  text: string,
): string[] {
  const mentioned = new Set(draftNodeIds(text))
  return [...new Set(pendingAssetIds)].filter((id) => mentioned.has(id))
}
