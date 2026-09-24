import { useMemo, useSyncExternalStore } from 'react'
import type { NodeSnapshot, GenerationData, GroupData, BatchData, PromptData } from '../../../domain/canvas/model/node'
import { directUpstream } from '../../../domain/canvas/graph/upstreamOf'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { childIdsOf } from '../../../domain/canvas/nodeSpecs/group'
import { batchItemsOf, externalInputsOf } from '../../../domain/canvas/nodeSpecs/batch'
import { promptSpec } from '../../../domain/canvas/nodeSpecs/prompt'
import { imageAssetInputsOf } from '../../../domain/shared/execution/inputs'
import { describeError } from '../../../shared/result'
import { clampDuration } from '../../../domain/shared/capability'
import { CreationPanel } from './CreationPanel'
import type { PanelEvent, PanelModel, PanelThumb, RecipeSnapshot } from './panelModel'
import { useGraph, useViewportState, useCanvasStore, useSelection } from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { usePromptTools } from '../../../features/shared/promptTools/usePromptTools'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { isRecipeEdit } from '../../../domain/project/generationPreset'

/** 面板与节点底边的间距 */
const PANEL_GAP = 12

/** 出现创作参数面板的节点类型（§6.1「单选提示词 / 生成 / 分组 / 批量节点时出现」） */
const PANEL_TYPES = new Set<NodeSnapshot['type']>(['prompt', 'generation', 'group', 'batch'])

/**
 * 创作参数面板层（架构 §4.7）。
 *
 * 定位：**屏幕坐标**下挂在所选节点正下方、水平居中对齐（§6.8「始终在节点下方，水平中心与节点对齐」），
 * 因此本层放在 [data-world] 之外——缩放画布时面板大小不变（§6.8「缩放独立性」）。
 *
 * 数据：NodeLayer 持有 graph，本层同样读图算好 PanelModel 注入面板，
 * 面板组件本身不读图（视图层不读图，架构 §4.7）。
 */
