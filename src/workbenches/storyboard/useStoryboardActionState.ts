import { useMemo, useRef, useSyncExternalStore } from 'react'

export type StoryboardActionKind =
  | 'asset-base'
  | 'asset-turnaround'
  | 'shot-image'
  | 'shot-video'
  | 'episode-image'
  | 'episode-video'
  | 'voice'
  | 'digital-human'
  | 'video-upscale'
  | 'video-erase'
  | 'video-edit'
  | 'video-extend'

export type StoryboardActionBusySnapshot = Readonly<{
  assetBase: Readonly<Record<string, true>>
  assetTurnaround: Readonly<Record<string, true>>
  shotImage: Readonly<Record<string, true>>
  shotVideo: Readonly<Record<string, true>>
  episodeImage: Readonly<Record<string, true>>
  episodeVideo: Readonly<Record<string, true>>
  voice: Readonly<Record<string, true>>
  digitalHuman: Readonly<Record<string, true>>
  videoUpscale: Readonly<Record<string, true>>
  videoErase: Readonly<Record<string, true>>
  videoEdit: Readonly<Record<string, true>>
  videoExtend: Readonly<Record<string, true>>
}>

export interface StoryboardActionLease {
  release(): void
}

export interface StoryboardActionStatePort {
  readonly busy: StoryboardActionBusySnapshot
  tryAcquire(kind: StoryboardActionKind, subjectId: string): StoryboardActionLease | null
  isBusy(kind: StoryboardActionKind, subjectId: string): boolean
}

export interface StoryboardActionStateStore {
  getBusy(): StoryboardActionBusySnapshot
  subscribe(listener: () => void): () => void
  tryAcquire(kind: StoryboardActionKind, subjectId: string): StoryboardActionLease | null
  isBusy(kind: StoryboardActionKind, subjectId: string): boolean
}

const EMPTY_SUBJECTS: Readonly<Record<string, true>> = Object.freeze({})
const EMPTY_SNAPSHOT: StoryboardActionBusySnapshot = Object.freeze({
  assetBase: EMPTY_SUBJECTS,
  assetTurnaround: EMPTY_SUBJECTS,
  shotImage: EMPTY_SUBJECTS,
  shotVideo: EMPTY_SUBJECTS,
  episodeImage: EMPTY_SUBJECTS,
  episodeVideo: EMPTY_SUBJECTS,
  voice: EMPTY_SUBJECTS,
  digitalHuman: EMPTY_SUBJECTS,
  videoUpscale: EMPTY_SUBJECTS,
  videoErase: EMPTY_SUBJECTS,
  videoEdit: EMPTY_SUBJECTS,
  videoExtend: EMPTY_SUBJECTS,
})

function subjectsOf(
  busy: StoryboardActionBusySnapshot,
  kind: StoryboardActionKind,
): Readonly<Record<string, true>> {
  switch (kind) {
    case 'asset-base':
      return busy.assetBase
    case 'asset-turnaround':
      return busy.assetTurnaround
    case 'shot-image':
      return busy.shotImage
    case 'shot-video':
      return busy.shotVideo
    case 'episode-image':
      return busy.episodeImage
    case 'episode-video':
      return busy.episodeVideo
    case 'voice':
      return busy.voice
    case 'digital-human':
      return busy.digitalHuman
    case 'video-upscale':
      return busy.videoUpscale
    case 'video-erase':
      return busy.videoErase
    case 'video-edit':
      return busy.videoEdit
    case 'video-extend':
      return busy.videoExtend
  }
}

function withSubject(
  current: Readonly<Record<string, true>>,
  subjectId: string,
  active: boolean,
): Readonly<Record<string, true>> {
  const next = { ...current }
  if (active) next[subjectId] = true
  else delete next[subjectId]
  return Object.freeze(next)
}

function withAction(
  busy: StoryboardActionBusySnapshot,
  kind: StoryboardActionKind,
  subjects: Readonly<Record<string, true>>,
): StoryboardActionBusySnapshot {
  switch (kind) {
    case 'asset-base':
      return Object.freeze({ ...busy, assetBase: subjects })
    case 'asset-turnaround':
      return Object.freeze({ ...busy, assetTurnaround: subjects })
    case 'shot-image':
      return Object.freeze({ ...busy, shotImage: subjects })
    case 'shot-video':
      return Object.freeze({ ...busy, shotVideo: subjects })
    case 'episode-image':
      return Object.freeze({ ...busy, episodeImage: subjects })
    case 'episode-video':
      return Object.freeze({ ...busy, episodeVideo: subjects })
    case 'voice':
      return Object.freeze({ ...busy, voice: subjects })
    case 'digital-human':
      return Object.freeze({ ...busy, digitalHuman: subjects })
    case 'video-upscale':
      return Object.freeze({ ...busy, videoUpscale: subjects })
    case 'video-erase':
      return Object.freeze({ ...busy, videoErase: subjects })
    case 'video-edit':
      return Object.freeze({ ...busy, videoEdit: subjects })
    case 'video-extend':
      return Object.freeze({ ...busy, videoExtend: subjects })
  }
}

export function createStoryboardActionStateStore(): StoryboardActionStateStore {
  const locks = new Map<StoryboardActionKind, Set<string>>()
  const listeners = new Set<() => void>()
  let busy = EMPTY_SNAPSHOT

  const publish = (kind: StoryboardActionKind, subjects: Readonly<Record<string, true>>) => {
    busy = withAction(busy, kind, subjects)
    for (const listener of listeners) listener()
  }

  const release = (kind: StoryboardActionKind, subjectId: string) => {
    const subjects = locks.get(kind)
    if (!subjects?.delete(subjectId)) return
    if (subjects.size === 0) locks.delete(kind)
    publish(kind, withSubject(subjectsOf(busy, kind), subjectId, false))
  }

  const tryAcquire = (
    kind: StoryboardActionKind,
    subjectId: string,
  ): StoryboardActionLease | null => {
    if (!subjectId) return null
    const subjects = locks.get(kind) ?? new Set<string>()
    if (subjects.has(subjectId)) return null
    subjects.add(subjectId)
    locks.set(kind, subjects)
    publish(kind, withSubject(subjectsOf(busy, kind), subjectId, true))

    let released = false
    return Object.freeze({
      release() {
        if (released) return
        released = true
        release(kind, subjectId)
      },
    })
  }

  return {
    getBusy: () => busy,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    tryAcquire,
    isBusy: (kind, subjectId) => locks.get(kind)?.has(subjectId) ?? false,
  }
}

export function useStoryboardActionState(): StoryboardActionStatePort {
  const storeRef = useRef<StoryboardActionStateStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createStoryboardActionStateStore()
  }
  const store = storeRef.current
  const busy = useSyncExternalStore(
    store.subscribe,
    store.getBusy,
    store.getBusy,
  )

  return useMemo(
    () => ({
      busy,
      tryAcquire: store.tryAcquire,
      isBusy: store.isBusy,
    }),
    [busy, store],
  )
}
