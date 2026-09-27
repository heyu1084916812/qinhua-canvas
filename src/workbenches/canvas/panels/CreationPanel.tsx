import { useEffect, useRef, useSyncExternalStore, useState } from 'react'
import { clampDuration, type ModelCapability } from '../../../domain/shared/capability'
import type { GenerationData } from '../../../domain/canvas/model/node'
import type { PanelCollection, PanelModel, PanelThumb, RecipeSnapshot } from './panelModel'
import { generationParams } from '../../../domain/canvas/nodeSpecs/params'
import { moveInOrder } from './panelModel'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { useSkills } from '../../../app/providers/SkillStoreProvider'
import { useAsset } from '../hooks/useAsset'
import type { PromptToolAction } from '../../../features/shared/promptTools/promptTools'
import { ParamPicker } from './ParamPicker'
import { SkillPicker } from './SkillPicker'
import styles from './CreationPanel.module.css'
import { RATIO_FOLLOW_SOURCE } from '../../../domain/canvas/layout/constants'
import {
  categoryOfLogical,
  panelModelOptions,
  toLogicalName,
} from '../../../domain/project/modelCatalog'
import { presetOf } from '../../../domain/project/modelCatalog'
import { presetModelsOf } from '../../../domain/project/modelPresets'
import { ModelIcon } from './ModelIcon'

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
export const RATIO_OPTIONS = [
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
] as const

/** 「跟随素材」档位值取自 domain：执行计划也认它，不能两处各写一份 */
export { RATIO_FOLLOW_SOURCE }
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
 * 画质候选档位（§6.8）：**始终是「自动 + 1K / 2K / 4K」全套**。
 *
 * 用户 2026-09-16 报「image-2 没有 4K」：旧实现把模型上报的 `resolutions` 当**白名单**，
 * 模型（或缓存）只报 `['1k','2k']` 时 4K 就被**隐藏**了。而多数中转站的 `/v1/models`
 * 根本不报这个字段，缓存里那两条也很可能只是当初的残缺快照——
 * 「没报」不等于「不支持」，拿它当白名单等于让残缺元数据**永久砍掉**用户可选项。
 *
 * 语义修正：档位**始终给全**；模型明确声明只支持某几档时，由面板把够不到的档位置灰
 * （`ParamPicker` 的 `disabled`），而不是从列表里删掉。看得见但暂时不可选，
 * 比「选项凭空消失、用户以为功能没了」可解释得多。
 */
export function resolutionsOf(cap?: ModelCapability): string[] {
  void cap
  return RESOLUTION_OPTIONS.map((r) => r.value)
}

/**
 * 比例候选（§6.8）：与 `resolutionsOf` 同一口径——**始终给全 13 档**。
 *
 * 旧实现「模型上报就用模型的」会把残缺的快照当权威：缓存里只有 `['1:1','16:9']` 时，
 * 图形化网格里就只剩两格，用户报「比例没有图例」。13 档是**画布的表达能力**，
 * 不该被一次残缺上报锁死；模型确实不认的比例由渠道层如实报错，而不是界面上先藏掉。
 */
/**
 * `withFollowSource`：上游**有图片素材**时多一档「跟随素材」（见 `RATIO_FOLLOW_SOURCE`）。
 *
 * 判据是「这次生成有没有参考图」，不是「节点是哪种类型」（2026-09-24 用户拍板）：
 *  - 批量节点自己出图    → 有素材，给这一档；
 *  - 批量 → 下游生成节点 → 那个生成节点也有素材，同样给（此前漏了，这是主要缺口）；
 *  - 普通图生图          → 有参考图，也给，跟随**参考图 1**；
 *  - 纯文生图            → 没有素材可跟随，不给（给了就是死开关）。
 */
export function ratiosOf(cap?: ModelCapability, withFollowSource = false): string[] {
  void cap
  return withFollowSource ? [...RATIO_OPTIONS, RATIO_FOLLOW_SOURCE] : [...RATIO_OPTIONS]
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
  /** 打开技能库（缺技能时的出口）；由页面容器注入路由跳转 */
  onOpenSkills?: () => void
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
  /**
   * 这次生成**有没有图片参考**（上游素材，或节点自身的素材）。
   *
   * 唯一的影响是比例候选多一档「跟随素材」——没有素材可跟随就不该给这一档
   * （给了是个死开关）。判据是「有没有素材」而不是「是不是批量节点」
   * （2026-09-24 用户拍板：凡是有生图、有素材的地方都给这一档）。
   *
   * 由装配层按图算出并注入；面板保持纯视图、不读图（架构 §4.7）。
   */
  hasSourceImage?: boolean
  /**
   * 选中的**分发器**节点（循环 / 批量）下游有可运行的生成节点。
   *
   * 有下游时，这个节点的「生成」按钮实际驱动的是**下游生成节点**
   * （用它的参数），与提示词节点同一种语义——用户 2026-09-24：
   * 「点击一键生成的时候参考普通节点生成的逻辑」。按钮文案必须说清这件事，
   * 否则按下去看到下游在动，会以为按了个寂寞（同「假成功」那一类）。
   *
   * 由装配层按图算出并注入；面板保持纯视图、不读图（架构 §4.7）。
   */
  runsDownstream?: boolean
}