export function PanelLayer({
  onOpenSettings,
  onOpenSkills,
}: {
  onOpenSettings?: () => void
  /** 打开技能库（用户 2026-09-24）：面板上「管理技能库」与缺技能时的出口 */
  onOpenSkills?: () => void
}) {
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  const store = useCanvasStore()
  const exec = useCanvasExecution()
  /** 配方记忆（用户 2026-09-23）：面板里改完参数即写回该渠道的配方 */
  const channels = useChannels()
  // §6.15：拖动期间面板立即隐藏；发生**真实位移**的拖动，松手后保持隐藏，
  // 直到下一次显式选中（setSelection 复位 panelDismissed）——节点已被挪走，
  // 面板再弹回来只会「追着节点跑」。普通单击（无位移）不算拖动，面板照常出现。
  const dragging = useSyncExternalStore(store.subscribe, store.isDragging, store.isDragging)
  const panelDismissed = useSyncExternalStore(
    store.subscribe,
    store.isPanelDismissed,
    store.isPanelDismissed,
  )

  // 多选不显示面板（§6.15）；单选且类型适用才显示；拖动中 / 拖过后（未重新选中）同样隐藏
  const selectedNode = useMemo(() => {
    if (dragging || panelDismissed) return null
    if (selection.length !== 1) return null
    const n = graph.nodes.find((x) => x.id === selection[0])
    return n && PANEL_TYPES.has(n.type) ? n : null
  }, [graph.nodes, selection, dragging, panelDismissed])

  // 提示词节点的「优化 / 翻译」工具（§6.7）：面板是纯视图，状态由本层持有
  const promptData = selectedNode?.type === 'prompt' ? (selectedNode.data as PromptData) : null
  /**
   * 选中提示词节点的上游图片素材（§6.7 反推）：与节点本体、与真正发出的请求
   * 取同一份 `promptSpec.collectInputs`，不在这里另算。
   */
  const promptImageInputs = useMemo(
    () =>
      selectedNode?.type === 'prompt'
        ? imageAssetInputsOf(
            promptSpec.collectInputs({
              node: selectedNode as NodeSnapshot<PromptData>,
              graph,
            }),
          )
        : [],
    [selectedNode, graph],
  )
  const promptTools = usePromptTools({
    completeText: exec.completeText,
    channelId: promptData?.channelId,
    model: promptData?.model,
    imageInputs: promptImageInputs,
    onResult: (text) => {
      if (!selectedNode || selectedNode.type !== 'prompt') return
      // §6.7「面板 = 工作区」：面板里跑的优化 / 翻译 / 反推只覆盖**草稿**，
      // 不碰正文——正文只能经「写入节点」显式确认（或双击节点直接编辑）。
      store.dispatch({
        kind: 'node.updateData',
        id: selectedNode.id,
        patch: { draft: text },
        transient: false,
      })
      /**
       * 长文本自动开大编辑框（用户 2026-09-24：「长文本框也要」）。
       *
       * 面板里那个输入框只有几行高，而技能（如「详情页策划」）的产出往往是一整篇 ——
       * 在小框里看它得反复滚动，等于没法用。项目里已经有为此做的
       * 「大编辑框灯箱」（`TextEditorLayer`，带 Markdown 工具栏），直接复用它。
       *
       * 阈值 200 字：短结果（翻译一句话）开框反而打断节奏；
       * 长的说明它已经是一篇文档，适合大框 + 格式工具。
       */
      if (text.length >= 200) store.openTextEditor(selectedNode.id)
    },
  })

  if (!selectedNode) return null

  const state = exec.nodeStateOf(selectedNode.id)
  const running = state?.kind === 'queued' || state?.kind === 'running'
  const error = state?.kind === 'failed' ? describeError(state.error) : null

  // 用 `toWorldRectInGraph` 而非 `toWorldRect`：选中的可能是**结果组子节点**，
  // 它的父不在 nodes 表，直接查会把 local 坐标当世界坐标——面板飞到画布左上角
  // （M6-25：组内子结果成为可交互节点后，创作面板能力随之打通，§6.9）。
  const rect = toWorldRectInGraph(selectedNode, graph)
  // world → screen：屏幕 = (世界 - 视口平移) × zoom（与 CanvasSurface 的 transform 互逆）
  const screenX = (rect.x + rect.w / 2 - viewport.x) * viewport.zoom
  const screenY = (rect.y + rect.h - viewport.y) * viewport.zoom + PANEL_GAP

  return (
    <div
      className="panel-anchor"
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
      data-panel-anchor={selectedNode.id}
    >
      <CreationPanel
        data={selectedNode.data as GenerationData}
        model={buildPanelModel(selectedNode, graph)}
        running={running}
        globalRunning={exec.isRunning && !running}
        error={error}
        onEvent={(ev) =>
          handlePanelEvent(
            ev,
            selectedNode,
            store,
            exec,
            promptTools,
            onOpenSettings,
            (channelId, model, params) => {
              void channels.rememberRecipe(channelId, model, params)
            },
          )
        }
        onClose={() => store.setSelection([])}
        mode={selectedNode.type === 'prompt' ? 'prompt' : 'generation'}
        // 功能类别切换只给生成节点（§6.8）：分组 / 批量共用同一面板，但类别由内容决定
        showCategoryToggle={selectedNode.type === 'generation'}
        isBatch={selectedNode.type === 'batch'}
        promptTools={promptTools}
        onOpenSkills={onOpenSkills}
        promptImageCount={promptImageInputs.length}
      />
    </div>
  )
}

