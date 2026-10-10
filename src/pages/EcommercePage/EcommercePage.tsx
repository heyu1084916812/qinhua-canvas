import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { createStore } from '../../state/createStore'
import { CanvasStoreProvider, useCanvasStore, useGraph } from '../../workbenches/canvas/storeContext'
import {
  CanvasExecutionProvider,
  useCanvasExecution,
} from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { useAsset } from '../../workbenches/canvas/hooks/useAsset'
import { EcommerceStudio, type EcommerceResultItem, type EcommerceUpload } from '../../workbenches/ecommerce/EcommerceStudio'
import { createProjectRepository } from '../../state/project/repository'
import { createAssetNode, importAssetFile } from '../../features/canvas/importAsset'
import { createNodeWithDefaults } from '../../features/canvas/createNodeWithDefaults'
import { buildEcommercePlan } from '../../domain/ecommerce/plan'
import { panelModelOptions } from '../../domain/project/modelCatalog'
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import { projectRoute } from '../../domain/shared/workbench'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { describeError } from '../../shared/result'
import { createPackStore } from '../../state/project/packStore'
import {
  ECOMMERCE_PLATFORMS,
  type EcommercePlatform,
} from '../../domain/ecommerce/platforms'
import { ECOMMERCE_LANGUAGES, type EcommerceLanguage } from '../../domain/ecommerce/types'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
import styles from './EcommercePage.module.css'

/**
 * 电商工作台页（对账 #384 的 D3/D4/D5/D6）。
 *
 * ## 它是**装配层**，不是工作台
 *
 * 工作台自己的界面在 `workbenches/ecommerce/EcommerceStudio`，它**只认 props**、
 * 不认识画布；而这里负责把两侧接起来：建/取画布 store、挂执行 Provider、
 * 上传素材、建生成节点、跑引擎、把结果读回来。这样 `workbenches/ecommerce`
 * 与 `workbenches/canvas` 之间**零互引**（架构 §7.2 那条"工作台之间不互引"的口径）。
 *
 * ## A 版的数据落在哪
 *
 * 复用电商的**画布图**：产品图 / 参考图 = 素材节点，出图 = 生成节点 + 运行记录，
 * 结果字节仍是内容寻址的 `assets`。所以"发送到画布"在这里就是「在画布里打开」
 * —— 结果本来就已经是这个项目的画布节点。专业版（#380）要独立数据模型时再补表。
 */

/** 与 `CanvasPage` 同一套按项目缓存 store 的做法（切走再回来不丢运行中的写入） */
const stores = new Map<string, { store: CanvasStore; hydrated: boolean }>()

export function EcommercePage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <EcommerceEmpty />
  return <EcommerceProject key={projectId} projectId={projectId} />
}

/** 没有项目时的引导页：给出口，不空白（D3 的验收判据之一） */
function EcommerceEmpty() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.create({ name: '电商出图', workbench: 'ecommerce' })
      navigate(projectRoute('ecommerce', project.id))
    } catch {
      setError('新建项目失败，稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className={styles.emptyWrap} data-ecommerce-empty-page>
      <h1 className={styles.emptyTitle}>电商工作台</h1>
      <p className={styles.emptyText}>
        上传产品图、选平台与用途，右边直接出图。结果会落成这个项目的画布节点，
        所以随时能换个界面继续细修。
      </p>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        data-ecommerce-create
        onClick={() => void create()}
      >
        {busy ? '正在新建…' : '新建电商项目'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.emptyHint}>
        也可以从「项目」页新建 —— 新建菜单里选「电商工作台」。
      </p>
    </div>
  )
}

function EcommerceProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const cached =
    stores.get(projectId) ?? { store: createStore({ workbench: 'canvas', platform, projectId }), hydrated: false }
  stores.set(projectId, cached)
  const store = cached.store

  /** 从库里读回图（与画布页同一口径：只读一次，避免把内存里正在跑的写入盖回去） */
  useEffect(() => {
    if (cached.hydrated) return
    let cancelled = false
    void (async () => {
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
    })()
    return () => {
      cancelled = true
    }
  }, [cached, platform, projectId, store])

  return (
    <CanvasStoreProvider store={store}>
      <CanvasExecutionProvider>
        <StudioHost projectId={projectId} />
      </CanvasExecutionProvider>
    </CanvasStoreProvider>
  )
}

