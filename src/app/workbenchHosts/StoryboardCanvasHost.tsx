import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePlatform } from '../providers/PlatformProvider'
import { useChannels } from '../providers/ChannelStoreProvider'
import { useProjectWriteSafety } from '../useProjectWriteSafety'
import { rememberActiveWorkbench } from '../../state/project/activeCanvas'
import { createStore } from '../../state/createStore'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
import {
  CanvasStoreProvider,
  useCanvasStore,
  useGraph,
} from '../../workbenches/canvas/storeContext'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import type { StoryboardProjectionPort } from '../../features/storyboard/canvasPort'
import { StoryboardProjectionProvider } from '../../features/storyboard/StoryboardProjectionContext'
import {
  applyDefaults,
  resolveDefaults,
} from '../../features/canvas/createNodeWithDefaults'

function RuntimeBridge({
  projectId,
  children,
}: {
  projectId: string
  children?: ReactNode
}) {
  const canvasStore = useCanvasStore()
  const graph = useGraph()
  const channels = useChannels()
  const projection = useMemo<StoryboardProjectionPort>(
    () => ({
      getSnapshot: () => canvasStore.getSnapshot(),
      beginPlan: (id, label) => canvasStore.beginPlan(id, label),
      endPlan: () => canvasStore.endPlan(),
      resolveGenerationData: (extraData) =>
        resolveDefaults({
          channels,
          type: 'generation',
          extraData,
        }),
      createGenerationNode: ({ data, at }) =>
        applyDefaults({
          store: canvasStore,
          channels,
          projectId,
          type: 'generation',
          at,
          data,
        }),
      updateNodeData: (id, patch, transient) => {
        canvasStore.dispatch({
          kind: 'node.updateData',
          id,
          patch,
          ...(transient === undefined ? {} : { transient }),
        })
      },
      connectEdge: (source, target) => {
        canvasStore.dispatch({ kind: 'edge.connect', source, target })
      },
      removeEdge: (id) => {
        canvasStore.dispatch({ kind: 'edge.remove', id })
      },
    }),
    [canvasStore, channels, projectId],
  )
  return (
    <StoryboardProjectionProvider value={{ projection, graph }}>
      {children}
    </StoryboardProjectionProvider>
  )
}

/**
 * 漫剧的可选画布投影组合根。
 *
 * 水合门、写盘保险和共享 canvasStore 实例都留在这里；页面只提供项目 id 与加载态。
 * 这里不挂画布执行器；业务 RunPlan 由 StoryboardExecutionProvider 独立执行。
 */
export function StoryboardCanvasHost({
  projectId,
  children,
  renderLoading,
}: {
  projectId: string
  children?: ReactNode
  renderLoading: (error: string) => ReactNode
}) {
  const platform = usePlatform()
  useEffect(() => {
    rememberActiveWorkbench('storyboard', projectId)
  }, [projectId])

  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store
  const [hydrated, setHydrated] = useState(cached.hydrated)
  const [hydrateError, setHydrateError] = useState('')

  useEffect(() => () => store.dispose(), [store])
  useProjectWriteSafety(projectId, store)

  useEffect(() => {
    if (cached.hydrated) return
    let cancelled = false
    void (async () => {
      try {
        await platform.storage.open()
        const [nodes, edges] = await Promise.all([
          platform.storage.query('nodes', { projectId }),
          platform.storage.query('edges', { projectId }),
        ])
        if (cancelled) return
        cached.hydrated = true
        store.hydrate({
          projectId,
          nodes: nodes as unknown as NodeSnapshot[],
          edges: edges as unknown as Edge[],
        })
        setHydrated(true)
      } catch (error) {
        if (!cancelled) {
          setHydrateError(
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cached, platform, projectId, store])

  if (!hydrated) return renderLoading(hydrateError)

  return (
    <CanvasStoreProvider store={store}>
      <RuntimeBridge projectId={projectId}>{children}</RuntimeBridge>
    </CanvasStoreProvider>
  )
}