/** 组装面板数据：缩略图来源按节点类型分流（§6.8 / §6.11 / §6.12） */
function buildPanelModel(node: NodeSnapshot, graph: ReturnType<typeof useGraph>): PanelModel {
  const index = indexNodes(graph.nodes)
  const data = node.data as GenerationData

  if (node.type === 'group') {
    const g = node.data as GroupData
    const hidden = new Set(g.hiddenIds ?? [])
    const hiddenPrompts = new Set(g.hiddenPromptIds ?? [])
    const thumbs: PanelThumb[] = []
    const collections: PanelModel['collections'] = []
    // 组内素材 / 提示词（顺序即 childIds，面板拖动排序靠它生效）
    for (const id of childIdsOf(node as NodeSnapshot<GroupData>, graph)) {
      const child = index.get(id)
      if (!child) continue
      if (child.type === 'prompt') {
        thumbs.push({
          owner: 'self',
          id: child.id,
          text: (child.data as { text: string }).text,
          visible: !hiddenPrompts.has(child.id),
        })
        continue
      }
      const hash = (child.data as Partial<GenerationData>).assetHash
      if (hash) thumbs.push({ owner: 'self', id: child.id, assetHash: hash, visible: !hidden.has(child.id) })
    }
    // 分组自身的上游缩略图（§6.11「同时显示分组自身的上游缩略图与组内素材缩略图」）；
    // 上游若是批量节点则折叠成集合卡
    const upstreamHidden = new Set(data.upstreamHidden ?? [])
    for (const id of directUpstream(node.id, graph.edges)) {
      const up = index.get(id)
      if (!up) continue
      if (up.type === 'batch') {
        const b = up.data as BatchData
        collections.push({
          id: up.id,
          count: batchItemsOf(up as NodeSnapshot<BatchData>, graph).length,
          kind: b.contentType ?? 'media',
          visible: !upstreamHidden.has(up.id),
        })
        continue
      }
      const hash = (up.data as Partial<GenerationData>).assetHash
      if (hash) thumbs.push({ owner: 'upstream', id: up.id, assetHash: hash, visible: !upstreamHidden.has(up.id) })
    }
    const promptChildren = childIdsOf(node as NodeSnapshot<GroupData>, graph)
      .map((id) => index.get(id))
      .filter((n): n is NodeSnapshot => n?.type === 'prompt')
    return {
      thumbs,
      collections,
      emptyHint: '拖入提示词或生成结果，作为本次生成的输入',
      prompt: data.prompt,
      linkedPromptCount: promptChildren.filter((n) => !hiddenPrompts.has(n.id)).length,
      promptToggle:
        promptChildren.length > 0
          ? {
              visible: promptChildren.some((n) => !hiddenPrompts.has(n.id)),
              title: '组内提示词是否参与本次生成',
            }
          : null,
    }
  }

  if (node.type === 'batch') {
    const b = node.data as BatchData
    const hidden = new Set(b.hiddenIds ?? [])
    const thumbs: PanelThumb[] = []
    for (const id of childIdsOf(node as NodeSnapshot<BatchData>, graph)) {
      const child = index.get(id)
      if (!child) continue
      if (child.type === 'prompt') {
        thumbs.push({
          owner: 'self',
          id: child.id,
          text: (child.data as { text: string }).text,
          visible: !hidden.has(child.id),
        })
        continue
      }
      const hash = (child.data as Partial<GenerationData>).assetHash
      if (hash) thumbs.push({ owner: 'self', id: child.id, assetHash: hash, visible: !hidden.has(child.id) })
    }
    return {
      thumbs,
      collections: [],
      emptyHint: b.contentType === 'prompt' ? '拖入提示词节点，批量文生图' : '拖入图片 / 视频素材，批量套图',
      prompt: data.prompt,
      linkedPromptCount: 0,
      promptToggle: null,
    }
  }

  // 生成 / 提示词节点：上游素材。批量上游折叠为集合卡（§6.12「作为上游：集合卡」）
  const upstreamHidden = new Set(data.upstreamHidden ?? [])
  const thumbs: PanelThumb[] = []
  const collections: PanelModel['collections'] = []
  /**
   * 上游提示词节点数量（§6.7 / §6.8 第二部分「上游已链接提示词节点 {n}」）。
   *
   * 此前恒为 0——于是这个胶囊在生成 / 提示词节点上**从来没出现过**，而它正是
   * 「提示词节点的内容不会自动带进下游」这件事唯一的界面说明。被隐藏的节点
   * （小眼睛关掉）不计入：它不参与本次生成。
   */
  let linkedPromptCount = 0
  for (const id of directUpstream(node.id, graph.edges)) {
    const up = index.get(id)
    if (!up) continue
    if (up.type === 'prompt') {
      if (!upstreamHidden.has(up.id)) linkedPromptCount += 1
      continue
    }
    if (up.type === 'batch') {
      const b = up.data as BatchData
      collections.push({
        id: up.id,
        /**
         * 集合数量 = 内部素材 **+ 外部连线的素材**。
         *
         * 与执行侧 `batchSpec.collectInputs` 同一口径：外部素材也会逐张展开。
         * 此前只数内部，于是「批量节点是空的、两张素材从外面连进来」时卡上显示 0
         * ——面板看起来「没有素材输入」，而实际会跑 2 次。卡片数字与实际行为对不上，
         * 比没有卡片更误导。
         */
        count:
          batchItemsOf(up as NodeSnapshot<BatchData>, graph).length +
          externalInputsOf(up as NodeSnapshot<BatchData>, graph).filter((i) => i.kind === 'asset')
            .length,
        kind: b.contentType ?? 'media',
        visible: !upstreamHidden.has(up.id),
      })
      continue
    }
    const hash = (up.data as Partial<GenerationData>).assetHash
    if (hash) {
      /*
       * 上游缩略图现在**可删**（用户 2026-09-21）：删除动作是「删掉那条连线」，
       * 上游节点本身不动。故这里必须把连线 id 一起带给面板——
       * 视图层不读图（架构 §4.7），查边的活由模型层做。
       */
      thumbs.push({
        owner: 'upstream',
        id: up.id,
        assetHash: hash,
        visible: !upstreamHidden.has(up.id),
        removable: true,
        edgeId: graph.edges.find((e) => e.source === up.id && e.target === node.id)?.id,
      })
    }
  }
  if (data.assetHash) {
    /*
     * 节点自身内容：删除动作是**清空本节点的素材**，节点回到「没上传图片」状态。
     *
     * 提示词节点此处只会是历史遗留素材，不给删除入口以免误伤正文语义
     * （它的正文才是内容，素材不是）。
     */
    thumbs.unshift({
      owner: 'self',
      id: node.id,
      assetHash: data.assetHash,
      visible: true,
      removable: node.type === 'generation',
    })
  }
  return {
    thumbs,
    collections,
    emptyHint: '连线上游节点，或拖入素材',
    // 提示词节点的面板绑定**草稿**（§6.7「面板 = 工作区」），生成类节点仍是 prompt
    prompt: node.type === 'prompt' ? ((node.data as PromptData).draft ?? '') : data.prompt,
    linkedPromptCount,
    promptToggle: null,
  }
}

