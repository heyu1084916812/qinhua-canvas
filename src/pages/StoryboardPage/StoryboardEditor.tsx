import { useEffect, useRef, useState } from 'react'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useStoryboardCanvasRuntime } from '../../app/workbenchHosts/StoryboardCanvasHost'
import type { MergeSuggestion } from '../../domain/storyboard/mergeSuggest'
import { useStoryboardCanvasMirror } from '../../features/storyboard/useStoryboardCanvasMirror'
import { useStoryboardDocument } from '../../features/storyboard/useStoryboardDocument'
import type { NoticeState } from './StoryboardEditor.types'
import { StoryboardEditorRuntime } from './StoryboardEditorRuntime'
import styles from './StoryboardPage.module.css'

export function StoryboardEditor({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const channels = useChannels()
  const { canvas, graph } = useStoryboardCanvasRuntime()
  const {
    doc,
    documents: store,
    projectName,
    status,
    setStatus,
    docRef,
    updateDoc: apply,
    replaceDoc,
    flush,
  } = useStoryboardDocument(projectId, platform)
  const [selectedId, setSelectedId] = useState('')
  const selectionHydrated = useRef(false)
  const [confirming, setConfirming] = useState('')
  const [merge, setMerge] = useState<{
    dropId: string
    keepId: string | null
  } | null>(null)
  const [merges, setMerges] = useState<MergeSuggestion[]>([])
  const [mergeScan, setMergeScan] = useState<NoticeState>({
    kind: 'idle',
    text: '',
  })
  const [mergeConfirmId, setMergeConfirmId] = useState('')

  useEffect(() => {
    if (!doc || selectionHydrated.current) return
    selectionHydrated.current = true
    setSelectedId(doc.episodes[0]?.id ?? '')
  }, [doc])

  useStoryboardCanvasMirror({ doc, nodes: graph.nodes, replaceDoc })

  if (!doc) {
    return (
      <div className={styles.loading} data-storyboard-loading>
        正在打开漫剧项目…
      </div>
    )
  }

  return (
    <StoryboardEditorRuntime
      projectId={projectId}
      doc={doc}
      platform={platform}
      channels={channels}
      canvas={canvas}
      graph={graph}
      projectName={projectName}
      status={status}
      setStatus={setStatus}
      store={store}
      docRef={docRef}
      apply={apply}
      replaceDoc={replaceDoc}
      flush={flush}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      confirming={confirming}
      setConfirming={setConfirming}
      merge={merge}
      setMerge={setMerge}
      merges={merges}
      setMerges={setMerges}
      mergeScan={mergeScan}
      setMergeScan={setMergeScan}
      mergeConfirmId={mergeConfirmId}
      setMergeConfirmId={setMergeConfirmId}
    />
  )
}
