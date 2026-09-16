import { useSyncExternalStore, useState } from 'react'
import { clampDuration, type ModelCapability } from '../../../domain/shared/capability'
import type { GenerationData } from '../../../domain/canvas/model/node'
import type { PanelCollection, PanelModel, PanelThumb } from './panelModel'
import { moveInOrder } from './panelModel'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { useAsset } from '../hooks/useAsset'
import type { PromptToolAction } from '../../../features/shared/promptTools/promptTools'
import { ParamPicker } from './ParamPicker'
import styles from './CreationPanel.module.css'

/** 生成数量：固定四项（§6.8「1张 / 2张 / 4张 / 9张，固定四项」） */
export const COUNT_OPTIONS = [1, 2, 4, 9] as const
/**
 * 比例档位：**九档**（§6.8）。
 *
 * 这是「模型没上报 `aspectRatios`」时的兜底集，也是 `openai-images` 协议的默认能力表
 * （多数中转的 `/v1/models` 不报比例，用户就只能看到这一套）——早先只有 1:1 / 3:2 / 2:3
 * 三档，用香蕉这类实际支持到 21:9 的模型时明显不够选。
 *
 * 排序按「方 → 横 → 竖」成对排列，竖版列表里同类相邻，不用在长列表里来回找。
 * 模型**上报了** `aspectRatios` 时仍以模型为准（能力驱动，UI 不写死）。
 */
export const RATIO_OPTIONS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21'] as const
/**
 * 画质档位（§6.8）。
 *
 * 首项「自动」= **不向渠道指定画质**（与「质量」chip 同一口径）。
 * 此前只有 1K/2K/4K 三档、没有「自动」，于是未设置时 chip 只能拿字段名「画质」
 * 当占位——用户分不清这是档位名还是「没选」。补上它之后与 `quality` 完全一致：
 * 未设置即显示「自动」，语义是「交给模型决定」。
 */
const RESOLUTION_OPTIONS: { value: 'auto' | '1k' | '2k' | '4k'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]
const QUALITY_OPTIONS: { value: 'auto' | 'low' | 'medium' | 'high'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]
/** 视频尺寸档位（§6.8）：自动 / 480p / 720p / 1080p */
const SIZE_OPTIONS: { value: 'auto' | '480p' | '720p' | '1080p'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
]
/** 视频参考模式（§6.8）：首尾帧 / 全能参考，二选一 */
const REF_MODE_OPTIONS: { value: 'first-last-frame' | 'all-purpose'; label: string }[] = [
  { value: 'first-last-frame', label: '首尾帧' },
  { value: 'all-purpose', label: '全能参考' },
]
/**
 * 功能类别（§6.8「右上角为图片 / 视频功能类别切换」）。
 *
 * 视频**不是另一种节点**，而是同一个生成节点的 `data.mode`——模板「图生视频」
 * 创建的就是 `{ type: 'generation', data: { mode: 'video' } }`。参数集随它切换。
 */
const CATEGORY_OPTIONS: { value: 'image' | 'video'; label: string }[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]
/** 视频时长滑块边界（模型未声明时，§6.8「滑块 3 – 15 秒」） */
const DEFAULT_DURATION = 5

/** 提示词节点的 LLM 工具状态（由 PanelLayer 持有 usePromptTools 并下传，§6.7） */
export interface PanelPromptTools {
  status: 'idle' | 'running' | 'error'
  error: string | null
  run: (text: string, action: PromptToolAction) => void
}

/**
 * 比例候选（§6.8「按 `aspectRatios` 推导」）：模型上报了就用模型的，没上报用九档兜底。
 *
 * 抽成纯函数是为了能直接测——「模型什么都没报时用户到底看到几档」这件事，
 * 光靠看面板渲染结果（SSR 下浮层是收起的）根本断言不了。
 */