/** 面板事件 → 命令 / 执行（架构 §4.7 ①：面板只能 emit，由这里翻译） */
function handlePanelEvent(
  event: PanelEvent,
  node: NodeSnapshot,
  store: ReturnType<typeof useCanvasStore>,
  exec: ReturnType<typeof useCanvasExecution>,
  promptTools: ReturnType<typeof usePromptTools>,
  /** 宿主导航：由页面容器注入，工作台层不认识路由（见 panelModel.PanelEvent） */
  onOpenSettings?: () => void,
  /** 记录配方（用户 2026-09-23：改了参数就记，不等生成成功） */
  rememberRecipe?: (channelId: string, model: string, params: Record<string, unknown>) => void,
): void {
  const patch = (p: Partial<GenerationData>) =>
    store.dispatch({ kind: 'node.updateData', id: node.id, patch: p as Record<string, unknown>, transient: true })

  /**
   * 参数变更后记配方（用户 2026-09-23）。
   *
   * 关键：**用 `patch` 合并后的结果**去记，而不是只记这次改的那一项——
   * 用户要的是「这一套参数」，不是「最后一次动的那一格」。
   * 例如先选 16:9、再选 2张，配方里必须同时留着比例和张数。
   *
   * 只有渠道与模型都有值时才记（`rememberRecipe` 内部也挡了一道）：
   * 半份配方（有渠道没模型）会让下一个节点落在一个跑不起来的组合上。
   */
  const remember = (eventType: string, recipe?: RecipeSnapshot) => {
    if (!rememberRecipe || !recipe) return
    /**
     * 名单守卫：只有「配方跟踪字段」的变更才落库。
     *
     * 这一道不是多余的——`remember` 是**通用**的，将来有人在别的分支（比如改提示词）
     * 顺手调它，配方就会被内容污染。`isRecipeEdit` 把「哪些算参数」这条产品规则
     * 收在 domain 层，加了新参数只改那一处；配套单测钉住每一档。
     */
    if (!isRecipeEdit(eventType)) return
    /**
     * 配方**整份由面板带过来**（`event.recipe`），本层不再从节点 data 上现取。
     *
     * 实测教训（2026-09-23）：原先从节点上取渠道与模型，而节点为空、只有面板兜底
     * 显示着它们时，取到的永远是空 ⇒ 改了参数一条配方都记不上 ⇒ 表现为
     * 「改了参数，再新建还是原来的默认值」。面板才是知道「眼前这套是什么」的那一方。
     *
     * 仍要挡「有渠道没模型」这种半份配方：下一个节点落在一个跑不起来的组合上，
     * 比不带默认值更糟。
     */
    const { channelId, model, params } = recipe
    if (!channelId || !model) return
    rememberRecipe(channelId, model, params)
  }

  switch (event.type) {
    case 'setPrompt':
      // 提示词节点写的是**草稿**（§6.7「面板 = 工作区」，面板文字与节点正文解耦），
      // 其余节点是 prompt
      if (node.type === 'prompt') patch({ draft: event.text } as Partial<GenerationData>)
      else patch({ prompt: event.text })
      break
    case 'setChannel':
      // 换渠道后模型缓存变了，清空模型避免脏值
      patch({ channelId: event.channelId, model: '' })
      break
    case 'setModel':
      patch({ model: event.model })
      remember(event.type, event.recipe)
      break
    case 'setRatio':
      patch({ ratio: event.ratio })
      remember(event.type, event.recipe)
      break
    case 'setResolution':
      patch({ resolution: event.resolution as GenerationData['resolution'] })
      remember(event.type, event.recipe)
      break
    case 'setQuality':
      patch({ quality: event.quality as GenerationData['quality'] })
      remember(event.type, event.recipe)
      break
    case 'setCount':
      patch({ count: event.count })
      remember(event.type, event.recipe)
      break
    case 'setMode':
      // 切换功能类别：模型不属于新类别时一并清空（面板已判好，见 PanelEvent.setMode）
      patch(event.keepModel ? { mode: event.mode } : { mode: event.mode, model: '' })
      // 切类别时若清了模型，这次不进配方（半份配方没意义）；保留模型才记
      if (event.keepModel) remember(event.type, event.recipe)
      break
    case 'setSize':
      patch({ size: event.size })
      remember(event.type, event.recipe)
      break
    case 'setDurationSec':
      // 越界在领域层夹回（clampDuration，§6.8「滑块 3 – 15 秒」）
      patch({ durationSec: clampDuration(event.sec) })
      remember(event.type, event.recipe)
      break
    case 'setRefMode':
      patch({ refMode: event.refMode })
      remember(event.type, event.recipe)
      break
    case 'toggleThumb':
      toggleThumb(event.owner, event.id, node, store)
      break
    case 'toggleCollection':
      toggleThumb('upstream', event.id, node, store)
      break
    case 'removeOwnAsset':
      // 删除节点自身内容（§6.6）：清掉 hash，节点回到空态（本体露出占位框 + `+`）。
      // 媒体本体留在 assets 表不动——它是内容寻址的，别的节点可能还引用同一张图。
      store.dispatch({
        kind: 'node.updateData',
        id: node.id,
        patch: { assetHash: undefined },
        transient: false,
      })
      break
    /**
     * 删除某一张缩略图（用户 2026-09-21）。
     *
     * 两种语义按 `owner` 分流：
     * - `self` → 清空本节点的素材，回到「没上传图片」状态；
     * - `upstream` → 删掉那条**连线**（上游节点与其素材都保留）。
     *
     * ⚠️ 上游那条必须走 `edge.remove` 而不是改上游节点的数据：
     * 上游的图**不属于本节点**，改它等于越权删别人的内容。
     * 用户要的是「这条上游素材不再进来」，那就是删连线。
     */
    case 'removeThumb': {
      if (event.owner === 'self') {
        store.dispatch({
          kind: 'node.updateData',
          id: node.id,
          patch: { assetHash: undefined },
          transient: false,
        })
        break
      }
      const edge = store.getSnapshot().edges.find((e) => e.source === event.id && e.target === node.id)
      if (!edge) break
      store.dispatch({ kind: 'edge.remove', id: edge.id })
      store.showUndoBar('已移除上游素材')
      break
    }
    case 'togglePrompt':
      toggleGroupPrompt(node, store)
      break
    case 'reorderThumbs':
      reorderThumbs(event.owner, event.order, node, store)
      break
    case 'optimize':
      // 面板的工具只作用于草稿（§6.7），结果经 onResult 写回 draft
      promptTools.run((node.data as PromptData).draft ?? '', 'optimize')
      break
    case 'translate':
      promptTools.run((node.data as PromptData).draft ?? '', 'translate')
      break
    case 'applyDraft':
      applyDraft(node, store)
      break
    case 'run':
      void exec.runNode(node.id)
      break
    case 'cancel':
      exec.cancel()
      break
    case 'close':
      store.setSelection([])
      break
    case 'openSettings':
      // 不派发任何命令：这是导航，交回页面容器处理
      onOpenSettings?.()
      break
  }
}

