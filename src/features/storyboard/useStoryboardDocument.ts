import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { flushOnPageHide } from '../../app/session'
import type { PlatformKit } from '../../platform'
import { createProjectRepository } from '../../state/project/repository'
import type { StoryboardStore } from '../../state/project/storyboardStore'
import type { StoryboardDoc } from '../../domain/storyboard/storyboard'
import { useStoryboardDocumentStore } from './StoryboardDocumentStoreContext'

/** 防抖窗口：连打一串字只落一次库（与外观偏好同一条口径）。 */
export const STORYBOARD_SAVE_DEBOUNCE_MS = 400

export interface StoryboardDocumentWriter {
  replaceDoc(next: StoryboardDoc): StoryboardDoc
  flush(): Promise<void>
}

export function createStoryboardDocumentWriter({
  store,
  onDocumentChange,
  onStatus,
  debounceMs = STORYBOARD_SAVE_DEBOUNCE_MS,
  now = Date.now,
}: {
  store: Pick<StoryboardStore, 'save'>
  onDocumentChange?: (doc: StoryboardDoc) => void
  onStatus?: (status: string) => void
  debounceMs?: number
  now?: () => number
}): StoryboardDocumentWriter {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: StoryboardDoc | null = null
  let pendingRevision: number | null = null
  let revision = 0
  let inFlight: Promise<void> | null = null
  let writeTail = Promise.resolve()

  const save = (next: StoryboardDoc, savedRevision: number) => {
    const task = writeTail
      .catch(() => {})
      .then(() => store.save(next))
      .then(
        () => {
          if (savedRevision === revision && pending === null) {
            onStatus?.('已保存')
          }
        },
        (error: unknown) => {
          if (savedRevision === revision && pending === null) {
            onStatus?.('保存失败')
          }
          throw error
        },
      )
    inFlight = task
    writeTail = task.catch(() => {})
    void task.finally(() => {
      if (inFlight === task) inFlight = null
    }).catch(() => {})
    return task
  }

  const flush = async () => {
    if (timer !== null) {
      globalThis.clearTimeout(timer)
      timer = null
    }
    const next = pending
    const nextRevision = pendingRevision
    pending = null
    pendingRevision = null
    const task =
      next && nextRevision !== null
        ? save(next, nextRevision)
        : inFlight
    if (task) await task
  }

  const replaceDoc = (next: StoryboardDoc) => {
    const stamped = { ...next, updatedAt: now() }
    revision += 1
    onDocumentChange?.(stamped)
    pending = stamped
    pendingRevision = revision
    onStatus?.('正在保存…')
    if (timer !== null) globalThis.clearTimeout(timer)
    timer = globalThis.setTimeout(() => {
      timer = null
      const toSave = pending
      const toSaveRevision = pendingRevision
      pending = null
      pendingRevision = null
      if (!toSave || toSaveRevision === null) return
      void save(toSave, toSaveRevision)
    }, debounceMs)
    return stamped
  }

  return { replaceDoc, flush }
}

export interface UseStoryboardDocumentResult {
  doc: StoryboardDoc | null
  documents: StoryboardStore
  projectName: string
  status: string
  setStatus: Dispatch<SetStateAction<string>>
  docRef: MutableRefObject<StoryboardDoc | null>
  /** 基于最新文档的函数式更新；连续交互不会用旧 doc 互相覆盖。 */
  updateDoc(update: (current: StoryboardDoc) => StoryboardDoc): StoryboardDoc
  /** 显式快照写回；调用方必须先自行合并最新文档（控制器 / 投影使用）。 */
  replaceDoc(doc: StoryboardDoc): StoryboardDoc
  flush(): Promise<void>
}

/**
 * 漫剧文档唯一拥有者：水合、防抖保存、flush 与最新文档 ref 都留在这里。
 */
export function useStoryboardDocument(
  projectId: string,
  platform: Pick<PlatformKit, 'storage'>,
): UseStoryboardDocumentResult {
  const store = useStoryboardDocumentStore()
  const [doc, setDoc] = useState<StoryboardDoc | null>(null)
  const [projectName, setProjectName] = useState('')
  const [status, setStatus] = useState('')
  const docRef = useRef<StoryboardDoc | null>(null)

  const writer = useMemo(
    () =>
      createStoryboardDocumentWriter({
        store,
        onDocumentChange: setDoc,
        onStatus: setStatus,
      }),
    [store],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await platform.storage.open()
      const [loaded, project] = await Promise.all([
        store.load(projectId),
        createProjectRepository(platform.storage).get(projectId),
      ])
      if (cancelled) return
      docRef.current = loaded
      setDoc(loaded)
      setProjectName(project?.name ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [platform.storage, projectId, store])

  const flush = useCallback(() => writer.flush(), [writer])

  useEffect(
    () => () => {
      void flush().catch(() => {})
    },
    [flush],
  )

  useEffect(() => flushOnPageHide(() => void flush().catch(() => {})), [flush])

  const replaceDoc = useCallback(
    (next: StoryboardDoc) => {
      const stamped = writer.replaceDoc(next)
      docRef.current = stamped
      return stamped
    },
    [writer],
  )

  const updateDoc = useCallback(
    (update: (current: StoryboardDoc) => StoryboardDoc) => {
      const current = docRef.current
      if (!current) throw new Error('漫剧文档尚未水合')
      return replaceDoc(update(current))
    },
    [replaceDoc],
  )

  return {
    doc,
    documents: store,
    projectName,
    status,
    setStatus,
    docRef,
    updateDoc,
    replaceDoc,
    flush,
  }
}