/** 结果缩略图：按 hash 取素材（hook 必须落在子组件里，不能在 map 里调） */
function ResultPreview({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img src={url} alt="" />
}

function StudioHost({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const graph = useGraph()
  const exec = useCanvasExecution()
  const navigate = useNavigate()
  const [nodeIds, setNodeIds] = useState<string[]>([])
  const [projectName, setProjectName] = useState('')
  /**
   * 出图模型（用户 2026-10-10 #2）。空串 = 默认：由 `channels.defaultForNewNode` 解析。
   *
   * 清单取的是**固定前端显示名**（与画布创作面板同一份 `panelModelOptions('image')`）——
   * 渠道拉回来的裸模型名不进这个列表，理由见 `modelCatalog` 的注释（对账 #371）。
   */
  const [model, setModel] = useState('')
  const models = useMemo(() => panelModelOptions('image'), [])
  /**
   * 平台清单 = 内置 + **扩展包带进来的规则**（对账 #386 的 E3）。
   *
   * 同 id 时以扩展包为准：包就是用来"更新规则而不必等应用发版"的，
   * 若被内置那份压住，这个机制就白做了。
   */
  const [platforms, setPlatforms] = useState<readonly EcommercePlatform[]>(ECOMMERCE_PLATFORMS)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const extra = await createPackStore(platform.storage).platforms()
      if (cancelled || extra.length === 0) return
      const byId = new Map<string, EcommercePlatform>(
        ECOMMERCE_PLATFORMS.map((p) => [p.id, p]),
      )
      const known = new Set<string>(ECOMMERCE_LANGUAGES)
      for (const p of extra) {
        byId.set(p.id, {
          ...p,
          countHint: p.countHint ?? '',
          /* 包里的语言代码是**未受信任的输入**：只留我们认识的，别把 'xx' 拼进提示词 */
          languages: p.languages.filter((l): l is EcommerceLanguage => known.has(l)),
        })
      }
      setPlatforms([...byId.values()])
    })()
    return () => {
      cancelled = true
    }
  }, [platform])

  /** 项目名（标题下面那行）—— 读一次即可 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.get(projectId)
      if (!cancelled) setProjectName(project?.name ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId])

  const onUpload = async (file: File, _kind: 'product' | 'reference'): Promise<EcommerceUpload | null> => {
    const deps = { platform, store, projectId }
    const asset = await importAssetFile(deps, file)
    if (!asset) return null
    /* 素材节点落点：一列一列往右排，与生成节点分开（用户之后在画布里能一眼分清） */
    /* 素材节点往下排：与生成节点那一列分开，用户之后在画布里能一眼分清谁是输入 */
    const index = store.getSnapshot().nodes.length
    const nodeId = createAssetNode(deps, asset, { x: 40, y: 40 + index * 200 })
    if (!nodeId) return null
    return { nodeId, hash: asset.hash, preview: <ResultPreview hash={asset.hash} /> }
  }

  const onGenerate = async (request: EcommerceRequest) => {
    /* 校验一律走领域层：非法输入当场抛错，界面把话原样说给用户（不静默兜底） */
    const plan = buildEcommercePlan(request, { platforms })
    const recipe = await channels.defaultForNewNode({}, 'image')
    if (!recipe?.channelId || !recipe?.model) {
      throw new Error('还没有可用的生图渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上模型')
    }
    /* 用户选过就用他选的；没选过还是走解析出来的默认那一套 */
    const modelForRun = request.model || recipe.model

    const created: string[] = []
    for (let i = 0; i < plan.count; i += 1) {
      const id = await createNodeWithDefaults({
        store,
        channels,
        projectId,
        type: 'generation',
        at: { x: 420 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 240 },
        extraData: {
          mode: 'image',
          model: modelForRun,
          prompt: plan.prompt,
          ratio: plan.ratio,
          count: 1,
        },
      })
      if (!id) continue
      created.push(id)
      /* 产品图与参考图都连成上游：引擎按上游素材收集输入，这是"不改产品外观"的物理来源 */
      store.dispatch({ kind: 'edge.connect', source: request.productNodeId, target: id })
      for (const ref of plan.referenceNodeIds) {
        store.dispatch({ kind: 'edge.connect', source: ref, target: id })
      }
    }
    setNodeIds(created)
    /* 逐张跑：并发交给渠道侧没有意义（这里每张都是一个独立节点），串行更稳、也更好报错 */
    for (const id of created) {
      await exec.runNode(id)
    }
  }

  const results = useMemo<EcommerceResultItem[]>(() => {
    return nodeIds.map((id) => {
      const node = graph.nodes.find((n) => n.id === id)
      const state = exec.nodeStateOf(id)
      const hash = node ? assetHashesOfNode(node)[0] : undefined
      const status: EcommerceResultItem['status'] =
        state?.kind === 'failed'
          ? 'failed'
          : hash
            ? 'done'
            : state?.kind === 'running'
              ? 'running'
              : 'pending'
      return {
        nodeId: id,
        status,
        error: state?.kind === 'failed' ? describeError(state.error) : undefined,
        preview: hash ? <ResultPreview hash={hash} /> : undefined,
        onDownload: hash
          ? () => {
              /* 下载复用既有那份实现：它认识"素材已不在库里"与"远端素材在新标签页打开"两档 */
              void downloadAsset({ assets: platform.assets, files: platform.files }, hash)
            }
          : undefined,
      }
    })
  }, [exec, graph.nodes, nodeIds, platform])

  return (
    <EcommerceStudio
      projectName={projectName || '未命名项目'}
      platforms={platforms}
      models={models}
      model={model}
      onModelChange={setModel}
      onUpload={onUpload}
      onGenerate={onGenerate}
      running={exec.isRunning}
      results={results}
      onOpenCanvas={() => navigate(projectRoute('canvas', projectId))}
    />
  )
}
