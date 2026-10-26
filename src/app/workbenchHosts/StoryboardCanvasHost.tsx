import {
  createContext,
  useContext,
  useEffect,
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
import {
  CanvasExecutionProvider,
  useCanvasExecution,
} from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import {
  applyDefaults,
  resolveDefaults,
} from '../../features/canvas/createNodeWithDefaults'

type CanvasRuntime = {
  canvas: StoryboardCanvasPort
  graph: ReturnType<typeof useGraph>
}

const StoryboardCanvasRuntimeContext = createContext<CanvasRuntime | null>(null)

/**
 * 漫剧页面只通过这个中性入口拿运行时；画布 Store、Provider 和 graph Hook
 * 都封在 app 层的组合根里，不能反向散进页面或 storyboard workbench。
 */
export function useStoryboardCanvasRuntime(): CanvasRuntime {
  const runtime = useContext(StoryboardCanvasRuntimeContext)
  if (!runtime) {
    throw new Error('StoryboardCanvasHost is not mounted')
  }
  return runtime
}

function RuntimeBridge({
  projectId,
  children,
}: {
  projectId: string
  children?: ReactNode
}) {
  const canvasStore = useCanvasStore()
  const graph = useGraph()
  const execution = useCanvasExecution()
  const channels = useChannels()
  const canvas: StoryboardCanvasPort = {
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
    putAsset: (asset) => {
      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          ...asset,
          createdAt: Date.now(),
          projectId,
        },
      })
    },
    runNode: (nodeId, opts) => execution.runNode(nodeId, opts),
    nodeStateOf: (nodeId) => execution.nodeStateOf(nodeId),
    get isRunning() {
      return execution.isRunning
    },
  }
  return (
    <StoryboardCanvasRuntimeContext.Provider
      value={{ canvas, graph }}
    >
      {children}
    </StoryboardCanvasRuntimeContext.Provider>
  )
}

/**
 * 漫剧的画布运行时组合根。
 *
 * 水合门、写盘保险和共享 canvasStore 实例都留在这里；页面只提供项目 id 与加载态。
 * Provider 内部继续复用唯一画布执行内核，不创建第二套节点图或执行器。
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
      <CanvasExecutionProvider>
        <RuntimeBridge projectId={projectId}>{children}</RuntimeBridge>
      </CanvasExecutionProvider>
    </CanvasStoreProvider>
  )
}