/**
 * 画质候选档位（§6.8）：模型上报了就用模型的，没上报用「自动 + 1K/2K/4K」全套。
 *
 * 与 `ratiosOf` 同一条道理——抽成纯函数是为了**能在函数层断言「没上报时看到几档」**；
 * SSR 下浮层是收起的，看渲染结果根本断言不了选项表。
 *
 * 「自动」**永远保留**：它不是某个画质档位，而是「不指定」这个选项本身——
 * 模型上报的 `resolutions` 只说明它认哪些档位，没理由把「不指定」也一起藏掉。
 */
export function resolutionsOf(cap?: ModelCapability): string[] {
  const declared = cap?.resolutions
  if (!declared?.length) return RESOLUTION_OPTIONS.map((r) => r.value)
  return RESOLUTION_OPTIONS.filter((r) => r.value === 'auto' || declared.includes(r.value)).map(
    (r) => r.value,
  )
}

export function ratiosOf(cap?: ModelCapability): string[] {
  return cap?.aspectRatios?.length ? [...cap.aspectRatios] : [...RATIO_OPTIONS]
}

export interface CreationPanelProps {
  /** 节点数据（提供渠道 / 模型 / 参数当前值） */
  data: GenerationData
  model: PanelModel
  running: boolean
  globalRunning: boolean
  error: string | null
  onEvent: (event: import('./panelModel').PanelEvent) => void
  /** 关闭面板（点面板外 / Esc） */
  onClose: () => void
  /** 面板形态：generation（默认，§6.8）| prompt（提示词节点，§6.7） */
  mode?: 'generation' | 'prompt'
  /** prompt 模式下的优化 / 翻译工具（缺省则不显示按钮） */
  promptTools?: PanelPromptTools | null
  /**
   * 选中提示词节点的**上游图片数量**（§6.7 反推）。
   *
   * 面板是纯视图、不读图，数量由装配层算好注入；反推按钮据此决定能不能点，
   * 而不是去猜「大概有图吧」——猜错的代价是用户点了没反应。
   */
  promptImageCount?: number
  /**
   * 是否显示「图片 / 视频」功能类别切换（§6.8）。
   *
   * 只有**生成节点**显示：分组 / 批量共用本面板（§6.11 / §6.12「与生成节点完全一致」），
   * 但它们的类别由内容决定，不提供手动切换。由装配层按节点类型注入。
   */
  showCategoryToggle?: boolean
}

/**
 * 创作参数面板（产品文档 §6.8 / §6.11 / §6.12）。
 *
 * 三部分（§6.8）：①上游/内部素材缩略图 ②提示词 ③参数与生成。
 * 分组与批量共用本组件（文档要求「与生成节点完全一致」/「结构一致」），
 * 差异通过 PanelModel 注入的缩略图来源体现。
 *
 * 视觉：无投影，1px 描边 + 背景明度区分层次（§3「画布工作区浮层」）；
 * 宽度约 840px、高度自适应；缩放画布时面板尺寸不变（由调用方用 screen 层定位保证）。
 */
