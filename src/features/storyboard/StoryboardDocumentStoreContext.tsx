import { createContext, useContext, type ReactNode } from 'react'
import type { StoryboardStore } from '../../state/project/storyboardStore'

const StoryboardDocumentStoreContext = createContext<StoryboardStore | null>(null)

/**
 * 漫剧页面与执行宿主共用同一份文档端口。Provider 只转发 Context，不增加 DOM。
 */
export function StoryboardDocumentStoreProvider({
  documents,
  children,
}: {
  documents: StoryboardStore
  children?: ReactNode
}) {
  return (
    <StoryboardDocumentStoreContext.Provider value={documents}>
      {children}
    </StoryboardDocumentStoreContext.Provider>
  )
}

export function useStoryboardDocumentStore(): StoryboardStore {
  const documents = useContext(StoryboardDocumentStoreContext)
  if (!documents) {
    throw new Error('StoryboardDocumentStoreProvider 未挂载')
  }
  return documents
}