/**
 * 生成按钮里的箭头（用户 2026-09-19：「换一个粗一点的，前方左右两边要长一点」）。
 *
 * 为什么不用文字 `↑`：字形箭头又细又小，笔画宽度跟着字体走、改不动。
 * 自绘 SVG 能把**线宽**（2.2）和**两侧斜臂的长度**（从尖端往左下拉得较长）
 * 都定死，得到一个「粗、臂长、看得清方向」的箭头——这正是它作为主操作要有的分量。
 */
function RunArrow() {
  return (
    <svg
      className={styles.runArrow}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 主干：从下往上 */}
      <path d="M12 20.5V4.5" />
      {/* 两侧斜臂：往下拉得较长，形成开阔的箭头 */}
      <path d="M5.5 11 12 4.5 18.5 11" />
    </svg>
  )
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
  /** 面板形态判定要先于兜底：解析链按它决定模型类别（chat / video / image） */
  const promptMode = props.mode === 'prompt'
  /** 视频是生成节点的功能类别（`data.mode`），参数集与图片模式不同（§6.8） */
  const videoMode = !promptMode && data.mode === 'video'
  /**
   * 面板兜底：节点上**空着**时，按**解析链**现算一个可用的渠道 / 模型。
   *
   * 为什么面板也要兜底：早期只在**创建那一刻**算一次，算不出来就写空节点；
   * 于是「渠道已配置、模型只进了 modelCache、尚未勾选」这条最常见的路径下，
   * 新建节点永远是空的，而面板这边又只看节点上的值——**没有第二道兜底**。
   * 现在创建与面板调的是同一个 domain 解析链（`defaultForNewNode`）。
   *
   * **只在节点模型为空时兜底**，这是刻意的边界（G46 实测踩到）：
   * 节点已经带了模型（哪怕它不属于当前类别）是**用户自己的状态**，
   * 例如「图片 → 视频」切类别会把图片模型清掉，若这里又按新类别塞一个，
   * 就等于面板在跟用户抢所有权——类别切换会立刻被填回一个值，切完看着像没生效。
   *
   * 兜底只影响**显示**：不写回节点。用户不动它、直接点生成，执行层仍按节点上
   * 已固化的值为准；用户改选时才会把选择写回节点（与 §6.8「所见即所发」一致）。
   */
  const [fallback, setFallback] = useState<{ channelId: string; model: string } | null>(null)
  /**
   * `onEvent` 是父组件每次渲染新建的内联函数，**不能进 effect 依赖**：
   * 那会让这个「解析默认配方」的 effect 每渲染一次就跑一遍，进而反复派发写回事件，
   * 把节点数据与撤销栈刷爆。用 ref 取最新引用，effect 只按真实业务值触发。
   */
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const ownedChannelId = data.channelId ?? ''
  const ownedModel = data.model ?? ''
  /**
   * 依赖用**稳定值**：`enabled` 是每次渲染新建的数组，直接进依赖会无限重跑；
   * 渠道数量 + 各自的勾选状态足以覆盖「渠道被启用 / 被禁用 / 勾选模型变化」。
   */
  const channelSignature = enabled
    .map((c) => `${c.id}:${c.models.length}:${c.modelCache?.length ?? 0}`)
    .join('|')
  /**
   * 兜底算出的渠道 / 模型**要写回节点**，不能只拿来显示。
   *
   * 用户 2026-09-23 实测报：「UI 层有默认模型，但实际没有；新建节点直接生成，
   * 下方提示我没选渠道」。
   *
   * 根因是这里曾经只做「显示兜底」：`shownModel` 由解析链补齐，面板看着配好了，
   * 而节点 data 里 `channelId` / `model` 仍是空 —— 执行层读的**只有节点 data**
   * （`toRunRequest` 见到空渠道直接返回 null ⇒ 该节点不进计划）。于是界面与事实
   * 分叉：面板显示一套，执行用另一套，点下去必然失败。
   *
   * 这与项目里反复出现的一类缺陷同源（「看着通了、其实没接上」）：**显示层替用户
   * 做了决定，却没把决定落到数据上**。修法是让兜底落地 —— 解析链既然能算出一条可用
   * 配方，就把它写进节点，显示与实际从此同源，点生成也用得上。
   *
   * 只在**节点自身为空**时写（`ownedChannelId` / `ownedModel` 都空），
   * 所以不会覆盖用户的任何显式选择，也不参与「切类别清模型」那条路径
   * （那条走 `ownedModel` 非空的分支，进不来）。
   */
  useEffect(() => {
    let cancelled = false
    /**
     * 节点模型非空 → 一律不兜底。节点上的值是用户的选择（或类别切换后的刻意为空），
     * 面板是纯视图，不该拿解析链覆盖它。
     */
    if (ownedModel) {
      setFallback(null)
      return
    }
    /** 一个渠道都没有时不必算：解析链必然返回 null，白白多跑一次。 */
    if (enabled.length === 0) {
      setFallback(null)
      return
    }
    const category = promptMode ? 'chat' : videoMode ? 'video' : 'image'
    void channels
      .defaultForNewNode({ channelId: ownedChannelId, model: ownedModel }, category)
      .then((recipe) => {
        if (cancelled || !recipe) return
        setFallback({ channelId: recipe.channelId, model: recipe.model })
        /**
         * 写回节点。
         *
         * 两个事件而不是一个：`setChannel` 的语义是「换渠道 ⇒ 清空模型」，
         * 先发它、再发 `setModel`，落到 reducer 上正好是一次完整赋值，
         * 复用既有事件、不新增命令（也就不用动 state 层与测试台）。
         */
        if (!ownedChannelId) onEventRef.current({ type: 'setChannel', channelId: recipe.channelId })
        onEventRef.current({ type: 'setModel', model: recipe.model })
      })
      .catch(() => {
        /** 解析失败不该让面板崩：留空并照常渲染「还没配置渠道」的解释 */
      })
    return () => {
      cancelled = true
    }
  }, [channels, ownedChannelId, ownedModel, promptMode, videoMode, channelSignature])
  /**
   * 「有模型、却没有渠道」→ 补一条可用渠道（用户 2026-09-27 去掉平台 chip 后的必要配套）。
   *
   * 去掉平台 chip 之后，用户可能先选模型、而节点上还没有渠道：
   *  - 上面那条兜底在 `ownedModel` 非空时**刻意不跑**（不覆盖用户选择）；
   *  - 而 `toRunRequest` 见到空 `channelId` 直接返回 null ⇒ 节点不进计划
   *    ⇒ 点生成**毫无反应**（本项目反复踩过的「假成功」）。
   *
   * 所以这里只补**渠道**、不动模型：渠道是「这次打哪条路」的兜底，
   * 模型是用户刚选的东西。补完节点就能参与选路，哪怕这条渠道还没有该模型的
   * 映射，也会走「没有渠道提供模型」的**明确报错**，而不是静默失败。
   */
  useEffect(() => {
    if (ownedChannelId || enabled.length === 0) return
    const first = enabled[0]
    if (!first) return
    /**
     * `setChannel` 的语义是「换渠道 ⇒ 清空模型」（见 PanelLayer）。
     * 若此刻节点上已经有用户刚选的模型，必须**随后写回**，
     * 否则「先选模型、再补渠道」这条路径会把用户的选择当场抹掉。
     */
    onEventRef.current({ type: 'setChannel', channelId: first.id })
    if (ownedModel) onEventRef.current({ type: 'setModel', model: ownedModel })
    // 依赖口径与上一条兜底一致：用稳定的 `channelSignature` 而不是每次新建的 `enabled`
  }, [ownedChannelId, ownedModel, enabled, channelSignature])
  /** 面板实际展示的渠道 / 模型：节点自身优先，其次解析链兜底 */
  const shownChannelId = ownedChannelId || fallback?.channelId || ''
  const shownModel = ownedModel || fallback?.model || ''
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  /**
   * 当前展开的参数浮层（§6.8「同一时刻只允许一个面板打开，开新关旧」）。
   *
   * 唯一性由**这一个 key** 保证，而不是每个 chip 各自持一个 boolean——
   * 那样必然能同时开出两个浮层，再靠互相通知去关，是自找的竞态。
   */
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  /**
   * 提示词输入的**本地草稿 + 防抖落库**（用户 2026-09-24：「批量节点里面输入文字有点卡」）。
   *
   * 卡的原因：`onChange` 每敲一个键就 `dispatch` 一次 `node.updateData`。
   * 每次 dispatch 都会**替换整张 graph 快照**并触发整图重渲染；而批量节点还要
   * 额外算集合成员（`batchItemsOf` 遍历子节点），于是每键的代价被放大。
   *
   * 做法：输入时只改**本地状态**（那一层是浏览器原生的，没有重渲染），
   * 停手 300ms 后再落库。落库前如果用户切了节点，`model.prompt` 会变，
   * 下面的 effect 会把草稿同步过去 —— 不会把 A 节点的内容写进 B 节点。
   */
  const [promptDraft, setPromptDraft] = useState(model.prompt)
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 外部值变了（切节点 / 撤销 / 别的入口写入）→ 丢弃本地草稿，跟着外部走
  useEffect(() => {
    setPromptDraft(model.prompt)
    if (promptTimer.current) {
      clearTimeout(promptTimer.current)
      promptTimer.current = null
    }
  }, [model.prompt])

  // 卸载前把未落库的输入补交，避免「刚打完就关面板」丢字
  useEffect(() => {
    return () => {
      if (promptTimer.current) clearTimeout(promptTimer.current)
    }
  }, [])

  const onPromptChange = (text: string) => {
    setPromptDraft(text)
    if (promptTimer.current) clearTimeout(promptTimer.current)
    promptTimer.current = setTimeout(() => {
      promptTimer.current = null
      onEvent({ type: 'setPrompt', text })
    }, 300)
  }
  const closePicker = () => setOpenPicker(null)
  const togglePicker = (key: string) => setOpenPicker((cur) => (cur === key ? null : key))
  const tools = promptMode ? (props.promptTools ?? null) : null
  /** 技能库（共享的全局单例，设置页改完这里会立刻反映） */
  const { skills } = useSkills()
  /**
   * 第一部分是否为空（§6.8）。
   *
   * 抽出来是因为首行要按它决定「空态框出不出来」——空态框与「图片 / 视频」
   * 功能类别切换**共用一行**（空态框在左、类别切换在右、二者等高），
   * 而这一行本身在「既不空、又没有类别切换」时整体不该渲染。
   */
  const assetsEmpty = model.thumbs.length === 0 && model.collections.length === 0

  /**
   * 构造「配方快照」：把面板**当前显示**的渠道 / 模型 / 参数打成一包交给宿主。
   *
   * 为什么不在宿主侧从节点 data 现取（用户 2026-09-23 实测）：
   * 节点为空、只有面板兜底显示着渠道与模型时（新建后尚未落库那条路径），
   * 节点上取到的永远是空值，于是「改了参数就记配方」根本记不上——
   * 表现为「改了参数，再新建还是原来的默认值」。
   *
   * 面板是**唯一**知道「用户眼前这套值是什么」的地方，所以由它带出来。
   * `overrides` 是本次正要写入的那一项（例如刚选的 ratio），因为 state 还没更新。
   */
  const recipeSnapshot = (overrides: Partial<GenerationData> = {}): RecipeSnapshot => {
    const merged = { ...(data as GenerationData), ...overrides }
    return {
      channelId: shownChannelId,
      model: shownModel,
      mode: merged.mode ?? 'image',
      params: { mode: merged.mode ?? 'image', ...generationParams(merged) },
    }
  }

  const activeChannel = enabled.find((c) => c.id === shownChannelId)
  /**
   * 该渠道可选的全部模型。
   *
   * **勾选列表为空的渠道，回落到它的 `modelCache`**（2026-09-18 实测踩到）：
   * 「拉取模型」只是把模型拉进缓存，**不等于勾选**——用户还得在设置页的
   * 「选择模型」里勾上并点应用，那次操作才写进 `models`。
   * 于是「我只配了一个渠道、点了拉取、就直接回画布建节点」这条最常见的路径下，
   * `models` 是空的：
   *   - 节点虽然拿到了默认模型（`defaultForNewNode` 会回落到缓存），
   *     但这里的 `activeModel` 找不到它 → chip 显示占位「生图模型」，
   *     看起来就跟没默认一样；
   *   - 面板的模型下拉也是空的，用户连手动选都做不到。
   *
   * 只在**勾选为空**时回落：勾过的渠道仍以勾选为准（§7.4「用户勾选的才是下拉的数据源」），
   * 否则用户特意筛掉的模型又会冒出来。
   */
  const channelModels: ModelCapability[] =
    activeChannel && activeChannel.models.length > 0
      ? activeChannel.models
      : (activeChannel?.modelCache ?? [])
  /**
   * prompt 模式只能选文本 LLM（§6.7「只能选 LLM 模型」）；生成节点按**功能类别**
   * 过滤（图片 / 视频两套模型，§6.8）。都从 `models`（用户勾选的）里取，
   * 不是 `modelCache`（拉回来的全部）——§7.4。
   */
  const wantedCategory = promptMode ? 'chat' : videoMode ? 'video' : 'image'
  const models: ModelCapability[] = channelModels.filter((m) => m.category === wantedCategory)
  /**
 * M7-4：下拉列的是**逻辑名**，不是各站点的上游 ID。
 *
 * 同一个模型在不同站点 ID 不同（`gpt-image-2` / `image-2`），
 * 用户眼里却只有一个模型 —— 下拉就该只出一个名字；
 * 真正发请求时用哪个 ID 由渠道的 `modelMap` 决定（M7-3 已接好）。
 *
 * 零迁移：没有任何映射时逻辑名 = 上游 ID，列表与加此功能前一字不差。
   */
  /**
   * 模型下拉的数据源。
   *
   * - **提示词节点**：只列该渠道勾选过的对话模型（它必须真能发请求给 LLM）；
   * - **生成节点**：先列用户拍板的**固定显示名**（6 生图 / 5 视频），
   *   其后才是渠道勾选过的其它模型（用户 2026-09-27）。
   *   固定名在前是为了「一眼就选到自己的模型」，保留后者是为了
   *   还没配映射的站不至于一个都选不出来。
   */
  const logicalModelNames: string[] = panelModelOptions(
    allChannels,
    wantedCategory,
    shownChannelId || undefined,
  )
  /** 固定清单条目（有则模型行带厂商图标）；渠道模型没有图标，只出名字 */
  const modelOptions = logicalModelNames.map((n) => {
    const preset = presetOf(n)
    return {
      value: n,
      label: n,
      ...(preset ? { icon: <ModelIcon vendor={preset.vendor} /> } : {}),
    }
  })
