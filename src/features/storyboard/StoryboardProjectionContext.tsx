import {
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import type {
  StoryboardCanvasGraph,
  StoryboardProjectionPort,
} from './canvasPort'

export interface StoryboardProjectionContextValue {
  projection: StoryboardProjectionPort
  graph: StoryboardCanvasGraph
}

const StoryboardProjectionContext =
  createContext<StoryboardProjectionContextValue | null>(null)

export function StoryboardProjectionProvider({
  value,
  children,
}: {
  value: StoryboardProjectionContextValue
  children?: ReactNode
}) {
  return (
    <StoryboardProjectionContext.Provider value={value}>
      {children}
    </StoryboardProjectionContext.Provider>
  )
}

export function useStoryboardProjection(): StoryboardProjectionContextValue {
  const value = useContext(StoryboardProjectionContext)
  if (!value) {
    throw new Error('StoryboardProjectionProvider 未挂载')
  }
  return value
}