/** 小眼睛：只改隐藏集合（§6.11 / §6.12），隐藏项不参与本次生成 */
function toggleThumb(
  owner: PanelThumb['owner'],
  id: string,
  node: NodeSnapshot,
  store: ReturnType<typeof useCanvasStore>,
): void {
  const data = node.data as Partial<GroupData & BatchData & GenerationData>
  const key = owner === 'upstream' ? 'upstreamHidden' : node.type === 'group' ? 'hiddenIds' : 'hiddenIds'
  const current = new Set((data[key as keyof typeof data] as string[] | undefined) ?? [])
  if (current.has(id)) current.delete(id)
  else current.add(id)
  store.dispatch({
    kind: 'node.updateData',
    id: node.id,
    patch: { [key]: [...current] },
    transient: true,
  })
}

/** 组内提示词整体开关（§6.11「用于隐藏该提示词是否参与本次生成」） */
function toggleGroupPrompt(node: NodeSnapshot, store: ReturnType<typeof useCanvasStore>): void {
  const data = node.data as GroupData
  const all = new Set(childIdsOf(node as NodeSnapshot<GroupData>, store.getSnapshot()))
  const promptIds = [...all].filter((id) => {
    const n = store.getSnapshot().nodes.find((x) => x.id === id)
    return n?.type === 'prompt'
  })
  const hidden = new Set(data.hiddenPromptIds ?? [])
  const anyVisible = promptIds.some((id) => !hidden.has(id))
  store.dispatch({
    kind: 'node.updateData',
    id: node.id,
    patch: { hiddenPromptIds: anyVisible ? promptIds : [] },
    transient: true,
  })
}

