import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, useState } from 'react'
import { clampDuration, type ModelCapability } from '../../../domain/shared/capability'
import type { GenerationData } from '../../../domain/canvas/model/node'
import type { PanelCollection, PanelModel, PanelThumb, RecipeSnapshot } from './panelModel'
import { generationParams } from '../../../domain/canvas/nodeSpecs/params'
import { moveInOrder } from './panelModel'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { useSkills } from '../../../app/providers/SkillStoreProvider'
import { useAsset } from '../hooks/useAsset'
import { MentionEditor, mentionToken, type MentionEditorHandle } from '../text/MentionEditor'
import {
  collapseMentions,
  expandMentions,
  type MentionCandidate,
} from '../text/mentionValue'
import type { PromptToolAction } from '../../../features/shared/promptTools/promptTools'
import { ParamPicker, type ParamSection } from './ParamPicker'
import { SkillPicker } from './SkillPicker'
import styles from './CreationPanel.module.css'
import { RATIO_FOLLOW_SOURCE } from '../../../domain/canvas/layout/constants'
import {
  isAutoRatio,
  videoParamsFor,
  VIDEO_MODE_LABELS,
  type VideoModeId,
} from '../../../domain/canvas/layout/videoParams'
import { MJ_PERSONALIZE_MAX, MJ_SLIDERS, mjSettingsOf } from '../../../domain/canvas/layout/mjParams'
import { imageParamsFor } from '../../../domain/canvas/layout/imageParams'
import {
  categoryOfLogical,
  panelModelOptions,
  toLogicalName,
} from '../../../domain/project/modelCatalog'
import { presetOf } from '../../../domain/project/modelCatalog'
import { presetModelsOf } from '../../../domain/project/modelPresets'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import {
  IconChevronDown,
  IconClose,
  IconPreset,
  IconSettings,
  IconSpinner,
  IconStop,
} from '../toolbar/icons'
import {
  DEFAULT_EMOTION_ID,
  presetById,
} from '../../../domain/canvas/layout/presets'
import { PresetMenu, PresetOptions } from './PresetMenu'
import { EmotionBox } from './EmotionBox'

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
  /**
   * `auto` 的文案是**自适应**（用户 2026-10-03 图一那份面板里就叫「自适应」）。
   *
   * 语义与视频的比例那档一致：**不向渠道指定**，交给模型自己定。
   * 只有「这个模型根本没有尺寸档」时才会看到它（如 Midjourney：只有这一档）。
   */
  { value: 'auto', label: '自适应' },
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
  return withFollowRatio(RATIO_OPTIONS, withFollowSource)
}

/**
 * 给一组比例档**补上「跟随素材」**（已经有就不重复补）。
 *
 * 抽出来是因为比例的来源有三个：模型自己的能力表、通用 13 档、以及视频那几档 ——
 * 而「有没有这一档」这件事**只该由一件事决定：这次生成有没有参考图**
 * （用户 2026-09-24 定稿的规则）。
 *
 * ⚠️ 2026-10-03 修的 bug：这条规则原先只接在「通用 13 档」那一条路上 ——
 * 有规格的模型（GPT Image / Nano Banana / Agnes 图片 / 四个视频档）走的是
 * `spec.ratios`，压根不经过这里，于是**只有 Midjourney 看得到这一档**
 * （用户报：「只有 mj 模型有这个跟随素材的功能」）。现在三个来源都过这道函数，
 * 差别只剩「摆的是哪几档比例」，不再有「哪个模型才有跟随素材」这种漂移。
 */
