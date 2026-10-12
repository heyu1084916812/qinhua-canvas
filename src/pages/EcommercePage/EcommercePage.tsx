import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { useProjectWriteSafety } from '../../app/useProjectWriteSafety'
import { createStore } from '../../state/createStore'
import { CanvasStoreProvider, useCanvasStore, useGraph } from '../../workbenches/canvas/storeContext'
import {
  CanvasExecutionProvider,
  useCanvasExecution,
} from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { useAsset } from '../../workbenches/canvas/hooks/useAsset'
import { EcommerceStudio, type EcommerceResultItem, type EcommerceUpload } from '../../workbenches/ecommerce/EcommerceStudio'
import { createAgentSessionStore } from '../../state/agent/sessionStore'
import {
  planTitleOf,
  recentPlanSessions,
  toPlanMessages,
  toPlanSession,
  type EcommercePlanSession,
} from '../../domain/ecommerce/sessions'
import { LongImagePanel, type LongImageTileSource } from './LongImagePanel'
import { createProjectRepository } from '../../state/project/repository'
import {
  createAssetNode,
  importAssetFile,
  isImportableMedia,
} from '../../features/canvas/importAsset'
import { applyDefaults, resolveDefaults } from '../../features/canvas/createNodeWithDefaults'
import { buildEcommercePlan } from '../../domain/ecommerce/plan'
import {
  buildIntentSystem,
  buildIntentText,
  parseEcommerceIntent,
  type EcommerceIntentDraft,
} from '../../domain/ecommerce/chatParse'
import { resolveChatTarget } from '../../domain/shared/chatTarget'
import {
  buildShotsSystem,
  buildShotsText,
  parseShotsReply,
  shouldExpandShots,
  type ShotPlanResult,
} from '../../domain/ecommerce/chatShots'
import type { EcommerceShot } from '../../domain/ecommerce/prompt'
import { panelModelOptions } from '../../domain/project/modelCatalog'
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import { projectRoute } from '../../domain/shared/workbench'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { asAppError, describeError } from '../../shared/result'
import { createPackStore } from '../../state/project/packStore'
import {
  ECOMMERCE_PLATFORMS,
  type EcommercePlatform,
} from '../../domain/ecommerce/platforms'
import { ECOMMERCE_LANGUAGES, type EcommerceLanguage } from '../../domain/ecommerce/types'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
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
  /**
   * **与画布页共用同一个 store 实例**（对账 #411）。
   *
   * 这条以前是各页一个 Map，代价实测过：在电商页出一套图 → 点「在画布里打开」，
   * 画布页的撤销按钮是**灰的**（那批操作记在另一个实例的栈上），画布页还可能拿着旧快照。
   * 缓存与完整理由见 `state/workbenches/canvas/storeCache.ts`。
   */
  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store

  /**
   * 离开这一页时把还没到防抖时间的写入**冲一次**（与画布页同一手法）。
   * 实例是共用的，`dispose()` 只做 flush、不销毁状态 —— 紧接着进画布页仍拿得到同一个 store。
   */
  useEffect(() => () => store.dispose(), [store])

  /**
   * **关窗口 / 切到后台**也要冲一次，并广播给别的窗口（对账 #453）。
   *
   * `dispose()` 只在**路由离开**时跑；用户在这一页直接关窗口时它不会执行 ——
   * 画布页因为接了这两道保险所以没事，电商页原先没有 ⇒ "出完图立刻关窗口"那 ≤800ms
   * 的写入没人兜底，且两个窗口并排时这里的写入不会通知对面。
   * 与画布页**共用同一份**实现，别再各写一套。
   */
  useProjectWriteSafety(projectId, store)

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
  /** 长图面板开不开（对账 #420）：纯 UI 态，不落库 */
  const [longOpen, setLongOpen] = useState(false)
  /**
   * 「一句话 → 待确认方案」（对账 #422）。
   *
   * 三份状态刻意分开：`intent` 是**草稿**（还没进表单）、`intentError` 是**如实说**
   * （解析失败 / 超时 / 没配模型），`parsingIntent` 只管按钮。
   * 草稿**不落库** —— 它是"这句话可以变成什么"，不是用户已经定下来的东西。
   */
  const [intent, setIntent] = useState<EcommerceIntentDraft | null>(null)
  const [intentError, setIntentError] = useState('')
  const [parsingIntent, setParsingIntent] = useState(false)
  /**
   * **历史方案**（对账 #433）：一次成功的解析留一条，存在 `agentSessions`（项目级会话表，
   * 不新建表）。以前这些都只活在组件状态里 —— 刷新、切走、关掉再回来就没了，
   * 昨天想好的"亚马逊英文详情页 4 张、突出防水材质"今天得重打一遍。
   */
  const planSessions = useMemo(() => createAgentSessionStore(platform.storage), [platform])
  const [planHistory, setPlanHistory] = useState<EcommercePlanSession[]>([])
  /**
   * 这一次的分镜从哪来（对账 #406）：跑完如实显示。空串 = 这一趟没这回事，不显示。
   */
  const [shotPlanNote, setShotPlanNote] = useState('')
  /**
   * **分镜那一次对话请求也要算进"忙"**：它发生在建节点之前，
   * `exec.isRunning` 这时还是 false —— 不盖住的话按钮照样能点，
   * 用户点两下就花两次对话额度（而且要等两遍）。
   */
  const [preparingShots, setPreparingShots] = useState(false)
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

  /**
   * 对话渠道：**只认用户真勾过对话模型的启用渠道**，找不到就如实说没配
   * （`resolveChatTarget`，与漫剧拆镜同一条口径 —— 对账 #414 / #422）。
   *
   * 用 `useSyncExternalStore` 而不是读一次：用户去设置页改完渠道再切回来，
   * 这一栏的按钮状态必须立刻跟上，否则会停在"没有可用的对话模型"上，看起来像坏了。
   */
  const channelList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const chatTarget = useMemo(() => resolveChatTarget(channelList), [channelList])

  /**
   * 一句话 → 待确认草稿（对账 #422）。
   *
   * 三条硬口径：
   *  ① 模型回什么都要过 `parseEcommerceIntent`（白名单），解析不过**一个字都不改表单**；
   *  ② 没配对话模型 / 超时 / 渠道报错，一律**如实说**，绝不静默填一份猜的值；
   *  ③ 这里只产**草稿** —— 真填表由工作台里那句「应用到表单」触发。
   */
  /** 读一遍这个项目的方案历史（读失败只记日志：历史是"顺手留下的"，不该挡住出图这条主路） */
  const refreshPlanHistory = useCallback(async () => {
    try {
      const rows = await planSessions.list(projectId)
      const list = rows
        .map((row) => toPlanSession(row))
        .filter((item): item is EcommercePlanSession => item !== null)
      setPlanHistory(recentPlanSessions(list))
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 方案历史读取失败', { error: String(e) })
    }
  }, [planSessions, platform, projectId])

  useEffect(() => {
    void refreshPlanHistory()
  }, [refreshPlanHistory])

  /** 存一条方案：**存失败不影响这次解析**（草稿已经在界面上了），但要在日志里留痕 */
  const savePlanSession = async (text: string, draft: EcommerceIntentDraft) => {
    if (!chatTarget) return
    try {
      const created = await planSessions.create({
        projectId,
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        title: planTitleOf(text),
      })
      await planSessions.save({ ...created, messages: toPlanMessages(text, draft) })
      await refreshPlanHistory()
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 方案历史写入失败', { error: String(e) })
    }
  }

  const onParseIntent = async (text: string) => {
    if (!chatTarget) {
      setIntent(null)
      setIntentError('没有可用的对话模型 —— 先去「设置 → 渠道配置」给一条渠道勾上对话模型')
      return
    }
    setParsingIntent(true)
    setIntentError('')
    setIntent(null)
    /* 30 秒兜底：解析是"一句话"的小请求，卡住不该让按钮一直转 */
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: buildIntentSystem() },
          { role: 'user', content: buildIntentText(text, platforms) },
        ],
        signal: ac.signal,
      })
      const parsed = parseEcommerceIntent(result.text, { platforms, fallbackNote: text })
      if (parsed.ok) {
        setIntent(parsed.draft)
        /* 顺手留一条历史方案（对账 #433）—— 不 await：这一步失败不该拖住界面 */
        void savePlanSession(text, parsed.draft)
      } else setIntentError(parsed.error)
    } catch (e) {
      if (ac.signal.aborted) {
        setIntentError('解析超时（30 秒没回）。稍后再试，或直接填表单。')
      } else {
        const err = asAppError(e)
        setIntentError(err ? describeError(err) : '解析失败：这次没能拿到结果，稍后再试。')
      }
    } finally {
      clearTimeout(timer)
      setParsingIntent(false)
    }
  }

  /**
   * 调出一条旧方案 = **把那张确认卡放回来**（草稿进 `intent`），不直接填表单：
   * 用户点的是「我看看这条」，真正落表仍由那句「应用到表单」触发（与 #422 同一条口径）。
   */
  const onRestorePlan = (session: EcommercePlanSession) => {
    setIntent(session.draft)
    setIntentError('')
  }

  /** 删一条历史方案（删不动只记日志：列表是顺手留下的，不该弹错挡住出图） */
  const onRemovePlan = async (id: string) => {
    try {
      await planSessions.remove(id)
      await refreshPlanHistory()
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 方案历史删除失败', { error: String(e) })
    }
  }

  const onUpload = async (file: File, _kind: 'product' | 'reference'): Promise<EcommerceUpload | null> => {
    /**
     * **先挡一道类型**（对账 #427）：`accept="image/*"` 只管文件对话框，
     * **拖放绕得过它** —— `.txt` 拖进来会一路落库、变成一个破图预览。
     * 口径与画布那边一致（画布是导入后判、这里是导入前判，更省一次写入）：
     * 已知类型不是图/视频就拒收；**类型为空放行**（有些图没扩展名，别把它们冤枉掉）。
     */
    if (file.type && !isImportableMedia(file.type)) return null
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

  /**
   * 问一次对话渠道，把这几张的镜头写出来（对账 #406 / #423）。
   *
   * **两个入口共用这一支**：出图前「先出一份方案」，与出图时那条自动扩展。
   * 各写一份的话，迟早出现"手动那条会先说多花额度、自动那条不会"这种分叉
   * （#406 那条"判据只能有一份"的教训，这里是"请求只能有一份"）。
   *
   * **不抛错**：所有失败都变成 `{ ok:false, error }` —— 调用方要的是"能不能拿到方案"，
   * 而不是一个异常（分镜失败从来不该让出图失败）。
   */
  const requestShots = async (request: EcommerceRequest): Promise<ShotPlanResult> => {
    if (!chatTarget) {
      return {
        ok: false,
        error: '没有可用的对话模型 —— 先去「设置 → 渠道配置」给一条渠道勾上对话模型',
      }
    }
    const ac = new AbortController()
    /* 30 秒兜底：分镜是一次小请求，卡住就该早点回落去出图 */
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: buildShotsSystem() },
          { role: 'user', content: buildShotsText(request, platforms) },
        ],
        signal: ac.signal,
      })
      const parsed = parseShotsReply(result.text, request.count)
      return parsed.ok ? { ok: true, shots: parsed.shots } : { ok: false, error: parsed.error }
    } catch (e) {
      const err = asAppError(e)
      return {
        ok: false,
        error: ac.signal.aborted
          ? '分镜请求超时（30 秒没回）。'
          : err
            ? describeError(err)
            : '分镜请求失败。',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 「先出一份方案」的入口（对账 #423）：工作台点按钮 → 这里问一次 → 结果原样回去。
   *
   * 同一段请求也盖进 `preparingShots`：否则"出方案"那几秒里「开始生成」点得动，
   * 用户会为同一批图花两份对话额度。
   */
  const onPlanShots = async (request: EcommerceRequest): Promise<ShotPlanResult> => {
    setPreparingShots(true)
    try {
      return await requestShots(request)
    } finally {
      setPreparingShots(false)
    }
  }

  const onGenerate = async (request: EcommerceRequest, shotPlan?: readonly EcommerceShot[]) => {
    /**
     * ① **先按确定性脚本建一次计划**：它同时完成**全部校验**。
     *
     * 顺序有讲究 —— 校验不过就当场抛错，**绝不在一个非法请求上先花掉一次对话额度**
     * （先问分镜再校验，等于让用户为一次必然失败的生成多付一次对话费）。
     */
    let plan = buildEcommercePlan(request, { platforms })

    /**
     * ② **分镜**（对账 #406 / #423）。三条路，按优先级：
     *  - **A 用户已经确认过一份**（`shotPlan`，条数与张数对得上）⇒ 直接用，**不再多花**；
     *  - **B 值得问、且有对话模型** ⇒ 现问一次（判据与确认卡那句提示是同一个纯函数）；
     *  - **C 其余** ⇒ 用第 ① 步那份确定性脚本。
     * 无论走哪条，**绝不因为分镜失败而让用户出不了图**，并且**如实说走了哪条、为什么**。
     */
    const usablePlan = shotPlan && shotPlan.length === request.count ? shotPlan : null
    if (usablePlan) {
      plan = buildEcommercePlan(request, { platforms, shots: usablePlan })
      setShotPlanNote(`这 ${request.count} 张的镜头用的是你刚确认的那份方案。`)
    } else if (shouldExpandShots(request)) {
      if (!chatTarget) {
        setShotPlanNote('这几张用的是默认镜头脚本：没有可用的对话模型。')
      } else {
        const target = chatTarget
        setPreparingShots(true)
        try {
          const out = await requestShots(request)
          if (out.ok) {
            plan = buildEcommercePlan(request, { platforms, shots: out.shots })
            setShotPlanNote(
              `这 ${request.count} 张的镜头是按你的要求现写的（${target.label}，多花了一次对话额度）。`,
            )
          } else {
            setShotPlanNote(`这几张用了默认镜头脚本：${out.error}`)
          }
        } finally {
          setPreparingShots(false)
        }
      }
    } else {
      /* 这一趟没打算问模型：把上一次的说明清掉，免得挂在界面上误导 */
      setShotPlanNote('')
    }

    const recipe = await channels.defaultForNewNode({}, 'image')
    if (!recipe?.channelId || !recipe?.model) {
      throw new Error('还没有可用的生图渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上模型')
    }
    /* 用户选过就用他选的；没选过还是走解析出来的默认那一套 */
    const modelForRun = request.model || recipe.model

    /**
     * **两段式**（对账 #410）：
     *
     * ① 先把 N 张节点的默认值**全部异步解析完**（读渠道配方是异步的）；
     * ② 再在一个 `beginPlan` / `endPlan` 里**同步**落节点与连线。
     *
     * 为什么不能写成"循环里 await + 外面包一层 plan"：`beginPlan` 之间一旦让出
     * 事务边界，撤销就会断成好几步（`createNodeWithDefaults` 的文件注释记着当年怎么栽的）。
     * 于是用户按一次撤销，5 张套图应当**整批**退回去，而不是退 5 次还留着连线。
     */
    const prescribed: { at: { x: number; y: number }; data: Record<string, unknown> }[] = []
    for (let i = 0; i < plan.count; i += 1) {
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'image',
          model: modelForRun,
          /**
           * 逐张提示词（用户 2026-10-10 #10）：第 i 张用 `plan.prompts[i]`。
           * 白底图时 N 条相同（抽卡），主图 / 详情页 / 套图逐张不同（镜头脚本）。
           */
          prompt: plan.prompts[i] ?? plan.prompt,
          ratio: plan.ratio,
          count: 1,
        },
      })
      prescribed.push({ at: { x: 420 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 240 }, data })
    }
    const created: string[] = []
    store.beginPlan('ecommerce:generate', `电商出图 ×${prescribed.length}`)
    try {
      for (const item of prescribed) {
        const id = applyDefaults({
          store,
          channels,
          projectId,
          type: 'generation',
          at: item.at,
          data: item.data,
        })
        if (!id) continue
        created.push(id)
        store.setSelection([id])
        /* 产品图与参考图都连成上游：引擎按上游素材收集输入，这是"不改产品外观"的物理来源 */
        store.dispatch({ kind: 'edge.connect', source: request.productNodeId, target: id })
        for (const ref of plan.referenceNodeIds) {
          store.dispatch({ kind: 'edge.connect', source: ref, target: id })
        }
      }
    } finally {
      store.endPlan()
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
      /** 产物真实像素（长图等比缩放要用）；节点没记就留 null —— 长图会跳过并如实报数 */
      const sizeRaw = (node?.data as { naturalSize?: { width?: unknown; height?: unknown } } | undefined)
        ?.naturalSize
      const pixelSize =
        typeof sizeRaw?.width === 'number' &&
        typeof sizeRaw?.height === 'number' &&
        sizeRaw.width > 0 &&
        sizeRaw.height > 0
          ? { width: sizeRaw.width, height: sizeRaw.height }
          : null
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
        imageHash: hash,
        pixelSize,
        error: state?.kind === 'failed' ? describeError(state.error) : undefined,
        preview: hash ? <ResultPreview hash={hash} /> : undefined,
        onDownload: hash
          ? () => {
              /* 下载复用既有那份实现：它认识"素材已不在库里"与"远端素材在新标签页打开"两档 */
              void downloadAsset({ assets: platform.assets, files: platform.files }, hash)
            }
          : undefined,
        /**
         * 只重跑这一张（对账 #384 的"每张都能单独处理"那条工作流）。
         *
         * 跑着 / 排队中的那张**不给按钮**（并发重跑同一节点没有意义，只会把状态搅乱）；
         * 页面只负责转发到执行层，状态与失败原因仍由 `exec.nodeStateOf(id)` 单一来源回答。
         */
        onRerun:
          status === 'running' || status === 'pending' ? undefined : () => exec.runNode(id),
        /**
         * 原地换掉这一格（对账 #413）：产物写回**同一个节点**，画布上不多一个承载节点。
         *
         * 与上面那条只差一个开关（`inPlace`）—— 抽卡 vs 换掉是两种工作流，
         * 摆两个按钮比让用户猜"重跑会多出一个节点吗"更清楚。
         */
        onReplace:
          status === 'running' || status === 'pending'
            ? undefined
            : () => exec.runNode(id, { inPlace: true }),
        /**
         * 「在画布里改这一张」（对账 #424）：带上 `?focus=<nodeId>` 跳过去 ——
         * 画布会**选中并居中**这一个节点。以前只有项目级的「在画布里打开」，
         * 图一多就得自己在一堆节点里找。
         */
        onFocusInCanvas: () => navigate(projectRoute('canvas', projectId, { focus: id })),
      }
    })
  }, [exec, graph.nodes, nodeIds, platform, navigate, projectId])

  /**
   * 长图拼合的输入（对账 #420）：只取**已完成且有真实像素**的。
   *
   * `results` 本身是 memo（依赖执行状态与图），空闲时引用稳定 ⇒ 长图不会每帧重画。
   */
  const longTiles = useMemo<LongImageTileSource[]>(
    () =>
      results.flatMap((r) =>
        r.status === 'done' && r.imageHash && r.pixelSize
          ? [
              {
                id: r.nodeId,
                hash: r.imageHash,
                width: r.pixelSize.width,
                height: r.pixelSize.height,
              },
            ]
          : [],
      ),
    [results],
  )

  return (
    <EcommerceStudio
      projectName={projectName || '未命名项目'}
      platforms={platforms}
      models={models}
      model={model}
      onModelChange={setModel}
      onUpload={onUpload}
      onGenerate={onGenerate}
      running={exec.isRunning || preparingShots}
      results={results}
      onOpenCanvas={() => navigate(projectRoute('canvas', projectId))}
      onParseIntent={onParseIntent}
      parsingIntent={parsingIntent}
      intent={intent}
      planHistory={planHistory}
      onRestorePlan={onRestorePlan}
      onRemovePlan={onRemovePlan}
      chatTargetLabel={chatTarget?.label ?? ''}
      intentError={intentError}
      onIntentApplied={() => setIntent(null)}
      onIntentDiscard={() => {
        setIntent(null)
        setIntentError('')
      }}
      onPlanShots={onPlanShots}
      shotPlanNote={shotPlanNote}
      onOpenLongImage={() => setLongOpen(true)}
      longImage={
        longOpen ? <LongImagePanel tiles={longTiles} onClose={() => setLongOpen(false)} /> : null
      }
    />
  )
}