/** 节点上存的模型名 → 逻辑名（老数据迁移）：见 `logicalModelNames` 处的说明 */
  const shownLogicalModel = toLogicalName(allChannels, shownModel)
  /**
   * 模型 chip 在**还没选**时的占位文案（用户 2026-09-27 第 8 轮）。
   *
   * 此前占位就是类别名（「生图模型」「文本模型」），用户看不出默认该用哪个。
   * 现在固定清单的**第一个**就是该类别的默认显示名，直接用它的名字当占位 ——
   * 用户一眼就知道「这里点了会先给什么」。
   */
  const defaultModelLabel =
    presetModelsOf(wantedCategory)[0]?.id ??
    (promptMode ? '文本模型' : videoMode ? '视频模型' : '生图模型')
  /**
   * 能力（分类 / 张数上限 / 时长区间 / 参考图数）仍按**站点 ID**取（与 M7-4 之前一致）。
   *
   * ⚠️ 这里**刻意不改**按逻辑名取：二分实测（BISECT-D）证明改了会让 G46 失败 ——
   * 切类别那一帧节点上还是上一档的模型，`capabilityOfLogical` 返回 undefined
   * ⇒ 参考模式被判隐藏、chip 取不到视频模型。
   * 而按站点 ID 取不影响用户要的「下拉只显示一个逻辑名」（那由下面的
 * `logicalModelNames` 负责），故保持改动面最小、不冒险。
   *
   * 已知限制：某站把逻辑名映射成**不同名**的上游 ID 时，该站的能力参数
   * （张数上限等）会取不到 —— 待 M7 收尾时连同切类别时序一起处理，已记入对账清单。
   */
  const activeModel = models.find((m) => m.id === shownModel)
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
  const ratios = ratiosOf(activeModel, props.hasSourceImage === true)
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
  /**
   * 切换功能类别时，**节点自己存的**模型是否属于目标类别；不属于就得清掉
   * （否则会把图片模型发给视频渠道）。
   *
   * 判的是 `data.model` 而**不是** `shownModel`（G46 实测踩到）：
   * `shownModel` 可能来自面板兜底，而兜底是按**当前**类别算的——
   * 拿它判「该不该清」会永远判成「属于」，切类别就清不掉了。
   * 这里问的是「用户存的这个值还要不要」，与「面板暂时显示什么」是两回事。
   */
  /**
 * 用入参 `m`（**目标**类别）判，不看当前渲染状态：本函数是在「切换前」
 * 那次渲染里调用的，此刻 `videoMode` 仍是旧值 —— 按当前类别判会恒为真
 * ⇒ 旧模型永远清不掉（G46 实测踩到）。
   */
  const modelBelongsTo = (m: 'image' | 'video') =>
    !!ownedModel &&
    categoryOfLogical(allChannels, toLogicalName(allChannels, ownedModel), ownedChannelId || undefined) ===
      m

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
      : promptMode || props.runsDownstream
        ? '生成下游节点'
        : '生成当前节点'

  // 无可用平台时给出**可点击的**解释：空下拉本身不说明「为什么空」，用户只会觉得点了没反应。
  // 区分「一个渠道都没建」与「建了但没启用」——后者最容易被误以为已经配好了。
  const noPlatform = enabled.length === 0
  const platformGap = allChannels.length === 0 ? '还没有配置任何渠道' : '已配置的渠道都未启用'
  /**
   * 「现在按下去一定不会有反应」这件事，按钮自己先说清楚（用户 2026-09-23 报「没有反应点了」）。
   *
   * 此前面板上方已经挂了「还没有配置任何渠道」的引导条，但**生成按钮仍然可点**：
   * 点下去后执行层 `toRunRequest` 返回 null ⇒ 该节点不进执行计划 ⇒ `runNode` 见到
   * `plan.tasks.length === 0` 直接 return，于是没有提示、没有报错、没有任何状态。
   * 用户读到的就是「这个按钮是坏的」。
   *
   * **只剩「一个可用渠道都没有」这一条**（用户 2026-09-27 第 8 轮）：
   * 模型下拉现在**永远有固定显示名**，所以「该类别一个模型都没勾」不再是一个
   * 必空状态 —— 名字选得出来、映射配好就能跑，按钮不该因此置灰。
   * 提示词节点那条「暂无可用文本模型」的旧口径也随之取消（它把用户挡在换模型之外）。
   */
  const blockedReason = props.running ? null : noPlatform ? platformGap : null
  const runDisabled = busyGlobal || blockedReason !== null
  const runTitle = blockedReason ? `${blockedReason}，去后台设置后再生成` : runLabel

  return (
    <div
      className={styles.panel}
      data-creation-panel
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Esc 先关参数浮层，浮层没了才关整个面板——否则想收起一个下拉，
        // 结果把面板也一起关掉了（§6.8「参数面板内 Esc → 关闭当前参数选择面板」）。
        if (openPicker) {
          /**
           * 关浮层的同时必须**声明这次 Esc 已被消费**。
           *
           * 少了这一句会踩一个真实的坑：`NodeFollowBar` 在 **window** 上监听 Esc
           * 并 `setSelection([])`（它得挂 window，否则焦点不在画布上时 Esc 会失灵）。
           * 而 React 的 `onKeyDown` 不会拦住事件继续冒到 window —— 于是一次 Esc
           * 做了两件事：收起下拉 **并且** 清空选中，面板当场消失。
           * 用户看到的就是「想收起下拉，整个面板没了」。
           *
           * 用 `preventDefault()` 而不是 `stopPropagation()`：后者依赖「React 把监听器
           * 挂在哪个节点」这一实现细节（React 17+ 挂在 root container 上），
           * 换挂载点即失效；`defaultPrevented` 是**跨层协商**，谁吃掉谁标记，与传播路径无关。
           */
          e.preventDefault()
          setOpenPicker(null)
        } else {
          props.onClose()
        }
      }}
    >
      {/* 第一部分：素材缩略图（分组 = 上游 + 组内；批量 = 内部素材） */}
      <section className={`${styles.section} ${styles.assetsSection}`} data-panel-part="assets">
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
                onRemove={() => onEvent({ type: 'removeThumb', owner: t.owner, id: t.id })}
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
                  onEvent({ type: 'setMode', mode: c.value, keepModel: modelBelongsTo(c.value), recipe: recipeSnapshot({ mode: c.value }) })
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
      <section className={`${styles.section} ${styles.promptSection}`} data-panel-part="prompt">
        <div className={styles.promptRow}>
          {model.linkedPromptCount > 0 && (
            <span className={styles.linked} data-panel-linked-prompt>
              上游已链接提示词节点 {model.linkedPromptCount}
            </span>
          )}
          <textarea
            className={styles.prompt}
            data-panel-prompt
            value={promptDraft}
            placeholder={
              promptMode
                ? '输入提示词（下游生成节点读的就是这里）'
                : '输入提示词，或连线上游提示词节点'
            }
            onChange={(e) => onPromptChange(e.target.value)}
            /* 失焦立即落库，不等那 300ms —— 用户点走就是「我打完了」 */
            onBlur={() => {
              if (!promptTimer.current) return
              clearTimeout(promptTimer.current)
              promptTimer.current = null
              onEvent({ type: 'setPrompt', text: promptDraft })
            }}
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
          /*
           * 提示词区的收尾行（§6.7）：只留**字数**。
           *
           * 「技能 / 优化 / 翻译 / 反推」这一排已挪到第三部分参数行的尾部
           * （用户 2026-09-24：「这一排放在参数那一排的后面即可」）——
           * 它们和渠道 / 模型 / 生成按钮同属「这次生成怎么跑」，
           * 摆在同一排比塞在提示词框下方更容易一次扫完。
           */
          <div className={styles.toolRow} data-panel-prompt-tools>
            <span className={styles.toolCount} data-panel-prompt-count>
              {model.prompt.length} 字
            </span>
          </div>
        )}
        {promptMode && tools?.error && (
          <div className={styles.toolError} data-panel-prompt-tool-error>
            {tools.error}
          </div>
        )}
      </section>

      {/* 第三部分：参数与生成 */}
      <section className={`${styles.section} ${styles.params} ${styles.paramsSection}`} data-panel-part="params">
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
        {/*
          **没有平台 chip**（用户 2026-09-27 第 8 轮：「提示词节点也不需要平台的配置了，
          只需要模型即可」）。

          生成节点早一轮就去掉了，提示词节点这一轮跟上。渠道不再由用户手选：
          面板的解析链会把首个可用渠道写进节点（「有模型无渠道就补渠道」那条兜底），
          文本调用再从节点的 `channelId` 取渠道。用户只需要关心「用哪个模型」。
        */}
        {/*
        模型 chip：**提示词节点同样要选**（§6.7「只能选 LLM 模型」，优化 / 翻译要用），
          所以这里不能按 promptMode 收窄。

          下拉现在**永远有固定显示名**（用户 2026-09-27），不再有
          「这一类没得选 → 藏起来换引导条」的状态；名字在、映射配好就能跑。
        */}
        <ParamPicker
            name="model"
            ariaLabel={categoryLabel}
            label={shownLogicalModel || defaultModelLabel}
            options={modelOptions}
            value={shownLogicalModel}
            variant="list"
            open={openPicker === 'model'}
            onToggle={() => togglePicker('model')}
            onClose={closePicker}
            onSelect={(v) => onEvent({ type: 'setModel', model: v, recipe: recipeSnapshot({ model: v }) })}
            /*
             * **一律可点**（用户 2026-09-27 第 8 轮：「当前提示词节点的模型是灰色的
             * 无法点击进行修改」）。
             *
             * 下拉里永远有固定显示名（6 生图 / 4 对话 / 5 视频），所以「没得选」
             * 这个状态已经不存在了。此前的提示词节点在「该渠道没勾对话模型」时
             * 把 chip 置灰 —— 用户看到的是「模型动不了」，而他真正想做的只是换个模型。
             * 名字选得出来、映射配好就能跑；真发不出去时由执行层报明确原因。
             */
            disabled={false}
        />

       {!promptMode && (
          <>
            {/* 比例：竖版列表选择器（§6.8） */}
            <ParamPicker
              name="ratio"
              ariaLabel="画面比例"
              label={data.ratio ?? '比例'}
              options={ratios.map((r) => ({ value: r, label: r }))}
              value={data.ratio ?? ''}
              variant="ratioGrid"
              open={openPicker === 'ratio'}
              onToggle={() => togglePicker('ratio')}
              onClose={closePicker}
              onSelect={(v) => onEvent({ type: 'setRatio', ratio: v, recipe: recipeSnapshot({ ratio: v }) })}
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
                  onSelect={(v) => onEvent({ type: 'setSize', size: v as NonNullable<GenerationData['size']>, recipe: recipeSnapshot({ size: v as NonNullable<GenerationData['size']> }) })}
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
                    onChange={(e) => onEvent({ type: 'setDurationSec', sec: Number(e.target.value), recipe: recipeSnapshot({ durationSec: Number(e.target.value) }) })}
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
                      onEvent({ type: 'setDurationSec', sec: n, recipe: recipeSnapshot({ durationSec: n }) })
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
                      onEvent({ type: 'setRefMode', refMode: v as NonNullable<GenerationData['refMode']>, recipe: recipeSnapshot({ refMode: v as NonNullable<GenerationData['refMode']> }) })
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
                  onSelect={(v) => onEvent({ type: 'setResolution', resolution: v, recipe: recipeSnapshot({ resolution: v as NonNullable<GenerationData['resolution']> }) })}
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
                  onSelect={(v) => onEvent({ type: 'setQuality', quality: v, recipe: recipeSnapshot({ quality: v as NonNullable<GenerationData['quality']> }) })}
                />
                {/*
                  张数改成与画质 / 质量同形的 chip + 弹层（用户 2026-09-19）。

                  早先是一排固定按钮（1张 / 2张 / 4张 / 9张 并排挂着），
                  与旁边两个 chip 的形态不一致：参数行里三个控件长得像两套东西。
                  收进 chip 后整行只有「画质 / 质量 / 张数」三个同形控件，扫视成本更低。
                */}
                <ParamPicker
                  name="count"
                  ariaLabel="生成张数"
                  label={`${count} 张`}
                  options={COUNT_OPTIONS.map((c) => ({
                    value: String(c),
                    label: `${c} 张`,
                    /** 模型明确声明的上限才置灰；未声明 = 不设限（见 maxCount 的注释） */
                    disabled: c > maxCount,
                    title: c > maxCount ? `当前模型最多 ${maxCount} 张` : `${c} 张`,
                  }))}
                  value={String(count)}
                  variant="pill"
                  open={openPicker === 'count'}
                  onToggle={() => togglePicker('count')}
                  onClose={closePicker}
                  onSelect={(v) => onEvent({ type: 'setCount', count: Number(v), recipe: recipeSnapshot({ count: Number(v) }) })}
                />
              </>
            )}
          </>
        )}
        {/*
          「技能 / 优化 / 翻译 / 反推」这一排（§6.7）。

          用户 2026-09-24：「这一排放在参数那一排的后面即可」——
          它们决定**这次调用用哪段系统指令 / 拿上游图去推**，
          与渠道 / 模型 / 生成按钮同属「这次生成怎么跑」，
          摆进参数行、紧挨着生成按钮，一次扫完。

          为什么要 `margin-left: auto`：参数行是 flex 换行容器，
          这一组靠右对齐后永远贴着生成按钮，参数多少都不会把它挤走。
        */}
        {promptMode && tools && (
          <span className={styles.toolGroup} data-panel-prompt-tools>
            <SkillPicker
              skills={skills}
              running={tools.status === 'running'}
              text={model.prompt}
              imageCount={props.promptImageCount ?? 0}
              selectedId={model.selectedSkillId ?? null}
              onSelect={(skillId) => onEvent({ type: 'selectSkill', skillId })}
              onOpenLibrary={props.onOpenSkills}
            />
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
          </span>
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
          disabled={runDisabled}
          data-panel-run
          data-panel-run-blocked={blockedReason ?? undefined}
          title={runTitle}
          aria-label={runLabel}
          onClick={() => onEvent({ type: props.running ? 'cancel' : 'run' })}
        >
          {props.running ? '✕' : busyGlobal ? '◌' : <RunArrow />}
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
  onRemove: () => void
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
      {/*
        画面层单独包一层：**圆角裁切只作用在它身上**（用户 2026-09-21）。

        拆开的原因是两个需求打架：圆角裁图需要 `overflow:hidden`，
        而角标 / 小眼睛要「探出边框」需要 `overflow:visible`。
        放在同一个盒子上只能二选一——旧版选了 visible，于是**图片变成方的**
        （裁切失效），角标也**压在图上**（它只能待在容器内部）。
        现在裁切下沉到内层，外层保持 visible，两个需求各得其所。
      */}
      <span className={styles.thumbFrame}>
        {url ? (
          <img src={url} alt="" draggable={false} />
        ) : (
          <span className={styles.thumbText} title={thumb.text}>
            {thumb.text?.trim() ? thumb.text : '空提示词'}
          </span>
        )}
      </span>
      {/*
        编号角标：**骑在左上角外沿**（用户 2026-09-21：「遮住了素材」）。
        它原先贴在容器内的 (1,1)，数字直接盖在图片上。现在向内收 − 向外探，
        既让开画面、又能被一眼看到。
      */}
      <span className={styles.badge}>{index + 1}</span>
      {/* 小眼睛：右上，隐性（hover / 选中才显形） */}
      <button
        type="button"
        className={`${styles.eye} ${styles.eyeAtBottom}`}
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
      {/*
        删除角标：**中心骑在右上角顶点**（用户 2026-09-21）。
        与左上的编号角标对称——都是「中心落在角顶点」的骑角做法。

        语义按来源分两种（见 panelModel 的说明）：
        - 上游缩略图 → 删掉那条连线；
        - 自身素材 → 清空本节点的图，回到「没上传图片」状态。
        两者都进撤销栈，误删能撤回。
      */}
      {thumb.removable && (
        <button
          type="button"
          className={styles.deleteBadge}
          data-thumb-delete={thumb.id}
          title={thumb.owner === 'upstream' ? '移除该上游素材（删除连线）' : '清除素材'}
          aria-label={thumb.owner === 'upstream' ? '移除该上游素材（删除连线）' : '清除素材'}
          onPointerDown={(e) => e.stopPropagation()}
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