export function withFollowRatio(ratios: readonly string[], withFollowSource: boolean): string[] {
  if (!withFollowSource || ratios.includes(RATIO_FOLLOW_SOURCE)) return [...ratios]
  return [...ratios, RATIO_FOLLOW_SOURCE]
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

  /**
   * 创作面板里的 `@`（用户 2026-10-05 第 15 条）：能引用**本节点上游**的图 / 视频素材。
   *
   * 存储里只放纯文本（`@名字`），引用形态只活在编辑器那一层 —— 理由与两个方向的
   * 转换都写在 `text/mentionValue.ts`（提示词还要发给模型、给下游，不能夹带机器形态）。
   * 这里只管三件事：纯文本 → 编辑器 value、编辑器文本 → 纯文本、给 chip 备好缩略图。
   */
  const promptEditorRef = useRef<MentionEditorHandle | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const mentionCandidates = model.mentionCandidates
  const promptValue = useMemo(
    () => expandMentions(promptDraft, mentionCandidates),
    [promptDraft, mentionCandidates],
  )

  /** 候选节点 → 素材 hash（面板模型已经算过上游缩略图，这里不再扫一遍图） */
  const mentionHashOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of model.thumbs) if (t.assetHash) map.set(t.id, t.assetHash)
    return map
  }, [model.thumbs])

  /**
   * chip 上的缩略图：编辑器是**命令式建的 DOM**、拿不到 hook，所以图由宿主取一次、
   * 缓存成 `节点 id → objectURL`，再用版本号通知编辑器**就地**补进槽位
   * （与对话窗那套同一招，见 `AgentPanel` 里那段说明）。
   */
  const mentionThumbRef = useRef(new Map<string, string>())
  const [mentionThumbVersion, setMentionThumbVersion] = useState(0)
  const mentionThumbOf = useCallback(
    (id: string) => mentionThumbRef.current.get(id) ?? null,
    [],
  )
  /**
   * 点别处收起 @ 菜单。
   *
   * Esc **不在这里处理**：那个键要按「最上面那层」逐层收（菜单 → 参数浮层 → 面板），
   * 而这一层手里没有那个顺序的信息 —— 交给面板自己的 keydown（它知道有没有浮层开着，
   * 也知道怎么标记「这次 Esc 已被消费」）。这里再插一手只会变成两个地方抢同一个键。
   */
  useEffect(() => {
    if (!mentionOpen) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-panel-mention-menu]') || el?.closest('[data-panel-mention-open]')) {
        return
      }
      setMentionOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('pointerdown', onDown)
    }
  }, [mentionOpen])

  /** 插进正文：走编辑器自己的 `insertMention`（落在光标处、带 chip 的存储形态） */
  const insertMention = (c: MentionCandidate) => {
    promptEditorRef.current?.insertMention(mentionToken('node', c.id, c.label))
    setMentionOpen(false)
  }

  /**
   * 预设 / 情绪（用户 2026-10-05 第 14 条）。
   *
   * 两个浮层的开关是**面板自己的状态**（与参数菜单同一套「同一时刻只开一个」的思路），
   * 但「选了哪一条」不在本地 —— 那是节点上的 `data.preset` / `data.emotion`，
   * 面板只把它读出来显示。本地再存一份就会出现「面板显示 A、实际发出去 B」。
   */
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetOptionsOpen, setPresetOptionsOpen] = useState(false)
  const activePreset = presetById(model.preset)
  const emotionOn = !!model.emotion
  /** 情绪面板左边那张预览图：上游第一张带素材的图（没有就显示一句提示） */
  const characterThumb =
    model.thumbs.find((t) => t.owner === 'upstream' && t.assetHash) ??
    model.thumbs.find((t) => t.assetHash)
  const closePresetMenus = () => {
    setPresetOpen(false)
    setPresetOptionsOpen(false)
  }
  /** 点别处收起预设菜单（与 @ 菜单同一套；Esc 交给面板自己逐层收，见下） */
  useEffect(() => {
    if (!presetOpen && !presetOptionsOpen) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-preset-menu]') || el?.closest('[data-preset-options]')) return
      if (el?.closest('[data-panel-preset-open]') || el?.closest('[data-panel-preset-gear]')) return
      closePresetMenus()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [presetOpen, presetOptionsOpen])
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
  /**
   * **图片模型各自的参数能力**（用户 2026-10-03：「把图片生成节点和视频生成节点的模型
   * 具体每个模型有哪些配置单独设置，不要通用设置，去官方文档找一下」）。
   *
   * 与 `videoParamsFor` 同一套做法：有规格就**只按规格渲染**（Agnes Image 2.0 只给像素尺寸、
   * 2.1/2.5 给 1K–4K 档位 + 8 档画幅、都没有「张数 / 质量」），
   * 没有规格才退回原来那套通用档位（其它厂商的显示名，参数以渠道上报为准）。
   */
  const imageSpec =
    !promptMode && !videoMode
      ? imageParamsFor(shownLogicalModel || String(data.model ?? ''))
      : undefined

  /**
   * **视频模型各自的参数能力**（用户 2026-10-03：「每个视频模型应该有的参数单独做，
   * 因为有些模型他不支持」）。值域来自 `videoParamsFor`（Agnes 官方文档）——
   * 有它就按它渲染，没有才退回原来那套通用档位。
   */
  const videoSpec = videoMode
    ? videoParamsFor(shownLogicalModel || String(data.model ?? ''))
    : undefined

  /**
   * 比例 / 尺寸两段候选：**模型有能力表就只按能力表**（模型不支持的档位直接隐藏，
   * §6.8「参数项随模型能力动态渲染」），没有才按渠道上报的能力。
   *
   * 三条来源最后都过一遍 `withFollowRatio`：「跟随素材」这一档**只看有没有参考图**，
   * 与模型有没有能力表无关（见该函数的说明）。
   */
  /** 这次生成**有没有参考图**：有才有「跟随素材」可跟随 */
  const hasSource = props.hasSourceImage === true
  const ratios = withFollowRatio(
    videoSpec ? videoSpec.ratios : imageSpec ? imageSpec.ratios : ratiosOf(activeModel),
    hasSource,
  )
  /**
   * 面板上**显示**的比例值。
   *
   * 节点上可能存着一个「跟随素材」（上一次选了它、或被配方记忆带过来），
   * 而这一屏**没有参考图** —— 那就没有可跟随的对象。这时显示成未设置，
   * 而不是摆一个此刻做不到的值（用户 2026-10-03：「无论有没有素材的时候」
   * 都看到这一档）。**不写回节点**：接上参考图它就该重新生效。
   */
  const storedRatio = String(data.ratio ?? '')
  const shownRatio = storedRatio === RATIO_FOLLOW_SOURCE && !hasSource ? '' : storedRatio
  const resolutions: readonly string[] = imageSpec
    ? [...imageSpec.sizes]
    : resolutionsOf(activeModel)

  const declaredMax = activeModel?.maxCount
  const maxCount =
    imageSpec
      ? Math.max(...imageSpec.counts)
      : typeof declaredMax === 'number' && declaredMax > 0
      ? Math.max(1, declaredMax)
      : COUNT_OPTIONS[COUNT_OPTIONS.length - 1]
  const count = Math.max(1, Math.min(data.count ?? 1, maxCount))
  /** 张数候选：有规格就只摆规格里的（Agnes 图片只有 1 张 ⇒ 这一段整个不摆） */
  const countChoices: readonly number[] = imageSpec ? imageSpec.counts : COUNT_OPTIONS
  /** 质量候选：规格里没有就不摆（Agnes 图片们都没有 `quality`） */
  const qualityChoices = imageSpec ? imageSpec.qualities : QUALITY_OPTIONS.map((q) => q.value)

  /**
   * 「生成参数」胶囊上的那一行摘要。
   *
   * 顺序与胶囊里四段的顺序一致（比例 · 画质 · 质量 · 张数），也就是把原先
   * 四枚 chip 的文案用「 · 」串起来 —— 用户 2026-10-02 的参考产品就是
   * 「1:1 · 标准画质 · 1K · 1张」这种一行说法。
   */
  /**
   * 文案表：**值仍是各家接口的合法枚举**，只在这里换中文标签
   * （用户 2026-10-03 图一：低 / 标准 / 高 / 超高 / 极致画质；自动 / 保留背景 / 透明背景）。
   */
  const QUALITY_LABELS: Record<string, string> = {
    auto: '自动',
    low: '低画质',
    medium: '标准画质',
    high: '高画质',
    xhigh: '超高画质',
    max: '极致画质',
  }
  const BACKGROUND_LABELS: Record<string, string> = {
    auto: '自动',
    opaque: '保留背景',
    transparent: '透明背景',
  }
  const resolutionLabel = (value: string): string =>
    RESOLUTION_OPTIONS.find((r) => r.value === value)?.label ?? value.toUpperCase()
  const qualityLabelOf = (value: string): string =>
    QUALITY_LABELS[value] ?? QUALITY_OPTIONS.find((q) => q.value === value)?.label ?? value
  const backgroundLabelOf = (value: string): string => BACKGROUND_LABELS[value] ?? value
  /** 背景档：只有声明支持它的模型（GPT Image）才摆这一段 */
  const backgroundChoices: readonly string[] = imageSpec ? imageSpec.backgrounds : []

  /**
   * 摘要只串**这次真的摆出来的那几段**，顺序与面板一致
   * （图一那份：画质 · 清晰度 · 背景 · 比例 · 生成数量）。
   */
  const paramsLabel = [
    qualityChoices.length > 0 ? qualityLabelOf(data.quality ?? 'auto') : '',
    resolutions.length > 0 ? resolutionLabel(data.resolution ?? 'auto') : '',
    backgroundChoices.length > 0 ? backgroundLabelOf(data.background ?? 'auto') : '',
    ratios.length > 0 ? shownRatio || '比例' : '',
    countChoices.length > 1 ? `${count} 张` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  /**
   * 图片模式的几段，**顺序照用户 2026-10-03 图一**：画质 → 清晰度 → 背景 → 比例 → 生成数量。
   *
   * **每一段只有真的有候选才出现**：Agnes 的图片模型没有 `quality` / `background`，
   * 那两段整块不摆，而不是摆一排点了没反应的格子。
   */
  const resolutionValueOf = (size: string): string =>
    /^\d+k$/i.test(size) ? size.toLowerCase() : size
  const paramSections: ParamSection[] = [
    ...(qualityChoices.length > 0
      ? [
          {
            name: 'quality',
            label: '画质',
            variant: 'pill' as const,
            options: qualityChoices.map((q) => ({ value: q, label: qualityLabelOf(q) })),
            value: data.quality ?? 'auto',
            onSelect: (v: string) =>
              onEvent({
                type: 'setQuality',
                quality: v,
                recipe: recipeSnapshot({ quality: v as NonNullable<GenerationData['quality']> }),
              }),
          },
        ]
      : []),
    ...(resolutions.length > 0
      ? [
          {
            name: 'resolution',
            label: '清晰度',
            variant: 'pill' as const,
            options: resolutions.map((v) => ({
              value: resolutionValueOf(v),
              label: resolutionLabel(v),
            })),
            value: data.resolution ?? 'auto',
            onSelect: (v: string) =>
              onEvent({
                type: 'setResolution',
                resolution: v,
                recipe: recipeSnapshot({ resolution: v }),
              }),
          },
        ]
      : []),
    ...(backgroundChoices.length > 0
      ? [
          {
            name: 'background',
            label: '背景',
            variant: 'pill' as const,
            options: backgroundChoices.map((b) => ({ value: b, label: backgroundLabelOf(b) })),
            value: data.background ?? 'auto',
            onSelect: (v: string) =>
              onEvent({
                type: 'setBackground',
                background: v,
                recipe: recipeSnapshot({ background: v }),
              }),
          },
        ]
      : []),
    ...(ratios.length > 0
      ? [
          {
            name: 'ratio',
            label: '比例',
            variant: 'ratioGrid' as const,
            options: ratios.map((r) => ({ value: r, label: r })),
            value: shownRatio,
            onSelect: (v: string) =>
              onEvent({ type: 'setRatio', ratio: v, recipe: recipeSnapshot({ ratio: v }) }),
          },
        ]
      : []),
    ...(countChoices.length > 1
      ? [
          {
            name: 'count',
            label: '生成数量',
            variant: 'pill' as const,
            options: countChoices.map((c) => ({
              value: String(c),
              label: `${c} 张`,
              /** 模型明确声明的上限才置灰；未声明 = 不设限（见 maxCount 的注释） */
              disabled: c > maxCount,
              title: c > maxCount ? `当前模型最多 ${maxCount} 张` : `${c} 张`,
            })),
            value: String(count),
            onSelect: (v: string) =>
              onEvent({
                type: 'setCount',
                count: Number(v),
                recipe: recipeSnapshot({ count: Number(v) }),
              }),
          },
        ]
      : []),
  ]

  /**
   * 视频参数（§6.8 视频模式；用户 2026-10-03 图三～图十一）：
   * **生成模式 · 比例 · 清晰度 · 时长 · 生成音频 · 生成数量**。
   *
   * 这一段与图片模式**刻意不同**：图片那六枚参数收在一枚胶囊里，而视频这边
   * 时长是滑块（`ParamPicker` 的三段形态都装不下它），所以仍是「几枚 chip + 一个滑块」。
   * 每一枚都**只在模型真的声明了它的时候才摆** —— 摆一个点了没用的格子，
   * 用户会以为功能坏了。
   */
  /** 清晰度档：有规格就只按规格出（**去掉 auto / 480P 这种它不认的值**），否则用通用档 */
  const sizeChoices: { value: string; label: string }[] = videoSpec
    ? videoSpec.sizes.map((s) => ({ value: s, label: s.toUpperCase() }))
    : SIZE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))
  /**
   * 显示值：**落在该模型认的档位里**。
   *
   * 节点上存的可能是上一个模型的档（同一节点换模型不换节点），
   * 直接拿它去比对就会显示成占位文案「清晰度」—— 看着像「没选」，
   * 而适配器那边其实会把它夹到最接近的合法档。这里同样落到第一条合法档，
   * 让界面与实际发出去的值一致（§6.8「所见即所发」）。
   */
  const sizeValue =
    data.size && sizeChoices.some((s) => s.value === data.size)
      ? data.size
      : videoSpec
        ? (sizeChoices[0]?.value ?? 'auto')
        : (data.size ?? 'auto')
  const sizeLabel = sizeChoices.find((s) => s.value === sizeValue)?.label ?? '清晰度'
  /**
   * 时长：有规格就按规格（图三 4–15、图六 4–30、图八/图十 5–15），
   * 没有规格才退回通用的 3–15（并按渠道声明的区间收）。
   */
  const secondsRange = videoSpec?.seconds
  const [minSec, maxSec] = secondsRange
    ? [secondsRange.min, secondsRange.max]
    : (activeModel?.durations ?? [3, 15])
  const duration = secondsRange
    ? Math.min(
        secondsRange.max,
        Math.max(secondsRange.min, Math.round(data.durationSec ?? secondsRange.default)),
      )
    : clampDuration(data.durationSec ?? DEFAULT_DURATION, activeModel)
  /** **时长这一段只在模型真有这个参数时出现**（没有 `seconds` 的模型不摆滑块） */
  const showDuration = Boolean(secondsRange) || !videoSpec

  /**
   * 生成模式（图四/图五/图七/图九那种下拉）。
   *
   * 值优先取 `videoMode`，其次认老字段 `refMode`（这一档的前身，两个值）——
   * 不认老字段的话，旧项目里选过「首尾帧」的节点打开就变成「文生视频」。
   */
  const modeIds: readonly VideoModeId[] = videoSpec
    ? videoSpec.modes
    : (['text', 'all-purpose', 'first-last-frame'] as const)
  const storedMode: VideoModeId | undefined =
    (typeof data.videoMode === 'string' ? (data.videoMode as VideoModeId) : undefined) ??
    (data.refMode === 'first-last-frame' || data.refMode === 'all-purpose'
      ? data.refMode
      : undefined)
  const disabledModes = new Set<string>(videoSpec?.disabledModes ?? [])
  /**
   * **默认档要跳过置灰项**（用户 2026-10-03 图七/图九那份参考实现里，「文生视频」是灰的）。
   *
   * 不跳的话新节点一打开就停在「文生视频」上 —— 用户看到的是「默认选了一个选不了的档」，
   * 而且他真点生成时才会发现这一档不给用。跳到第一个**可选**的档，
   * 至少当场就能看出该模型是从哪一档起步的（H3 / H3 Max 都从「图生视频」起）。
   */
  const enabledModes = modeIds.filter((id) => !disabledModes.has(id))
  const videoModeValue: VideoModeId =
    storedMode && enabledModes.includes(storedMode)
      ? storedMode
      : (enabledModes[0] ?? modeIds[0] ?? 'text')
  /** 只有一档模式就别摆 chip 了（摆了也只能选它） */
  const showVideoMode = modeIds.length > 1
  const videoModeOptions = modeIds.map((id) => {
    const meta = VIDEO_MODE_LABELS[id]
    /**
     * Agnes 那条路的「全能参考」补一句**官方文档的用法**（`agnes-video-25`：
     * reference 模式用 `<Picture N>` / `<Audio N>` / `<Video N>` 指代输入素材）。
     *
     * 为什么值得写在面板上：用户 2026-10-03 报「全能参考好像没按我的参考来」——
     * 除了键名那个真 bug（见 `openaiVideo.ts`），另一半是**用法**：
     * 提示词里不点名第几张图，模型没有理由照搬它的风格。
     * 只对 Agnes 那两套方言给这条提示（别家没有这个占位符约定）。
     */
    const agnesReference = id === 'all-purpose' && videoSpec?.dialect !== 'openai-videos'
    return {
      value: id,
      label: meta.beta ? `${meta.label} Beta` : meta.label,
      ...(agnesReference
        ? { hint: '参考图按连线顺序编号；提示词里可用 <Picture 1> 指代第 1 张' }
        : {}),
      ...(disabledModes.has(id)
        ? { disabled: true, title: `${meta.label}：当前模型不支持这一档` }
        : {}),
    }
  })

  /** 生成数量（图三/图六/图八/图十那排 1/2/4）：**只有一档时整段不摆** */
  const videoCounts: readonly number[] = videoSpec ? videoSpec.counts : [1]
  const videoMaxCount = Math.max(...videoCounts)
  const videoCount = Math.max(1, Math.min(Math.round(data.count ?? 1), videoMaxCount))
  const showVideoCount = videoCounts.length > 1

  /** 「生成音频」开关：图三/图六有，图八/图十没有 —— 只有声明支持的模型才摆 */
  const showGenerateAudio = videoSpec?.supportsAudio === true
  const generateAudio = data.generateAudio ?? true

  /**
   * **Midjourney 的「高级设置」**（用户 2026-10-03 图二）。
   *
   * 它独有、而且别家都没有的那几档风格参数（`--stylize` / `--weird` / `--chaos` / `--p`）
   * 不塞进「生成参数」那枚胶囊里，而是**单独一枚 chip 摆在参数行末尾**
   * （用户原话：「把 mj 的自己独有的参数设置面板做一个，放在参数的后面」）——
   * 理由也是清楚的：它们是**风格**，不是「这次出几张、什么比例」那种每次都要动的量。
   */
  const isMj = !promptMode && imageSpec?.dialect === 'midjourney'
  const mj = mjSettingsOf({
    stylize: data.mjStylize,
    weird: data.mjWeird,
    chaos: data.mjChaos,
    personalize: data.mjPersonalize,
  })
  /**
   * 滑杆 → 事件。**事件名必须与节点字段同名**（`setMjStylize` ↔ `mjStylize`）——
   * 配方记忆那条规则是靠「事件名剥掉 set 就是字段名」认出来的（见 `generationPreset`），
   * 名字对不上就会「改了参数、新建节点却没记住」。
   */
  const onMjSlider = (key: 'stylize' | 'weird' | 'chaos', n: number) => {
    if (!Number.isFinite(n)) return
    if (key === 'stylize') {
      onEvent({ type: 'setMjStylize', value: n, recipe: recipeSnapshot({ mjStylize: n }) })
    } else if (key === 'weird') {
      onEvent({ type: 'setMjWeird', value: n, recipe: recipeSnapshot({ mjWeird: n }) })
    } else {
      onEvent({ type: 'setMjChaos', value: n, recipe: recipeSnapshot({ mjChaos: n }) })
    }
  }
  const mjSections: ParamSection[] = isMj
    ? [
        {
          name: 'mj-personalize',
          label: '个性化风格',
          variant: 'text' as const,
          options: [],
          value: mj.personalize,
          placeholder: `填写你的个性化风格代码（--p，最多 ${MJ_PERSONALIZE_MAX} 字）`,
          onSelect: (v: string) =>
            onEvent({
              type: 'setMjPersonalize',
              value: v,
              recipe: recipeSnapshot({ mjPersonalize: v }),
            }),
        },
        ...MJ_SLIDERS.map((spec) => ({
          name: `mj-${spec.key}`,
          label: spec.label,
          variant: 'slider' as const,
          options: [],
          min: spec.min,
          max: spec.max,
          step: 1,
          value: String(mj[spec.key]),
          onSelect: (v: string) => onMjSlider(spec.key, Number(v)),
        })),
      ]
    : []
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
        } else if (mentionOpen) {
          /**
           * 再往下才轮到 `@` 候选菜单。
           *
           * 顺序不能反：菜单是**浮在面板上的**一层，Esc 的语义按「最上面那层」来。
           * 这一步也必须 `preventDefault()`（同下）—— 否则一次 Esc 会既收菜单
           * 又关掉整个面板（实测：只点开菜单再按 Esc，面板一起没了）。
           */
          e.preventDefault()
          setMentionOpen(false)
        } else if (presetOpen || presetOptionsOpen) {
          /** 再往下是预设菜单 / 它的二级搭配（同一条「逐层收」的规则，见上） */
          e.preventDefault()
          closePresetMenus()
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

      {/*
        情绪调节（用户 2026-10-05 第 14 条后半）：「在素材下方出现一个功能框」——
        位置就钉在素材区与提示词区之间。开着与否**只看有没有选情绪**（关闭 = 清掉），
        不另存一个开关状态，免得出现「关掉了但表情还在提示词里」。
      */}
      {!promptMode && model.emotion && (
        <EmotionBox
          emotion={model.emotion}
          characterHash={characterThumb?.assetHash}
          onPick={(id) => onEvent({ type: 'setEmotion', emotion: id })}
          onClose={() => onEvent({ type: 'setEmotion', emotion: null })}
          /**
           * 头排右侧放**比例 / 数量**（参考图二十的头部就是「比例 · 数量 · 生成」）。
           *
           * 用的是与参数行**同一份状态**（`data.ratio` / `data.count`），只是换了
           * 锚点名（`emotionRatio` / `emotionCount`）—— 同一个 `data-param-chip` 值
           * 在面板里出现两次会让按锚点定位的冒烟直接报「匹配到多个」。
           */
          header={
            <>
              <ParamPicker
                name="emotionRatio"
                ariaLabel="画面比例"
                label={shownRatio || '比例'}
                options={ratios.map((r) => ({
                  value: r,
                  label: isAutoRatio(r) ? '自适应' : r,
                }))}
                value={shownRatio}
                variant="ratioGrid"
                open={openPicker === 'emotionRatio'}
                onToggle={() => togglePicker('emotionRatio')}
                onClose={closePicker}
                onSelect={(v) =>
                  onEvent({ type: 'setRatio', ratio: v, recipe: recipeSnapshot({ ratio: v }) })
                }
              />
              <ParamPicker
                name="emotionCount"
                ariaLabel="生成数量"
                label={
                  videoMode ? `${videoCount} 个` : `${count} 张`
                }
                options={(videoMode ? videoCounts : countChoices).map((c) => ({
                  value: String(c),
                  label: videoMode ? `${c} 个` : `${c} 张`,
                }))}
                value={String(videoMode ? videoCount : count)}
                variant="pill"
                open={openPicker === 'emotionCount'}
                onToggle={() => togglePicker('emotionCount')}
                onClose={closePicker}
                onSelect={(v) =>
                  onEvent({
                    type: 'setCount',
                    count: Number(v),
                    recipe: recipeSnapshot({ count: Number(v) }),
                  })
                }
              />
            </>
          }
        />
      )}

      {/* 第二部分：提示词 */}
      <section className={`${styles.section} ${styles.promptSection}`} data-panel-part="prompt">
        <div className={styles.promptRow}>
          {/*
            提示词那一行的头：左边「上游已链接提示词节点」、右边 `@` 按钮。

            `@` 挂在**这一行**而不是浮在文字框上：浮上去会盖住正文第一行的末尾
            （面板里文字是 16px、行宽固定，盖住一个字用户就得挪光标去看）。
          */}
          {(model.linkedPromptCount > 0 || mentionCandidates.length > 0) && (
            <div className={styles.promptHead}>
              {model.linkedPromptCount > 0 && (
                <span className={styles.linked} data-panel-linked-prompt>
                  上游已链接提示词节点 {model.linkedPromptCount}
                </span>
              )}
              {mentionCandidates.length > 0 && (
                <button
                  type="button"
                  className={styles.mentionOpen}
                  data-panel-mention-open
                  title="引用上游素材（@）"
                  aria-label="引用上游素材"
                  aria-expanded={mentionOpen}
                  onClick={() => {
                    /** 与预设菜单互斥：两个浮层同时开着会互相盖住 */
                    closePresetMenus()
                    setMentionOpen((v) => !v)
                  }}
                >
                  @
                </button>
              )}
            </div>
          )}
          {/*
            当前预设（用户 2026-10-05 第 14 条，参考图五）：左边名称 + 切换箭头，
            右边那行是**示例小字**（只是说明，不进提示词 —— 用户原话「不是真实的小字」）。
            名称左侧的 ✕ = 取消这个预设。
          */}
          {activePreset && !promptMode && (
            <div className={styles.presetRow} data-panel-preset-row={activePreset.id}>
              <span className={styles.presetChip}>
                <button
                  type="button"
                  className={styles.presetClear}
                  data-panel-preset-clear
                  title="取消预设"
                  aria-label="取消预设"
                  onClick={() => {
                    closePresetMenus()
                    onEvent({ type: 'setPreset', preset: null })
                  }}
                >
                  <IconClose size={12} />
                </button>
                <button
                  type="button"
                  className={styles.presetName}
                  data-panel-preset-open
                  aria-haspopup="menu"
                  aria-expanded={presetOpen}
                  title="换一个预设"
                  onClick={() => {
                    setMentionOpen(false)
                    setPresetOptionsOpen(false)
                    setPresetOpen((v) => !v)
                  }}
                >
                  {activePreset.name}
                  <IconChevronDown size={12} />
                </button>
                {activePreset.options && (
                  <button
                    type="button"
                    className={styles.presetGear}
                    data-panel-preset-gear
                    title="选择具体搭配"
                    aria-label="选择具体搭配"
                    aria-expanded={presetOptionsOpen}
                    onClick={() => {
                      setMentionOpen(false)
                      setPresetOpen(false)
                      setPresetOptionsOpen((v) => !v)
                    }}
                  >
                    <IconSettings size={12} />
                  </button>
                )}
              </span>
              <span className={styles.presetHint}>{activePreset.hint}</span>
            </div>
          )}
          {/*
            提示词框 = 带引用的富文本框（用户 2026-10-05 第 15 条）。

            它仍然是**同一个 `[data-panel-prompt]`**：既有冒烟、探针都按这个锚点打字，
            换组件不该让它们集体失灵。`.prompt` 那组样式（含细滚动条）照旧挂在它身上 ——
            contenteditable 与 textarea 在「字多大、边距多少」上没有差别，
            只有「高度跟内容长」这一条需要 `autoGrow`（textarea 有 `field-sizing`）。
          */}
          <MentionEditor
            ref={promptEditorRef}
            className={`${styles.prompt} ${styles.promptEditor}`}
            anchorAttr={{ 'data-panel-prompt': '' }}
            label={promptMode ? '提示词节点正文' : '生成提示词'}
            autoGrow
            value={promptValue}
            placeholder={
              promptMode
                ? '输入提示词（下游生成节点读的就是这里）'
                : '输入提示词，或连线上游提示词节点'
            }
            /** 存回去的是**纯文本**（引用形态在这里还原成 `@名字`，见 mentionValue.ts） */
            onChange={(next) => onPromptChange(collapseMentions(next))}
            /** 刚打出 `@` → 开候选（参考对话窗那套交互） */
            onMentionTrigger={() => {
              if (mentionCandidates.length > 0) setMentionOpen(true)
            }}
            thumbOf={mentionThumbOf}
            thumbVersion={mentionThumbVersion}
            /* 失焦立即落库，不等那 300ms —— 用户点走就是「我打完了」 */
            onBlur={() => {
              if (!promptTimer.current) return
              clearTimeout(promptTimer.current)
              promptTimer.current = null
              onEvent({ type: 'setPrompt', text: promptDraft })
            }}
          />
          {mentionOpen && (
            <div className={styles.mentionMenu} data-panel-mention-menu>
              <div className={styles.mentionHint}>引用本节点上游的素材</div>
              {mentionCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={styles.mentionItem}
                  data-panel-mention={c.id}
                  onClick={() => insertMention(c)}
                >
                  <MentionThumb hash={mentionHashOf.get(c.id)} />
                  <span className={styles.mentionName} title={c.label}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          {/*
            chip 上的缩略图：编辑器里那些 chip 是**命令式建的 DOM**、拿不到 hook，
            所以由宿主替它们取图。一个候选渲染一个不可见的取图探针（一个候选一个
            组件实例 ⇒ hook 规则安全），取到就写进 map、再用版本号通知编辑器
            **就地**把图补进 chip 的槽位（与对话窗那套同一招）。
          */}
          {mentionCandidates.map((c) => (
            <MentionThumbProbe
              key={c.id}
              id={c.id}
              hash={mentionHashOf.get(c.id)}
              sink={mentionThumbRef}
              onLoaded={() => setMentionThumbVersion((v) => v + 1)}
            />
          ))}
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

        {/*
          「模型」与后面那串参数是**两件事**：前者决定这次发给谁，后者决定怎么发。
          六个 chip 平铺时它们看起来是同一类东西 —— 一条竖线就把这句话说明白了
          （与「技能 / 优化 / 翻译」那组用的是同一个做法，见 `.toolGroup::before`）。
        */}
        {!promptMode && <span className={styles.paramDivider} data-param-divider aria-hidden="true" />}

       {!promptMode && (
          <>
            {videoMode ? (
              <>
                {/*
                  生成模式（用户 2026-10-03 图四/图五/图七/图九）：参考实现里那枚
                  「视频生成模式」下拉，逐档照抄 —— 包括「超长视频 Beta」的角标，
                  以及「文生视频 / 视频编辑」那种**看得见但选不了**的灰项。
                */}
                {showVideoMode && (
                  <ParamPicker
                    name="videoMode"
                    ariaLabel="视频生成模式"
                    label={VIDEO_MODE_LABELS[videoModeValue].label}
                    options={videoModeOptions}
                    value={videoModeValue}
                    variant="list"
                    open={openPicker === 'videoMode'}
                    onToggle={() => togglePicker('videoMode')}
                    onClose={closePicker}
                    onSelect={(v) =>
                      onEvent({
                        type: 'setVideoMode',
                        videoMode: v,
                        recipe: recipeSnapshot({ videoMode: v }),
                      })
                    }
                  />
                )}
                {/* 比例：**视频模式**仍自己一枚（图片模式已并进「生成参数」胶囊，见下） */}
                <ParamPicker
                  name="ratio"
                  ariaLabel="画面比例"
                  label={shownRatio || '比例'}
                  options={ratios.map((r) => ({
                    value: r,
                    /* 「自适应」不是宽高比，画矩形示意只会和 1:1 撞脸 —— 只留文字 */
                    label: isAutoRatio(r) ? '自适应' : r,
                  }))}
                  value={shownRatio}
                  variant="ratioGrid"
                  open={openPicker === 'ratio'}
                  onToggle={() => togglePicker('ratio')}
                  onClose={closePicker}
                  onSelect={(v) => onEvent({ type: 'setRatio', ratio: v, recipe: recipeSnapshot({ ratio: v }) })}
                />
                {/* 清晰度：竖版列表（§6.8 视频模式） */}
                <ParamPicker
                  name="size"
                  ariaLabel="视频清晰度"
                  label={sizeLabel}
                  options={sizeChoices}
                  value={sizeValue}
                  variant="list"
                  open={openPicker === 'size'}
                  onToggle={() => togglePicker('size')}
                  onClose={closePicker}
                  onSelect={(v) => onEvent({ type: 'setSize', size: v, recipe: recipeSnapshot({ size: v }) })}
                />
                {/*
                  时长：滑块 + 可直接键入（§6.8）。
                  区间按模型走 —— 图三 4–15、图六 4–30、图八/图十 5–15。
                */}
                {showDuration && (
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
                )}
                {/* 生成音频（图三/图六那枚「开启 / 关闭」）：只有声明支持的模型才摆 */}
                {showGenerateAudio && (
                  <ParamPicker
                    name="generateAudio"
                    ariaLabel="生成音频"
                    label={generateAudio ? '生成音频 · 开' : '生成音频 · 关'}
                    options={[
                      { value: 'on', label: '开启' },
                      { value: 'off', label: '关闭' },
                    ]}
                    value={generateAudio ? 'on' : 'off'}
                    variant="pill"
                    open={openPicker === 'generateAudio'}
                    onToggle={() => togglePicker('generateAudio')}
                    onClose={closePicker}
                    onSelect={(v) =>
                      onEvent({
                        type: 'setGenerateAudio',
                        generateAudio: v === 'on',
                        recipe: recipeSnapshot({ generateAudio: v === 'on' }),
                      })
                    }
                  />
                )}
                {/* 生成数量（图三/图六/图八/图十那排 1/2/4）：只有一档时整段不摆 */}
                {showVideoCount && (
                  <ParamPicker
                    name="count"
                    ariaLabel="生成数量"
                    label={`${videoCount} 个`}
                    options={videoCounts.map((c) => ({ value: String(c), label: `${c} 个` }))}
                    value={String(videoCount)}
                    variant="pill"
                    open={openPicker === 'count'}
                    onToggle={() => togglePicker('count')}
                    onClose={closePicker}
                    onSelect={(v) =>
                      onEvent({
                        type: 'setCount',
                        count: Number(v),
                        recipe: recipeSnapshot({ count: Number(v) }),
                      })
                    }
                  />
                )}
              </>
            ) : (
              /*
                图片模式：**比例 · 画质 · 质量 · 张数**收进一枚胶囊
                （用户 2026-10-02 参考产品图五 / 图六：「把比例，质量，画质，张数变成
                一个胶囊显示，而且点击显示的面板……把所有的参数都放上去」）。

                分段的名字仍是 `ratio / resolution / quality / count` —— 冒烟与单测的
                锚点不必重学，只是从「四枚 chip」变成「一层的四段」。
                选完**不关**（多组模式）：调参数常常一次要动两三样，每选一格就收起
                会逼人重复点开三次。
              */
              /**
               * 一段都没有的模型（Nano Banana：只有 prompt 有参数）**整枚 chip 都不摆** ——
               * 摆一个点开空空如也的「参数」比不摆更让人以为坏了（用户 2026-10-03
               * 「不要通用设置」的同一条道理：没有的东西别装出来）。
               */
              paramSections.length > 0 ? (
              <ParamPicker
                name="gen-params"
                ariaLabel={`生成参数（${paramsLabel}）`}
                label={paramsLabel}
                sections={paramSections}
                open={openPicker === 'gen-params'}
                onToggle={() => togglePicker('gen-params')}
                onClose={closePicker}
              />
              ) : null
            )}
            {/*
              **Midjourney 的高级设置**（用户 2026-10-03 图二：
              「把 mj 的自己独有的参数设置面板做一个，放在参数的后面」）。

              位置就在参数那一枚**之后**、生成按钮之前 —— 它是风格，不是每次都要动的量，
              所以另起一枚而不是塞进「生成参数」胶囊里。
            */}
            {isMj && (
              <ParamPicker
                name="mj-params"
                ariaLabel="Midjourney 高级设置"
                label="高级设置"
                sections={mjSections}
                open={openPicker === 'mj-params'}
                onToggle={() => togglePicker('mj-params')}
                onClose={closePicker}
              />
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
        {/*
          预设入口（用户 2026-10-05 第 14 条：「在节点参数右边加一个预设功能的按钮」）：
          位置就在参数与生成按钮之间。菜单挂在这枚按钮的容器里 ——
          它是面板里唯一的位置锚点，两个入口（这枚按钮、预设名称上的箭头）都开在同一个地方，
          用户不会遇到「同一个菜单从两个方向弹出来」。
        */}
        {!promptMode && (
          <span className={styles.presetAnchor}>
            <button
              type="button"
              className={activePreset ? `${styles.presetBtn} ${styles.presetBtnOn}` : styles.presetBtn}
              data-panel-preset
              aria-label="预设"
              aria-haspopup="menu"
              aria-expanded={presetOpen}
              title="预设：分镜叙事 / 空间与机位 / 设定图 / 质感调节"
              onClick={() => {
                setMentionOpen(false)
                setPresetOptionsOpen(false)
                setPresetOpen((v) => !v)
              }}
            >
              <IconPreset size={16} />
              {activePreset && <span className={styles.presetDot} data-preset-dot />}
            </button>
            {presetOpen && (
              <PresetMenu
                activeId={model.preset}
                emotionOn={emotionOn}
                onPick={(id) => {
                  setPresetOpen(false)
                  onEvent({ type: 'setPreset', preset: id })
                }}
                onPickEmotion={() => {
                  closePresetMenus()
                  /** 打开情绪面板 = 先落一个情绪（默认正中间那个），面板由它决定显示与否 */
                  onEvent({ type: 'setEmotion', emotion: model.emotion ?? DEFAULT_EMOTION_ID })
                }}
              />
            )}
            {presetOptionsOpen && activePreset?.options && (
              <PresetOptions
                presetId={activePreset.id}
                options={model.presetOptions}
                onPick={(group, choice) =>
                  /** 选完**不关**：五组搭配通常要连着调（参考图十九就是一屏五组） */
                  onEvent({ type: 'setPresetOption', group, choice })
                }
              />
            )}
          </span>
        )}
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
          {props.running ? (
            <IconStop size={18} />
          ) : busyGlobal ? (
            <IconSpinner size={20} />
          ) : (
            <RunArrow />
          )}
        </button>
        {props.error && <span className={styles.error}>{props.error}</span>}
      </section>
    </div>
  )
}

/**
 * `@` 候选行左边那块小缩略图。
 *
 * 与 chip 上那张图是**两条路**：chip 的图由编辑器按 `thumbOf` 就地补（它是命令式 DOM）；
 * 这里是普通 React 行，直接用 `useAsset` 拿 objectURL 就行 —— 别为了「统一」把
 * 菜单也做成命令式，那只会多一份要维护的 DOM。
 */
function MentionThumb({ hash }: { hash: string | undefined }) {
  const url = useAsset(hash)
  return <span className={styles.mentionThumb}>{url ? <img src={url} alt="" /> : null}</span>
}

/**
 * 不可见的取图探针（见调用处那段说明）。
 *
 * 存在的唯一理由是**hook 规则**：候选是运行期才定的，不能在一个组件里按数量循环
 * 调 `useAsset`。一个候选一个实例就绕开了这件事，而且取到的还是同一个
 * `useAsset`（缩略图行用的那条路），不另开一套取图逻辑。
 */
function MentionThumbProbe({
  id,
  hash,
  sink,
  onLoaded,
}: {
  id: string
  hash: string | undefined
  sink: { current: Map<string, string> }
  onLoaded: () => void
}) {
  const url = useAsset(hash)
  useEffect(() => {
    if (!url || sink.current.get(id) === url) return
    sink.current.set(id, url)
    onLoaded()
  }, [id, url, sink, onLoaded])
  return null
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
          <IconClose size={12} />
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