export function CreationPanel(props: CreationPanelProps) {
  const { data, model, onEvent } = props
  const channels = useChannels()
  const enabled = channels.enabledChannels()
  // 订阅「全量渠道」：设置页改完（新增 / 启用）立刻反映到面板——渠道是应用级单例，
  // 不需要重挂页面。`enabled` 是派生值，每次渲染按最新 state 重算。
  const allChannels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  /**
   * 当前展开的参数浮层（§6.8「同一时刻只允许一个面板打开，开新关旧」）。
   *
   * 唯一性由**这一个 key** 保证，而不是每个 chip 各自持一个 boolean——
   * 那样必然能同时开出两个浮层，再靠互相通知去关，是自找的竞态。
   */
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const closePicker = () => setOpenPicker(null)
  const togglePicker = (key: string) => setOpenPicker((cur) => (cur === key ? null : key))
  const promptMode = props.mode === 'prompt'
  const tools = promptMode ? (props.promptTools ?? null) : null
  /** 视频是生成节点的功能类别（`data.mode`），参数集与图片模式不同（§6.8） */
  const videoMode = !promptMode && data.mode === 'video'
  /**
   * 第一部分是否为空（§6.8）。
   *
   * 抽出来是因为首行要按它决定「空态框出不出来」——空态框与「图片 / 视频」
   * 功能类别切换**共用一行**（空态框在左、类别切换在右、二者等高），
   * 而这一行本身在「既不空、又没有类别切换」时整体不该渲染。
   */
  const assetsEmpty = model.thumbs.length === 0 && model.collections.length === 0

  const activeChannel = enabled.find((c) => c.id === data.channelId)
  const channelModels: ModelCapability[] = activeChannel?.models ?? []
  /**
   * prompt 模式只能选文本 LLM（§6.7「只能选 LLM 模型」）；生成节点按**功能类别**
   * 过滤（图片 / 视频两套模型，§6.8）。都从 `models`（用户勾选的）里取，
   * 不是 `modelCache`（拉回来的全部）——§7.4。
   */
  const wantedCategory = promptMode ? 'chat' : videoMode ? 'video' : 'image'
  const models: ModelCapability[] = channelModels.filter((m) => m.category === wantedCategory)
  const activeModel = models.find((m) => m.id === data.model)
  /** 类别名：写进占位文案与空态提示，让「没模型」这件事说得出是**哪一类**没有 */
  const categoryLabel = promptMode ? '文本模型' : videoMode ? '视频模型' : '生图模型'
  /**
   * 生成数量上限：**只在模型显式声明 `maxCount` 时才生效**。
   *
   * 早先写的是 `Math.max(1, activeModel?.maxCount ?? 1)`——`?? 1` 把两种完全不同的
   * 情况都判成了「最多 1 张」：
   *   1) 还没选模型（`activeModel` 为空）；
   *   2) 模型没上报 `maxCount`（多数中转渠道的 /v1/models 不报这个字段）。
   * 结果是 2张/4张/9张 三个胶囊一进面板就整排置灰、提示「当前模型最多 1 张」——
   * 而此刻根本没有「当前模型」。真机探针实测到的就是这个（§6.8「固定四项」被压成一项）。
   *
   * 语义修正：未声明 = 不知道上限 = 不设限，上限取最大的那个档位；
   * 只有模型明确报出更小的上限时才置灰它够不到的档位。
   */
  const declaredMax = activeModel?.maxCount
  const maxCount =
    typeof declaredMax === 'number' && declaredMax > 0
      ? Math.max(1, declaredMax)
      : COUNT_OPTIONS[COUNT_OPTIONS.length - 1]
  const count = Math.max(1, Math.min(data.count ?? 1, maxCount))

  // 模型不支持的档位直接隐藏（§6.8「参数项随模型能力动态渲染」）
  const ratios = ratiosOf(activeModel)
  const resolutions = resolutionsOf(activeModel)

  // 视频参数（§6.8 视频模式）：尺寸 / 时长 / 首尾帧·全能参考
  const sizeLabel = SIZE_OPTIONS.find((s) => s.value === (data.size ?? 'auto'))?.label ?? '尺寸'
  const [minSec, maxSec] = activeModel?.durations ?? [3, 15]
  const duration = clampDuration(data.durationSec ?? DEFAULT_DURATION, activeModel)
  const refMode = data.refMode ?? 'first-last-frame'
  const refModeLabel = REF_MODE_OPTIONS.find((r) => r.value === refMode)?.label ?? '参考模式'
  /**
   * 参考模式是否展示：模型**显式声明**没有参考图时才隐藏，未声明不隐藏——
   * 与数量上限同一条道理（§6.8「未声明」不等于「不支持」）。
   */
  const showRefMode = !activeModel || (activeModel.maxReferenceImages ?? 0) > 0
  /** 切换功能类别时，当前模型是否属于目标类别；不属于就得清掉（否则会把图片模型发给视频渠道） */
  const modelBelongsTo = (m: 'image' | 'video') =>
    !!data.model && channelModels.some((x) => x.id === data.model && x.category === m)

  /**
   * 全局运行中**不再**禁用本节点的生成按钮（用户报「一个节点生成时其他节点无法生成」）。
   *
   * 并发槽位已经在执行宿主侧打开（多条 plan 各自持有 controller 与适配器表），
   * 界面必须同步放开——否则用户看到按钮灰着，以为功能没修好。
   * `globalRunning` 仍保留给「本节点未参与但全局有运行」的状态展示（如全局转圈），
   * 它不再是**禁用**理由。
   */
  const busyGlobal = false
  /**
   * 生成按钮文案（§6.7 / §6.8）。
   *
   * 提示词节点**自己不发请求**——执行计划里写死了「提示词节点自己不能发请求：它的语义是
   * 让下游生成节点出图」。所以面板上这个按钮点下去是**触发下游生成**，文案必须说清这一点，
   * 否则用户按了半天看到下游在动，会以为按了个寂寞（同「假成功」那一类）。
   */
  const runLabel = props.running
    ? '取消当前生成'
    : busyGlobal
      ? '全局工作流运行中'
      : promptMode
        ? '生成下游节点'
        : '生成当前节点'

  // 无可用平台时给出**可点击的**解释：空下拉本身不说明「为什么空」，用户只会觉得点了没反应。
  // 区分「一个渠道都没建」与「建了但没启用」——后者最容易被误以为已经配好了。
  const noPlatform = enabled.length === 0
  const platformGap = allChannels.length === 0 ? '还没有配置任何渠道' : '已配置的渠道都未启用'
  /**
   * 选了平台但这个分类下一个模型都没有：与「没有平台」是两回事，得说清是**没勾选**（§7.4）。
   * 上游拉回的模型现在默认全不勾选，所以这是最可能撞上的空态。
   * 文案带上**类别**：视频模式下说「还没勾选视频模型」比笼统的「没勾选模型」有用得多
   * （渠道里可能明明有生图模型）。
   *
   * **提示词节点不走这条**（§6.7）：它要求的是「模型 chip **禁用**并显示『暂无可用文本模型』」，
   * 而不是「隐藏 chip + 给一条引导条」——换个藏法，用户反而不知道这个字段还在。
   */
  const noModel = !promptMode && !noPlatform && !!activeChannel && models.length === 0
  const noModelHint = videoMode ? '该渠道还没勾选视频模型' : '该渠道还没勾选模型'

  return (
    <div
      className={styles.panel}
      data-creation-panel
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Esc 先关参数浮层，浮层没了才关整个面板——否则想收起一个下拉，
        // 结果把面板也一起关掉了（§6.8「参数面板内 Esc → 关闭当前参数选择面板」）。
        if (openPicker) setOpenPicker(null)
        else props.onClose()
      }}
    >
      {/* 第一部分：素材缩略图（分组 = 上游 + 组内；批量 = 内部素材） */}
      <section className={styles.section} data-panel-part="assets">
      {/*
        首行：素材条在左、「图片 / 视频」功能类别切换在右，同一行且等高（30px）。

        - 空态：左边是「拖入素材」虚线空态框（吃掉剩余宽度）；
        - 有素材：左边是缩略图条——此前缩略图是 64×64 的卡片独占一行，块头比切换大一倍；
          现缩到与切换同高（30px 方块），并排进首行，切换仍贴最右端。
          缩略图条允许换行（素材多时首行自然长高，切换垂直居中）。
      */}
      <div className={styles.assetsHead} data-panel-assets-head>
        {assetsEmpty ? (
          <div className={styles.assetEmpty} data-panel-asset-empty>
            {model.emptyHint}
          </div>
        ) : (
          <div className={styles.thumbs}>
            {model.collections.map((c) => (
              <CollectionCard
                key={`collection:${c.id}`}
                collection={c}
                onToggle={() => onEvent({ type: 'toggleCollection', id: c.id })}
              />
            ))}
            {model.thumbs.map((t, i) => (
              <Thumb
                key={`${t.owner}:${t.id}`}
                thumb={t}
                index={i}
                dragging={dragIndex === i}
                onDragStart={() => setDragIndex(i)}
                onDrop={() => {
                  if (dragIndex === null) return
                  const order = moveInOrder(model.thumbs, dragIndex, i).map((x) => x.id)
                  setDragIndex(null)
                  onEvent({ type: 'reorderThumbs', owner: t.owner, order })
                }}
                onToggle={() => onEvent({ type: 'toggleThumb', owner: t.owner, id: t.id })}
                onRemove={t.removable ? () => onEvent({ type: 'removeOwnAsset' }) : undefined}
              />
            ))}
          </div>
        )}
        {props.showCategoryToggle && (
          <div className={styles.category} role="group" aria-label="功能类别">
            {CATEGORY_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={
                  data.mode === c.value ? `${styles.catBtn} ${styles.catOn}` : styles.catBtn
                }
                data-param-mode={c.value}
                aria-pressed={data.mode === c.value}
                title={`切换为${c.label}生成`}
                onClick={() => {
                  if (data.mode === c.value) return
                  // 模型不属于新类别就清空：留着只会把图片模型发给视频渠道
                  onEvent({ type: 'setMode', mode: c.value, keepModel: modelBelongsTo(c.value) })
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      </section>

      {/* 第二部分：提示词 */}
      <section className={styles.section} data-panel-part="prompt">
        <div className={styles.promptRow}>
          {model.linkedPromptCount > 0 && (
            <span className={styles.linked} data-panel-linked-prompt>
              上游已链接提示词节点 {model.linkedPromptCount}
            </span>
          )}
          <textarea
            className={styles.prompt}
            value={model.prompt}
            placeholder={promptMode ? '起草 / 反推提示词的工作区，确认后「写入节点」' : '输入提示词，或连线上游提示词节点'}
            onChange={(e) => onEvent({ type: 'setPrompt', text: e.target.value })}
          />
          {model.promptToggle && (
            <button
              type="button"
              className={
                model.promptToggle.visible ? styles.eyeBtn : `${styles.eyeBtn} ${styles.eyeOff}`
              }
              title={model.promptToggle.title}
              aria-label={model.promptToggle.title}
              aria-pressed={model.promptToggle.visible}
              onClick={() => onEvent({ type: 'togglePrompt' })}
            >
              {model.promptToggle.visible ? '👁' : '⃠'}
            </button>
          )}
        </div>
        {promptMode && (
          // 底部行（§6.7）：左字数，右「优化 / 翻译」——与节点本体同一套 LLM 行为
          <div className={styles.toolRow} data-panel-prompt-tools>
            <span className={styles.toolCount} data-panel-prompt-count>
              {model.prompt.length} 字
            </span>
            {tools && (
              <span className={styles.toolGroup}>
                <button
                  type="button"
                  className={styles.toolBtn}
                  disabled={tools.status === 'running' || model.prompt.trim().length === 0}
                  title={tools.error ?? '用文本模型优化此提示词'}
                  onClick={() => tools.run(model.prompt, 'optimize')}
                >
                  优化
                </button>
                <button
                  type="button"
                  className={styles.toolBtn}
                  disabled={tools.status === 'running' || model.prompt.trim().length === 0}
                  title={tools.error ?? '中文 ⇄ 英文互译'}
                  onClick={() => tools.run(model.prompt, 'translate')}
                >
                  翻译
                </button>
                {/* 反推（§6.7）：输入是**上游图片**而非文本，故禁用条件与其它两个相反——
                    有图就能点（哪怕一个字都没有），没图点了也是空跑。 */}
                <button
                  type="button"
                  className={styles.toolBtn}
                  data-panel-prompt-tool="describe"
                  disabled={tools.status === 'running' || (props.promptImageCount ?? 0) === 0}
                  title={
                    tools.error ??
                    ((props.promptImageCount ?? 0) > 0
                      ? `把上游 ${props.promptImageCount} 张图发给文本模型，反推出绘画提示词（覆盖当前文本）`
                      : '反推需要上游图片：先把一个已出图的生成节点连到本节点')
                  }
                  onClick={() => tools.run(model.prompt, 'describe')}
                >
                  反推
                </button>
                {/* 写入节点（§6.7）：草稿 → 正文的唯一通道。禁用条件与「反推」相反——
                    一个字都没有时写入没有意义；有字就允许（与正文相同也交给装配层去重）。 */}
                <button
                  type="button"
                  className={styles.toolBtn}
                  data-panel-prompt-apply
                  disabled={tools.status === 'running' || model.prompt.trim().length === 0}
                  title="把草稿写入节点正文（下游生成节点读的是正文，不是草稿）"
                  onClick={() => onEvent({ type: 'applyDraft' })}
                >
                  写入节点
                </button>
              </span>
            )}
          </div>
        )}
        {promptMode && tools?.error && (
          <div className={styles.toolError} data-panel-prompt-tool-error>
            {tools.error}
          </div>
        )}
      </section>

      {/* 第三部分：参数与生成 */}
      <section className={`${styles.section} ${styles.params}`} data-panel-part="params">
        {/* 无可用平台 → 引导去后台设置（独占一行，与错误提示同一排版位） */}
        {noPlatform && (
          <button
            type="button"
            className={styles.setupHint}
            data-panel-setup-hint={platformGap}
            onClick={() => onEvent({ type: 'openSettings' })}
          >
            <span>{platformGap}</span>
            <span className={styles.setupHintGo}>去后台设置 →</span>
          </button>
        )}
        {/* 平台选了、模型却是空的 → 指向设置页的「选择模型」，而不是留一个点开没内容的下拉 */}
        {noModel && (
          <button
            type="button"
            className={styles.setupHint}
            data-panel-setup-hint={noModelHint}
            onClick={() => onEvent({ type: 'openSettings' })}
          >
            <span>{noModelHint}</span>
            <span className={styles.setupHintGo}>去后台设置 →</span>
          </button>
        )}

        {/* §6.8「无可用平台 | 平台下拉换成引导按钮」：此时不再挂一个点开是空的平台 chip */}
        {!noPlatform && (
          <ParamPicker
            name="channel"
            ariaLabel="生成平台"
            label={activeChannel?.name ?? '平台'}
            options={enabled.map((c) => ({ value: c.id, label: c.name }))}
            value={data.channelId}
            variant="list"
            open={openPicker === 'channel'}
            onToggle={() => togglePicker('channel')}
            onClose={closePicker}
            onSelect={(v) => onEvent({ type: 'setChannel', channelId: v })}
          />
        )}

        {/*
          模型 chip：**提示词节点同样要选**（§6.7「只能选 LLM 模型」，优化 / 翻译要用），
          所以这里不能按 promptMode 收窄——只有「没得选」时才让位给引导条。
        */}
        {!noModel && (
          <ParamPicker
            name="model"
            ariaLabel={categoryLabel}
            label={
              activeModel?.id ??
              // §6.7：提示词节点在「渠道里没有文本模型」时禁用并直说，不玩隐藏
              (promptMode && activeChannel && models.length === 0 ? '暂无可用文本模型' : categoryLabel)
            }
            options={models.map((m) => ({ value: m.id, label: m.id }))}
            value={data.model}
            variant="list"
            open={openPicker === 'model'}
            onToggle={() => togglePicker('model')}
            onClose={closePicker}
            onSelect={(v) => onEvent({ type: 'setModel', model: v })}
            disabled={!activeChannel || models.length === 0}
          />
        )}

        {!promptMode && (
          <>
            {/* 比例：竖版列表选择器（§6.8） */}
            <ParamPicker
              name="ratio"
              ariaLabel="画面比例"
              label={data.ratio ?? '比例'}
              options={ratios.map((r) => ({ value: r, label: r }))}
              value={data.ratio ?? ''}
              variant="list"
              open={openPicker === 'ratio'}
              onToggle={() => togglePicker('ratio')}
              onClose={closePicker}
              onSelect={(v) => onEvent({ type: 'setRatio', ratio: v })}
            />
            {videoMode ? (
              <>
                {/* 尺寸：竖版列表（§6.8 视频模式） */}
                <ParamPicker
                  name="size"
                  ariaLabel="视频尺寸"
                  label={sizeLabel}
                  options={SIZE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                  value={data.size ?? 'auto'}
                  variant="list"
                  open={openPicker === 'size'}
                  onToggle={() => togglePicker('size')}
                  onClose={closePicker}
                  onSelect={(v) => onEvent({ type: 'setSize', size: v as NonNullable<GenerationData['size']> })}
                />
                {/* 时长：滑块 3–15 秒，支持直接键入数值（§6.8） */}
                <span className={styles.duration} data-param-duration>
                  <input
                    type="range"
                    className={styles.slider}
                    data-param-duration-range
                    aria-label="视频时长滑块"
                    min={minSec}
                    max={maxSec}
                    step={1}
                    value={duration}
                    onChange={(e) => onEvent({ type: 'setDurationSec', sec: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    className={styles.durationNum}
                    data-param-duration-input
                    aria-label="视频时长秒数"
                    min={minSec}
                    max={maxSec}
                    step={1}
                    value={duration}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      // 清空输入框时 Number('') === 0，直接夹回会把用户正在改的 8 变成 3
                      if (!Number.isFinite(n) || e.target.value.trim() === '') return
                      onEvent({ type: 'setDurationSec', sec: n })
                    }}
                  />
                  <span className={styles.durationUnit}>秒</span>
                </span>
                {showRefMode && (
                  <ParamPicker
                    name="refMode"
                    ariaLabel="参考模式"
                    label={refModeLabel}
                    options={REF_MODE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                    value={refMode}
                    variant="list"
                    open={openPicker === 'refMode'}
                    onToggle={() => togglePicker('refMode')}
                    onClose={closePicker}
                    onSelect={(v) =>
                      onEvent({ type: 'setRefMode', refMode: v as NonNullable<GenerationData['refMode']> })
                    }
                  />
                )}
              </>
            ) : (
              <>
                {/* 画质 / 质量：横排胶囊选择器（§6.8） */}
                <ParamPicker
                  name="resolution"
                  ariaLabel="画质"
                  label={
                    RESOLUTION_OPTIONS.find((r) => r.value === (data.resolution ?? 'auto'))?.label ??
                    '自动'
                  }
                  options={resolutions.map((v) => ({
                    value: v,
                    label: RESOLUTION_OPTIONS.find((r) => r.value === v)?.label ?? v,
                  }))}
                  value={data.resolution ?? 'auto'}
                  variant="pill"
                  open={openPicker === 'resolution'}
                  onToggle={() => togglePicker('resolution')}
                  onClose={closePicker}
                  onSelect={(v) => onEvent({ type: 'setResolution', resolution: v })}
                />
                <ParamPicker
                  name="quality"
                  ariaLabel="质量"
                  label={QUALITY_OPTIONS.find((q) => q.value === (data.quality ?? 'auto'))?.label ?? '质量'}
                  options={QUALITY_OPTIONS.map((q) => ({ value: q.value, label: q.label }))}
                  value={data.quality ?? 'auto'}
                  variant="pill"
                  open={openPicker === 'quality'}
                  onToggle={() => togglePicker('quality')}
                  onClose={closePicker}
                  onSelect={(v) => onEvent({ type: 'setQuality', quality: v })}
                />
                <span className={styles.countGroup} data-param-count>
                  {COUNT_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={c === count ? `${styles.countBtn} ${styles.countActive}` : styles.countBtn}
                      disabled={c > maxCount}
                      // 选中态只体现在 CSS module 哈希类名上，自动化读不到：补一个稳定锚点
                      data-active={c === count ? 'true' : 'false'}
                      title={c > maxCount ? `当前模型最多 ${maxCount} 张` : `${c} 张`}
                      onClick={() => onEvent({ type: 'setCount', count: c })}
                    >
                      {c}张
                    </button>
                  ))}
                </span>
              </>
            )}
          </>
        )}
        {/* §6.7：提示词节点的第三部分同样以生成按钮收尾（触发下游生成，见 runLabel） */}
        <button
          className={[
            styles.run,
            props.running ? styles.runCancel : '',
            busyGlobal ? styles.runBusy : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={busyGlobal}
          title={runLabel}
          aria-label={runLabel}
          onClick={() => onEvent({ type: props.running ? 'cancel' : 'run' })}
        >
          {props.running ? '✕' : busyGlobal ? '◌' : '↑'}
        </button>
        {props.error && <span className={styles.error}>{props.error}</span>}
      </section>
    </div>
  )
}

function Thumb({
  thumb,
  index,
  dragging,
  onDragStart,
  onDrop,
  onToggle,
  onRemove,
}: {
  thumb: PanelThumb
  index: number
  dragging: boolean
  onDragStart: () => void
  onDrop: () => void
  onToggle: () => void
  /** 仅「节点自身内容」提供（§6.6）；上游缩略图只能小眼睛隐藏 */
  onRemove?: () => void
}) {
  const url = useAsset(thumb.assetHash)
  return (
    <div
      className={[styles.thumb, dragging ? styles.thumbDragging : '', thumb.visible ? '' : styles.thumbHidden]
        .filter(Boolean)
        .join(' ')}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-panel-thumb={thumb.id}
    >
      {/* 编号角标：左上，显性（§6.8 / §6.11） */}
      <span className={styles.badge}>{index + 1}</span>
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className={styles.thumbText} title={thumb.text}>
          {thumb.text?.trim() ? thumb.text : '空提示词'}
        </span>
      )}
      {/* 小眼睛：右上，隐性（hover / 选中才显形） */}
      <button
        type="button"
        className={styles.eye}
        title={thumb.visible ? '本次生成包含该素材' : '本次生成跳过该素材'}
        aria-label={thumb.visible ? '跳过该素材' : '启用该素材'}
        aria-pressed={thumb.visible}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {thumb.visible ? '👁' : '⃠'}
      </button>
      {/* 删除：仅节点自身内容有（§6.6）。放右下角，与右上角的小眼睛错开 */}
      {onRemove && (
        <button
          type="button"
          className={`${styles.eye} ${styles.remove}`}
          title="删除该内容"
          aria-label="删除该内容"
          data-thumb-remove
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * 集合卡（产品文档 §6.12「作为上游：集合卡」）。
 *
 * 批量节点作为上游连到生成节点时，第一部分**不展开**内部素材，
 * 只显示一张标注数量的卡；数量已排除隐藏项。可与其他缩略图拖动排序
 * （M3 只支持容器内部排序，集合卡顺序跟随容器 childIds）。
 */
function CollectionCard({
  collection,
  onToggle,
}: {
  collection: PanelCollection
  onToggle: () => void
}) {
  const label = collection.kind === 'prompt' ? '提示词' : '素材'
  return (
    <div
      className={`${styles.collection} ${collection.visible ? '' : styles.thumbHidden}`}
      data-panel-collection={collection.id}
      data-panel-collection-count={collection.count}
      title={`集合：${collection.count} 个${label}`}
    >
      <span className={styles.collectionBadge}>{collection.count}</span>
      <span className={styles.collectionText}>
        集合
        <br />
        {label}
      </span>
      <button
        type="button"
        className={styles.eye}
        title={collection.visible ? '本次生成包含该集合' : '本次生成跳过该集合'}
        aria-label={collection.visible ? '跳过该集合' : '启用该集合'}
        aria-pressed={collection.visible}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {collection.visible ? '👁' : '⃠'}
      </button>
    </div>
  )
}