/**
 * 草稿 → 正文（§6.7「写入节点」）：面板草稿经用户显式确认才成为最终提示词。
 *
 * - `transient:false`：进撤销栈——写入是一个明确的创作决策，要能反悔；
 * - 草稿与正文相同（或草稿为空）时**不派发**：空跑一次撤销记录只会让人疑惑
 *   「我撤掉了什么」；
 * - 写入后草稿**保留**：继续改草稿、再写入是常见节奏，清空反而丢工作区。
 */
function applyDraft(node: NodeSnapshot, store: ReturnType<typeof useCanvasStore>): void {
  if (node.type !== 'prompt') return
  const data = node.data as PromptData
  const draft = data.draft ?? ''
  if (!draft.trim() || draft === data.text) return
  store.dispatch({
    kind: 'node.updateData',
    id: node.id,
    patch: { text: draft },
    transient: false,
  })
}

/** 面板内拖动缩略图排序（§6.11 / §6.12「缩略图排序与节点顺序双向同步」）。
 * 容器内部素材改 childIds（`container.reorder`）；上游缩略图改 `upstreamHidden` 的展示顺序
 * ——上游顺序由连线顺序决定，M3 只同步容器内部排序（外部上游顺序调整留待后续）。
 */
function reorderThumbs(
  owner: PanelThumb['owner'],
  order: string[],
  node: NodeSnapshot,
  store: ReturnType<typeof useCanvasStore>,
): void {
  if (owner !== 'self') return
  if (node.type !== 'group' && node.type !== 'batch') return
  // order 只含被展示的缩略图；容器 childIds 里可能还有未出现在面板的项，追加在尾部
  const current = childIdsOf(node as NodeSnapshot<GroupData>, store.getSnapshot())
  const ordered = new Set(order)
  const merged = [...order, ...current.filter((id) => !ordered.has(id))]
  store.dispatch({ kind: 'container.reorder', containerId: node.id, orderedChildIds: merged })
}
