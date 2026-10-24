import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { noticeA11y, type NoticeTone } from '../../domain/ui/notice'
import {
  channelCapabilities,
  maskTokenTail,
  protocolLabel,
  protocolShort,
  type Channel,
} from '../../domain/project/channel'
import {
  CAPABILITY_LABEL,
  protocolById,
  type ProtocolCapability,
  type ProtocolKind,
} from '../../domain/project/protocol'
import {
  applySelection,
  CATEGORY_FILTERS,
  categoryLabel,
  filterModels,
  groupModelsByCategory,
  initialChecked,
  removeModel,
  routeMapOptions,
  type CategoryFilter,
} from '../../domain/project/modelSelection'
import styles from './SettingsPage.module.css'
import {
  ROUTE_STRATEGIES,
  type RouteStrategy,
} from '../../domain/project/modelRouting'
import type { PresetModel, PresetVendor } from '../../domain/project/modelPresets'
import type { ModelCapability } from '../../domain/shared/capability'
import { ModelIcon } from '../../features/shared/modelIcon/ModelIcon'
import { ChannelIcon } from '../../features/shared/channelIcon/ChannelIcon'
import { readChannelIconFile } from '../../features/shared/channelIcon/readIconFile'
import { isBuiltinChannelId } from '../../domain/project/builtinChannels'
import { ModelMapCombo, StrategyPicker } from './SettingsPicker'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import {
  IconDelete,
  IconEdit,
  IconFilter,
  IconGear,
  IconGrip,
  IconImageUpload,
  IconMoreVertical,
  IconResetAvatar,
  IconSearch,
  IconClose,
  IconChannels,
} from '../../app/SettingsIcons'
import { hasChannelBrandIcon } from '../../features/shared/channelIcon/ChannelIcon'

/**
 * 模型映射区的**五个筛选**（用户 2026-10-08 第 1 条：「图一这个模型映射的地方换成五个筛选吧，
 * 目前是生图，对话，视频放在一起的，加上音频，3d」）。
 *
 * 与上一版（三组平铺、一屏 15 行）的区别：一次只显示**一类**，行数从 15 压到 7 行以内。
 *
 * ⚠️ 后两档（音频 / 3D）是**预留位**：前端固定清单 `PRESET_MODELS` 目前只有
 * `image | chat | video` 三种类别，所以点开会看到"这一类还没有模型"——
 * 等清单里加上音频 / 3D 的显示名，这里**自动**就有内容（不必回来改代码）。
 * 这也是为什么筛选键用 `string` 而不是去扩 `ModelCapability['category']`：
 * 扩那个联合要动渠道拉取 / 选路 / 画布面板一整条链，而清单里现在并没有那两类模型。
 */
const MAP_FILTERS = [
  { key: 'image', title: '生图' },
  { key: 'chat', title: '对话' },
  { key: 'video', title: '视频' },
  { key: 'audio', title: '音频' },
] as const

type MapFilterKey = (typeof MAP_FILTERS)[number]['key']

type ChannelFilterKey = 'all' | 'enabled' | 'disabled'

const CHANNEL_FILTER_OPTIONS: { value: ChannelFilterKey; label: string }[] = [
  { value: 'all', label: '全部服务商' },
  { value: 'enabled', label: '仅已启用' },
  { value: 'disabled', label: '仅已禁用' },
]

function channelInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

function channelMonogramTone(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return hash % 6
}

function measureProfileDrawerBounds() {
  const rect = document
    .querySelector<HTMLElement>('[data-settings-editor]')
    ?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

const GLOBAL_MODEL_VENDORS: { value: PresetVendor; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'bytedance', label: '字节跳动' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'fal', label: 'fal' },
  { value: 'alibaba', label: '阿里' },
  { value: 'agnes', label: 'Agnes' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu', label: '智谱' },
  { value: 'tencent', label: '腾讯' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'xai', label: 'xAI' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'moonshot', label: 'Moonshot' },
  { value: 'baidu', label: '百度' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'perplexity', label: 'Perplexity' },
  { value: 'stability', label: 'Stability' },
  { value: 'runway', label: 'Runway' },
  { value: 'luma', label: 'Luma' },
  { value: 'ideogram', label: 'Ideogram' },
  { value: 'bfl', label: 'BFL' },
  { value: 'recraft', label: 'Recraft' },
  { value: 'kling', label: '可灵' },
  { value: 'suno', label: 'Suno' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'siliconcloud', label: '硅基流动' },
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'doubao', label: '豆包' },
  { value: 'volcengine', label: '火山引擎' },
  { value: 'flux', label: 'FLUX' },
  { value: 'jimeng', label: '即梦' },
]


/**
 * 协议下拉的分组顺序（用户 2026-09-28「一站一协议」）。
 *
 * 分组只影响**看见的顺序**，不影响行为：`kind` 与协议目录里的取值同字面。
 * 站点排在前是因为「一站一条渠道」之后，用户多数时候是在选具体站点；
 * 公开模板与旧协议往下放，避免它们挤掉最常用的那几条。
 */
const PROTOCOL_GROUPS: { kind: ProtocolKind; label: string }[] = [
  { kind: 'offline', label: '离线 / 测试' },
  { kind: 'station', label: '站点' },
  { kind: 'public', label: '公开协议' },
  { kind: 'legacy', label: '旧协议' },
  { kind: 'custom', label: '自定义协议' },
]

/**
 * 后台模型设置页（产品文档 §7）。
 * 左：渠道列表（可拖动排序）；右：选中渠道的配置（名称 / 地址 / 加密令牌 / 启用 / 协议 / 验证）
 * + 模型管理（§7.4：拉取 → 勾选 → 已选三行分组）。
 * 所有写操作经 useChannels() 的 channel store，直连 storage + 凭据层，不进画布 undo 栈。
 */
/**
 * **一行令牌**（用户第 22 批 #358：「RunningHub有两个令牌，一个是币的，一个是金额的，做在一个渠道里面」）。
 *
 * 为什么抽成组件：原来那段内联 JSX 只服务"一把钥匙"，再接一把就得复制一份 ——
 * 两份迟早分叉。这里按 `slot` 驱动，**协议声明了几把就渲染几行**。
 *
 * "已保存"的判据是外面传进来的**尾号**（`savedTail`）：它是 store 里的真相，
 * 组件自己不再存一份 `tokenSaved`；存完 / 删完由 store 变化把新尾号推下来。
 * 明文依旧只在保存那一瞬间经手（`saveToken` 之后本地清空输入框）。
 */
function ChannelTokenField({
  channels,
  channelId,
  slot,
  groupId,
  label,
  hint,
  required,
  docUrl,
  savedTail,
  saved,
}: {
  channels: ReturnType<typeof useChannels>
  channelId: string
  slot: 'primary' | 'alt'
  /** 有值时走渠道内 Key 分组；slot 只作为老双槽的兼容身份。 */
  groupId?: string
  label: string
  hint?: string
  required?: boolean
  docUrl: string
  /** 已保存令牌的尾 4 位；null = 这一槽没存过 */
  savedTail: string | null
  /**
   * **这一槽存过没有**（对账 #517）。
   *
   * 它是「已保存」的唯一判据；尾号只负责**显示成什么**。
   * 两者分开才不会把"存了但没有尾号的短令牌"显示成没保存
   * （短令牌没尾号是刻意设计：9 位上露 4 位等于把大半个密钥打在界面上）。
   */
  saved: boolean
}) {
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  /**
   * 「显示」那一刻从凭据层读回来的**明文**。
   *
   * 只活在这一屏：切回「隐藏」、保存、删除、换渠道都立刻丢掉（不落库、不进日志）。
   */
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const masked = savedTail ? maskTokenTail(savedTail) : ''
  /** 存过但没尾号时也要给一句看得见的确认，不能看起来像没保存 */
  const savedText = masked || (saved ? '已保存' : '')

  /** 换了渠道 / 换了槽位：把"已显示"这件事清掉，免得上一条的明文挂在新渠道上 */
  useEffect(() => {
    setShow(false)
    setRevealed(null)
  }, [channelId, slot, groupId])

  /**
   * 「显示 / 隐藏」（用户 2026-10-08 第 5 条：「渠道的令牌显示功能是不生效的」）。
   *
   * **为什么以前点了没反应**：它只切了输入框的 `type`，而已存的令牌从来只以
   * **打码占位符**出现（明文不进界面）⇒ 输入框里根本没有可显示的东西，切了也看不出变化。
   * 现在「显示」= **真去凭据层读一次**：输入框里是用户刚敲的就显示刚敲的，
   * 否则显示存好的那把（读回明文这条链路见 `channelStore.loadToken`）。
   */
  const toggleShow = async () => {
    if (show) {
      setShow(false)
      setRevealed(null)
      return
    }
    setBusy(true)
    try {
      const plain = groupId
        ? await channels.loadCredentialGroupToken(channelId, groupId)
        : await channels.loadToken(channelId, slot)
      setRevealed(token ? token : saved ? plain : null)
      setShow(true)
    } finally {
      setBusy(false)
    }
  }

  /** 显示态下编辑的是**明文那一份**；隐藏态下编辑的是"准备保存的新令牌" */
  const shownValue = show ? (revealed ?? token) : token
  const onTokenChange = (next: string) => {
    setToken(next)
    if (show) setRevealed(next)
  }

  const save = async () => {
    if (!token) return
    setBusy(true)
    try {
      if (groupId) await channels.saveCredentialGroupToken(channelId, groupId, token)
      else await channels.saveToken(channelId, token, slot)
      setToken('')
      /* 存完回到"打码占位"的常态：明文不再留在界面上 */
      setShow(false)
      setRevealed(null)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      if (groupId) await channels.removeCredentialGroupToken(channelId, groupId)
      else await channels.removeToken(channelId, slot)
      setToken('')
      setShow(false)
      setRevealed(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.field} data-settings-token-row={groupId ?? slot}>
      <span className={styles.labelRow}>
        <span className={styles.label}>
          {label}
          {required && <span className={styles.tokenRequired}>必填</span>}
        </span>
        {docUrl && (
          <a
            className={styles.docLink}
            data-settings-doc-link={groupId ?? slot}
            href={docUrl}
            target="_blank"
            rel="noreferrer"
          >
            去官网获取令牌
          </a>
        )}
      </span>
      <div className={styles.tokenRow}>
        <input
          className={styles.input}
          data-settings-token-tail={groupId ?? slot}
          type={show ? 'text' : 'password'}
          /**
           * 已存过时，输入框**直接显示存好的那一把（中间打码）**（用户第 19 批 #3、
           * 参考图五 `••••••••Sm3a`）。用 `placeholder` 不是 `value`：整串明文不进界面，
           * 放进 value 的话用户一按保存就会把那串圆点当成新令牌存进去。
           */
          placeholder={saved ? savedText : '粘贴 API Key'}
          value={shownValue}
          onChange={(e) => onTokenChange(e.target.value)}
        />
        <button
          className={styles.ghostBtn}
          data-settings-token-reveal={groupId ?? slot}
          /* 既没存过、输入框也是空的 ⇒ 没有东西可显示（不给"按下去没反应"的按钮） */
          disabled={busy || (!saved && !token)}
          onClick={() => void toggleShow()}
        >
          {show ? '隐藏' : '显示'}
        </button>
        <button
          className={styles.ghostBtn}
          data-settings-token-save={groupId ?? slot}
          disabled={!token || busy}
          onClick={() => void save()}
        >
          保存
        </button>
        <button
          className={styles.ghostBtn}
          data-settings-token-remove={groupId ?? slot}
          disabled={!saved || busy}
          onClick={() => void remove()}
        >
          删除
        </button>
      </div>
      {hint && <span className={styles.cardSub}>{hint}</span>}
    </div>
  )
}

function SettingsChannelAvatar({
  channelId,
  protocol,
  icon,
  name,
  size,
}: {
  channelId?: string
  protocol: string
  icon?: string | null
  name: string
  size: number
}) {
  if (icon || hasChannelBrandIcon(protocol)) {
    return <ChannelIcon protocol={protocol} icon={icon} size={size} />
  }
  return (
    <span
      className={`${styles.channelMonogram} ${styles[`monogramTone${channelMonogramTone(name)}`]}`}
      data-channel-monogram={channelId}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.4)) }}
      aria-hidden
    >
      {channelInitial(name)}
    </span>
  )
}

export function SettingsPage() {
  const channels = useChannels()
  const channelsList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const customModels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customModels,
    () => channels.getState().customModels,
  )
  const uncommonModelIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().uncommonModelIds,
    () => channels.getState().uncommonModelIds,
  )
  const allGlobalModels = useMemo(
    () =>
      (['image', 'chat', 'video', 'audio'] as const).flatMap((category) =>
        channels.globalModelsOf(category, true),
      ),
    [channels, customModels, uncommonModelIds],
  )
  const verify = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().verify,
    () => channels.getState().verify,
  )
  const modelsResult = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().models,
    () => channels.getState().models,
  )
  const detect = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().detect,
    () => channels.getState().detect,
  )
  const customProtocols = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customProtocols,
    () => channels.getState().customProtocols,
  )
  /** 全局选路策略（用户 2026-09-29 第 12 轮）：与选中的渠道无关 */
  const routeStrategy = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().routeStrategy,
    () => channels.getState().routeStrategy,
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [channelMenu, setChannelMenu] = useState<{
    channelId: string
    x: number
    y: number
  } | null>(null)
  const [menuConfirmDelete, setMenuConfirmDelete] = useState(false)
  const channelMenuRef = useRef<HTMLDivElement | null>(null)
  const [channelSearch, setChannelSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<ChannelFilterKey>('all')
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false)
  const [profileDrawerBounds, setProfileDrawerBounds] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [profileIconDraft, setProfileIconDraft] = useState<string | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const profileFileRef = useRef<HTMLInputElement | null>(null)
  const profileReturnFocusRef = useRef<HTMLElement | null>(null)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState('mock')
  const [baseUrl, setBaseUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  /** 令牌的输入 / 显示 / 已存状态都在 `ChannelTokenField` 里（一行一份，见上面的组件） */
  const [busy, setBusy] = useState(false)
  /**
   * 图标那一行的**结果话术**（对账 #396）：抓成功说抓到哪儿了，失败说为什么、
   * 下一步做什么。失败时不弹窗 —— 用户就在这一行上，话就该留在这儿。
   */
  /**
   * 上一次「验证地址 / 拉取模型 / 验证协议」是对**哪条渠道、哪个协议**做的。
   * 状态行据此显示协议名——否则「✓ 验证通过」在 mock 下与在真实中转下
   * 长得一模一样，用户根本无法判断这次到底出没出网（这正是把他坑住的那句话）。
   */
  const [verifiedFor, setVerifiedFor] = useState<{
    channelId: string
    protocol: string
    source: 'verify' | 'models' | 'detect'
  } | null>(null)

  // —— 选择模型面板（§7.4）——
  // 面板是**草稿态**：勾选先记在本地，点「应用到模型列表」才落库。
  // 这样中途取消（或点遮罩外）不会把半成品状态写进渠道——与画布「编辑中不落库」同一口径。
  const [panelOpen, setPanelOpen] = useState(false)
  const [draftChecked, setDraftChecked] = useState<ReadonlySet<string>>(new Set())
  const [draftCategory, setDraftCategory] = useState<CategoryFilter>('all')
  const [draftKeyword, setDraftKeyword] = useState('')

  /** 正在被拖动的渠道 id（§7.2 拖动排序） */
  const [dragId, setDragId] = useState<string | null>(null)
  /**
   * 映射表的草稿（M7-2）：`逻辑名 → 输入框里的值`。
   *
   * 为什么是草稿而不是「改一个存一个」：映射是**按渠道**的一整张表，
   * 逐条落库会让「改到一半」的状态被持久化（用户还没决定，库里已经变了）。
   * 与本页既有的渠道表单、模型选择面板同一口径（中途反悔不该留下半份改动）。
   * 切渠道时清空，避免把 A 站的上游 ID 带到 B 站。
   */
  const [mapDrafts, setMapDrafts] = useState<Record<string, string>>({})
  const mapSaveTimersRef = useRef(new Map<string, number>())
  const [mapSaveNotice, setMapSaveNotice] = useState<{
    id: string
    tone: 'ok' | 'error'
    text: string
  } | null>(null)
  const [modelAddOpen, setModelAddOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [newModelCategory, setNewModelCategory] =
    useState<PresetModel['category']>('image')
  const [newModelVendor, setNewModelVendor] = useState<PresetVendor>('openai')
  const [showUncommonModels, setShowUncommonModels] = useState(false)
  const [mapTests, setMapTests] = useState<
    Record<string, { status: 'checking' | 'ok' | 'missing' | 'error'; message: string }>
  >({})

  /**
   * 映射区当前看的**哪一类**（用户 2026-10-08 第 1 条：五个筛选）。
   * 默认「生图」——绝大多数人第一条渠道就是为了出图。
   * 刻意**不随切渠道复位**：用户在比对两条渠道的同一类映射时，来回切渠道不必重新点筛选项。
   */
  const [mapCategory, setMapCategory] = useState<MapFilterKey>('image')

  /**
   * 协议目录版本号。`protocolCatalog()` 每次返回**新对象**，但 useSyncExternalStore
   * 只在 store 快照变化时重渲染；自建协议增删后靠这个计数把目录重算一遍，
   * 让新协议立刻出现在下拉里（不必刷新页面）。
   */
  const [catalogVersion, setCatalogVersion] = useState(0)
  const catalog = useMemo(() => channels.protocolCatalog(), [channels, catalogVersion])
  const platform = usePlatform()
  /** 桌面壳里才有本机命令（对账 #308）：状态行文案据此区分"本机命令"与"地址" */
  const hasLocalCli = platform.cli != null
  /** 抓站点图标要原生 HTTP（对账 #396）：浏览器里跨域读不到，按钮据此如实禁用 */
  /** 下拉里的全部协议（含 pending：它们显示为“待支持”且不可选，见协议区渲染） */
  const protocolOptions = catalog.all
  /** 当前所选协议的说明（CLI 网关等有前提的协议必须显示出来，否则用户会填错地址） */
  const selectedProtocolNote = protocolById(protocol, catalog)?.note ?? ''
  /**
   * 旧协议（`openai-images` / `openai-chat`）**只在当前渠道本身就是它时才出现**（用户 2026-09-29「不要重复的东西」）。
   *
   * 这两个 id 不能从目录里删：老渠道存的就是它们，删了会变成「未知协议」、
   * 适配器也认不出族（`registry.ts` 的 `LEGACY_FAMILY` 正是靠它们兜底）。
   * 但新渠道不该再选到 —— 它们与「OpenAI 兼容」是同一套适配器，只是能力被写死成单项。
   */
  const visibleProtocolOptions = protocolOptions.filter(
    /*
     * `hidden`（对账 #308）：CLI / RunningHub 四条已搬到「全局设置 → CLI」，
     * 新渠道的下拉里不再出现；但**当前渠道正在用的那条**仍要留着 ——
     * 否则老渠道一打开下拉就是空白，用户以为协议丢了。
     */
    (p) => (p.kind !== 'legacy' && p.kind !== 'hidden') || p.id === protocol,
  )
  /**
   * 还留在**渠道下拉**里的待支持协议。`hidden` 的不算 —— 它们已经搬到
   * 「全局设置 → CLI」（对账 #308），再在这儿列一遍就成了两个说法。
   */
  const pendingProtocols = protocolOptions.filter(
    (p) => p.status === 'pending' && p.kind !== 'hidden',
  )

  // —— 添加自定义协议（用户 2026-09-28）：只开放 OpenAI 兼容族的对话 / 生图声明 ——
  const [newProtoOpen, setNewProtoOpen] = useState(false)
  const [npName, setNpName] = useState('')
  const [npShort, setNpShort] = useState('')
  const [npId, setNpId] = useState('')
  const [npCaps, setNpCaps] = useState<ProtocolCapability[]>(['chat', 'image'])
  const [npBaseUrl, setNpBaseUrl] = useState('')
  const [npVersionPath, setNpVersionPath] = useState('/v1')
  const [npDocUrl, setNpDocUrl] = useState('')
  const [npError, setNpError] = useState('')
  const [npNotice, setNpNotice] = useState('')
  const [protoRemoveError, setProtoRemoveError] = useState('')

  useEffect(() => {
    void channels.load()
  }, [channels])

  const selected = useMemo(
    () => channelsList.find((c) => c.id === selectedId) ?? null,
    [channelsList, selectedId],
  )
  const visibleChannels = useMemo(() => {
    const keyword = channelSearch.trim().toLocaleLowerCase()
    return channelsList.filter((channel) => {
      if (channelFilter === 'enabled' && !channel.enabled) return false
      if (channelFilter === 'disabled' && channel.enabled) return false
      if (!keyword) return true
      return (
        channel.name.toLocaleLowerCase().includes(keyword) ||
        protocolShort(channel.protocol, catalog).toLocaleLowerCase().includes(keyword)
      )
    })
  }, [catalog, channelFilter, channelSearch, channelsList])
  const selectedKeyGroups = useMemo(
    () =>
      [...(selected?.credentialGroups ?? [])].sort(
        (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
      ),
    [selected],
  )
  const activeGroup =
    selectedKeyGroups.find((group) => group.id === activeGroupId) ??
    selectedKeyGroups[0] ??
    null
  const activeModels = activeGroup?.models ?? selected?.models ?? []
  const activeModelCache = activeGroup?.modelCache ?? selected?.modelCache ?? []

  // 选中变化 → 同步表单。
  //
  // 依赖**刻意只放 `selectedId`**，不跟随 `selected`：表单是「这条渠道」的初始化，
  // 而 store 每次落库（验证回写 modelCache、启用开关回写 enabled）都会产生新的渠道对象。
  // 若跟着 `selected` 走，用户在下拉里刚选好的协议会被静默弹回库里旧值——
  // 表现为「刚切到 OpenAI 兼容，点一下别处就又变回 Mock」，且没有任何提示。
  useEffect(() => {
    const ch = channels.getState().channels.find((c) => c.id === selectedId) ?? null
    setPanelOpen(false)
    setChannelMenu(null)
    setMenuConfirmDelete(false)
    setMapDrafts({})
    setMapSaveNotice(null)
    setMapTests({})
    for (const timer of mapSaveTimersRef.current.values()) window.clearTimeout(timer)
    mapSaveTimersRef.current.clear()
    if (!ch) return
    const groups = [...ch.credentialGroups].sort(
      (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
    )
    setActiveGroupId(groups[0]?.id ?? null)
    setName(ch.name)
    setProtocol(ch.protocol)
    setBaseUrl(ch.baseUrl)
    setEnabled(ch.enabled)
  }, [selectedId, channels])

  useEffect(() => {
    if (!channelMenu) return
    const focusTimer = window.setTimeout(() => {
      channelMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }, 0)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-channel-context-menu]')) return
      setChannelMenu(null)
      setMenuConfirmDelete(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setChannelMenu(null)
      setMenuConfirmDelete(false)
    }
    const close = () => {
      setChannelMenu(null)
      setMenuConfirmDelete(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [channelMenu, menuConfirmDelete])

  useEffect(() => {
    if (!profileDrawerOpen) return
    const syncBounds = () => setProfileDrawerBounds(measureProfileDrawerBounds())
    syncBounds()
    const focusTimer = window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('[data-settings-profile-name]')?.focus()
    }, 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setProfileDrawerOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const drawer = document.querySelector<HTMLElement>('[data-settings-profile-drawer]')
      if (!drawer) return
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', syncBounds)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', syncBounds)
      profileReturnFocusRef.current?.focus()
    }
  }, [profileDrawerOpen])

  useEffect(() => {
    if (mapSaveNotice?.tone !== 'ok') return
    const timer = window.setTimeout(() => setMapSaveNotice(null), 1200)
    return () => window.clearTimeout(timer)
  }, [mapSaveNotice])

  useEffect(
    () => () => {
      for (const timer of mapSaveTimersRef.current.values()) window.clearTimeout(timer)
      mapSaveTimersRef.current.clear()
    },
    [],
  )

  const handleCreate = async () => {
    const ch = await channels.create({ name: '新建服务', protocol: 'mock', baseUrl: '' })
    setChannelFilter('all')
    setChannelSearch('')
    setSelectedId(ch.id)
  }

  const handleEnableChange = async (next: boolean) => {
    if (!selectedId) return
    setEnabled(next)
    try {
      await channels.setEnabled(selectedId, next)
    } catch (error) {
      setEnabled(!next)
      alert(error instanceof Error ? error.message : '保存启用状态失败')
    }
  }

  /** 图片上传进入抽屉草稿，只有点“保存”才写库。 */
  const handleProfileIconFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setProfileIconDraft(await readChannelIconFile(file))
    } catch {
      alert('这张图片读不出来，换一张试试')
    }
  }

  const saveProfileDrawer = async () => {
    if (!selectedId) return
    setProfileSaving(true)
    try {
      const nextName = profileNameDraft.trim() || selected?.name || '未命名服务'
      const saved = await channels.update(selectedId, {
        name: nextName,
        icon: profileIconDraft,
      })
      setName(saved.name)
      setProfileNameDraft(saved.name)
      setProfileIconDraft(saved.icon)
      setProfileDrawerOpen(false)
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存失败')
    } finally {
      setProfileSaving(false)
    }
  }

  /** 表单字段 → 落库值（名兜底、地址去空白以库为准） */
  const syncForm = (ch: Channel) => {
    setName(ch.name)
    setProtocol(ch.protocol)
    setBaseUrl(ch.baseUrl)
    setEnabled(ch.enabled)
  }

  /** 把表单**当前内容**落库，返回落库后的渠道。 */
  const persistForm = async (): Promise<Channel> => {
    const saved = await channels.update(selectedId!, {
      name: name.trim() || '新建服务',
      protocol,
      baseUrl: baseUrl.trim(),
      enabled,
    })
    syncForm(saved)
    return saved
  }

  const handleVerify = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      // 先落库、再验证：`verify` 用的是**库里**的 protocol。
      // 只改了下拉就直接点「验证地址」，会静默拿旧协议去验——协议还停在 mock 时
      // 表现为「秒过」却完全没出网，地址填了也白填。
      await persistForm()
      setVerifiedFor({ channelId: selectedId, protocol, source: 'verify' })
      await channels.verify(selectedId, activeGroup?.id)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 「验证协议」（§7.3）：逐个试打候选协议，把命中的那个填进「协议」并落库。
   *
   * 存在的意义是**别让用户猜**：他手里只有一个地址，未必知道该选中继的哪一项协议；
   * 猜错的表现是 404 —— 而 404 看起来和「地址填错」一模一样，无从分辨。
   */
  const handleDetect = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      // 与「验证地址」同一口径：先落库，探测打的是库里的 baseUrl。
      await persistForm()
      setVerifiedFor({ channelId: selectedId, protocol, source: 'detect' })
      const hit = await channels.detectProtocol(selectedId, activeGroup?.id)
      // 同步回表单。探测的全部意义就是替用户把「协议」这一格填对；
      // 只在库里写、表单不动，用户看到的下拉还是旧值，等于没自动选。
      if (hit) setProtocol(hit)
    } finally {
      setBusy(false)
    }
  }

  const handleRefresh = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await persistForm()
      setVerifiedFor({ channelId: selectedId, protocol, source: 'models' })
      await channels.refreshModels(selectedId, activeGroup?.id)
    } finally {
      setBusy(false)
    }
  }

  const openChannelMenu = (channelId: string, x: number, y: number) => {
    setChannelMenu({ channelId, x, y })
    setMenuConfirmDelete(false)
  }

  const openChannelMenuFromButton = (
    event: Pick<ReactPointerEvent<HTMLButtonElement>, 'currentTarget' | 'stopPropagation'>,
    channelId: string,
  ) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    openChannelMenu(channelId, rect.right - 8, rect.bottom + 6)
  }

  const editChannel = (channelId: string) => {
    const channel = channels.getState().channels.find((item) => item.id === channelId)
    if (!channel) return
    profileReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProfileDrawerBounds(measureProfileDrawerBounds())
    setSelectedId(channelId)
    setProfileNameDraft(channel.name)
    setProfileIconDraft(channel.icon)
    setProfileDrawerOpen(true)
    setChannelMenu(null)
    setMenuConfirmDelete(false)
  }

  const handleRemove = async (channelId: string) => {
    if (isBuiltinChannelId(channelId)) return
    setBusy(true)
    try {
      await channels.remove(channelId)
      if (selectedId === channelId) setSelectedId(null)
      setChannelMenu(null)
      setMenuConfirmDelete(false)
    } catch (err) {
      /** 内置渠道会被命令层拒绝（界面也已禁用）—— 如实说一句，别静默失败 */
      alert(err instanceof Error ? err.message : '删除失败')
      setMenuConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const handleAddKeyGroup = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const group = await channels.addCredentialGroup(selectedId)
      setActiveGroupId(group.id)
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveKeyGroup = async () => {
    if (!selectedId || !activeGroup) return
    if (!window.confirm(`删除 Key 分组「${activeGroup.name}」？这会同时删除该组 Key。`)) {
      return
    }
    setBusy(true)
    try {
      await channels.removeCredentialGroup(selectedId, activeGroup.id)
      const rest = selectedKeyGroups.filter((group) => group.id !== activeGroup.id)
      setActiveGroupId(rest[0]?.id ?? null)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const flushModelMapping = async (logicalName: string, upstreamId: string) => {
    if (!selectedId) return
    const timer = mapSaveTimersRef.current.get(logicalName)
    if (timer !== undefined) window.clearTimeout(timer)
    mapSaveTimersRef.current.delete(logicalName)
    try {
      await channels.setModelMapping(selectedId, logicalName, upstreamId)
      setMapDrafts((prev) => {
        if (prev[logicalName] !== upstreamId) return prev
        const next = { ...prev }
        delete next[logicalName]
        return next
      })
      setMapSaveNotice({ id: logicalName, tone: 'ok', text: '已保存' })
    } catch (error) {
      setMapSaveNotice({
        id: logicalName,
        tone: 'error',
        text: error instanceof Error ? error.message : '保存失败',
      })
    }
  }

  const scheduleModelMapping = (logicalName: string, upstreamId: string) => {
    const previous = mapSaveTimersRef.current.get(logicalName)
    if (previous !== undefined) window.clearTimeout(previous)
    setMapSaveNotice(null)
    const timer = window.setTimeout(() => {
      void flushModelMapping(logicalName, upstreamId)
    }, 600)
    mapSaveTimersRef.current.set(logicalName, timer)
  }

  const testModelMapping = async (logicalName: string, upstreamId: string) => {
    if (!selectedId) return
    setMapTests((prev) => ({
      ...prev,
      [logicalName]: { status: 'checking', message: '正在读取模型目录…' },
    }))
    try {
      await flushModelMapping(logicalName, upstreamId)
      const result = await channels.testModelMapping(
        selectedId,
        logicalName,
        upstreamId,
        activeGroup?.id,
      )
      setMapTests((prev) => ({
        ...prev,
        [logicalName]: { status: result.status, message: result.message },
      }))
    } catch (error) {
      setMapTests((prev) => ({
        ...prev,
        [logicalName]: {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }

  const handleAddGlobalModel = async () => {
    try {
      const model = await channels.addGlobalModel({
        name: newModelName,
        category: newModelCategory,
        vendor: newModelVendor,
      })
      setNewModelName('')
      setModelAddOpen(false)
      setMapCategory(model.category as MapFilterKey)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRemoveGlobalModel = async (name: string) => {
    if (!window.confirm(`删除前端模型「${name}」？各渠道里的同名映射会保留。`)) return
    try {
      await channels.removeGlobalModel(name)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  // —— 模型管理（§7.4）——

  const openPanel = () => {
    if (!selected) return
    // 打开时此前已选的保持勾上（§7.4「可再次打开面板勾选此前未选中的模型」）
    setDraftChecked(initialChecked(activeModels))
    setDraftCategory('all')
    setDraftKeyword('')
    setPanelOpen(true)
  }

  const toggleDraft = (modelId: string, on: boolean) => {
    setDraftChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(modelId)
      else next.delete(modelId)
      return next
    })
  }

  const applyDraft = async () => {
    if (!selectedId || !selected) return
    setBusy(true)
    try {
      await channels.setModels(
        selectedId,
        applySelection(activeModels, activeModelCache, draftChecked),
        activeGroup?.id,
      )
      setPanelOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const dropSelectedModel = async (modelId: string) => {
    if (!selectedId || !selected) return
    await channels.setModels(
      selectedId,
      removeModel(activeModels, modelId),
      activeGroup?.id,
    )
  }

  /** 拖动排序（§7.2）：把 dragId 挪到 targetId 的位置，整表重编号 */
  const dropOnChannel = async (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId) return
    const ids = channelsList.map((c) => c.id)
    const i = ids.indexOf(from)
    const j = ids.indexOf(targetId)
    if (i < 0 || j < 0) return
    ids.splice(j, 0, ...ids.splice(i, 1))
    await channels.reorder(ids)
  }

  const draftList = useMemo(
    () => (selected ? filterModels(activeModelCache, draftCategory, draftKeyword) : []),
    [activeModelCache, selected, draftCategory, draftKeyword],
  )
  const selectedGroups = useMemo(
    () => groupModelsByCategory(activeModels).filter((g) => g.models.length > 0),
    [activeModels],
  )

  /** 勾选 / 取消一项能力（视频无适配器，界面不提供该开关） */
  const toggleNewCap = (capability: ProtocolCapability, on: boolean) => {
    setNpCaps((prev) => {
      if (on) return prev.includes(capability) ? prev : [...prev, capability]
      return prev.filter((c) => c !== capability)
    })
  }

  /**
   * 协议下拉切换：选中带默认地址的站点协议时「选中即填地址」。
   *
   * 只覆盖两种情况——地址还是空的，或地址恰好**是上一条协议的默认地址**
   * （说明用户没动过它）。用户手填过的地址一律保留：切协议不该抹掉他刚敲进去的东西。
   * 站点类协议（玉玉 / 灵境 等）的地址就是靠这一步省掉「翻文档抄一遍」。
   */
  const handleProtocolChange = (id: string) => {
    const prevDefault = protocolById(protocol, catalog)?.defaultBaseUrl ?? ''
    const nextDefault = protocolById(id, catalog)?.defaultBaseUrl ?? ''
    setProtocol(id)
    const current = baseUrl.trim()
    const nextBaseUrl =
      nextDefault && (!current || current === prevDefault) ? nextDefault : baseUrl
    if (nextBaseUrl !== baseUrl) setBaseUrl(nextBaseUrl)
    if (selectedId) {
      void channels.update(selectedId, {
        protocol: id,
        baseUrl: nextBaseUrl.trim(),
      })
    }
  }

  /**
   * 添加自定义协议：走 store 的校验 + 落库，成功后把这条自动选中。
   *
   * 为什么不允许用户自建「异步任务 / CLI 网关」：那两族需要后端或本机命令，
   * 纯浏览器应用里填个地址也发不出去——放出来只会让用户配一条看着像配好了、
   * 实际跑不通的渠道。可自建的只有 OpenAI 兼容这一族的声明。
   */
  const handleCreateProtocol = async () => {
    setNpError('')
    setNpNotice('')
    const res = await channels.createCustomProtocol({
      id: npId,
      name: npName,
      short: npShort,
      capabilities: npCaps,
      baseUrl: npBaseUrl,
      versionPath: npVersionPath,
      docUrl: npDocUrl,
    })
    if (!res.ok) {
      setNpError(res.reason)
      return
    }
    setCatalogVersion((v) => v + 1)
    setProtocol(res.value.id)
    if (!baseUrl.trim() && res.value.defaultBaseUrl) setBaseUrl(res.value.defaultBaseUrl)
    setNpName('')
    setNpShort('')
    setNpId('')
    setNpCaps(['chat', 'image'])
    setNpBaseUrl('')
    setNpVersionPath('/v1')
    setNpDocUrl('')
    setNewProtoOpen(false)
    setNpNotice(`已添加「${res.value.name}」`)
  }

  /** 删除自建协议：仍被渠道引用时 store 会抛错，界面原样展示原因 */
  const handleRemoveProtocol = async (id: string) => {
    setProtoRemoveError('')
    try {
      await channels.removeCustomProtocol(id)
      setCatalogVersion((v) => v + 1)
    } catch (e) {
      setProtoRemoveError(e instanceof Error ? e.message : String(e))
    }
  }

  // 状态行只对「本次选中的渠道 + 本渠道最近一次动作」负责，避免 A 渠道的结论
  // 挂到 B 渠道头上（store 里的三份结果都是全局单份）。
  const action = verifiedFor?.channelId === selectedId ? verifiedFor.source : null

  /**
   * 状态行文案：三个按钮问的是**三个不同的问题**，所以文案分开写。
   * 共用一句「验证通过」会让「地址通不通 / 是哪种协议 / 拉回几个模型」看起来像同一件事——
   * 这正是此前分不清「这次到底出没出网」的根源。
   */
  const statusLine = useMemo(() => {
    if (!action) return null
    if (action === 'detect') {
      if (detect.status === 'checking') return '正在探测协议…'
      if (detect.status === 'ok' && detect.protocol)
        return `✓ 已识别协议 · ${protocolLabel(detect.protocol, catalog)}`
      if (detect.status === 'error') return `✗ 未识别出协议 · ${detect.message ?? '所有候选协议均未通过'}`
      return null
    }
    const label = protocolLabel(verifiedFor?.protocol ?? '', catalog)
    if (action === 'models') {
      if (modelsResult.status === 'checking') return '正在拉取模型…'
      if (modelsResult.status === 'ok')
        return `✓ 已拉取模型 · ${label} · 发现 ${modelsResult.modelCount ?? 0} 个模型`
      if (modelsResult.status === 'error') return `✗ 拉取失败 · ${modelsResult.message ?? '未知错误'}`
      return null
    }
    /*
     * CLI 族没有"地址"这回事（对账 #308）：它的验证是"本机命令在不在"。
     * 文案必须跟着走 —— 一条本机命令的渠道回「地址可达」，用户会去找那个根本不存在的地址。
     */
    /*
     * 判据是**这次走的是哪条路**，不只看协议族：桌面壳里 CLI 渠道起的是本机命令，
     * 浏览器里同一条协议走的是"访问自建网关"（那时它确实是在验地址）。
     * 只看 `family` 的话，浏览器里网关验证成功也会显示「本机命令就绪」—— 一句假的。
     */
    const isCli =
      hasLocalCli && verifiedFor ? protocolById(verifiedFor.protocol, catalog)?.family === 'cli-gateway' : false
    if (verify.status === 'checking') return isCli ? '正在检查本机命令…' : '正在验证地址…'
    if (verify.status === 'ok')
      return `${isCli ? '✓ 本机命令就绪' : '✓ 地址可达'} · ${label}${typeof verify.latency === 'number' ? ` · ${verify.latency}ms` : ''}`
    if (verify.status === 'error') return `✗ ${verify.message ?? (isCli ? '本机命令有问题' : '地址不可达')}`
    return null
  }, [action, verifiedFor, verify, modelsResult, detect, catalog, hasLocalCli])

  /**
   * 同一条状态行的**语气**（产品文档 §4.5）：只看"这次是哪个动作、它现在什么状态"，
   * 三个动作各有自己的失败档（探测未识别 / 拉取失败 / 验证不通）—— 与上面的文案分支一一对应。
   */
  const statusTone: NoticeTone = useMemo(() => {
    if (!action) return 'info'
    if (action === 'detect') return detect.status === 'error' ? 'error' : 'info'
    if (action === 'models') return modelsResult.status === 'error' ? 'error' : 'info'
    return verify.status === 'error' ? 'error' : 'info'
  }, [action, detect.status, modelsResult.status, verify.status])

  // mock 提示只在**真的拿 mock 验了地址**时出现（探测的候选表不含 mock，故不受其影响）。
  const showMockNote = action === 'verify' && verify.status === 'ok' && verifiedFor?.protocol === 'mock'
  /**
   * 这条协议**要几把钥匙**（用户第 22 批 #358）：协议目录声明（RunningHub 两把），
   * 没声明的协议回落到"一把"，见下面令牌区的渲染。
   */
  const credentialSlots = protocolById(protocol, catalog)?.credentials ?? []
  /**
   * 这一条协议官网的**取令牌页**（用户第 19 批 #2：「需要有点击就跳转到官网，获取令牌的选项」）。
   * 地址来自协议目录的 `docUrl`（唯一来源）—— 没写就**不出现**这个链接，不猜地址。
   */
  const docUrl = protocolById(protocol, catalog)?.docUrl ?? ''
  /**
   * 选中的是不是**内置渠道**（用户第 20 批：三条常驻渠道「固定字段」= 名称 + 协议）。
   * 界面据此禁用名称 / 协议与删除；命令层（仓储）另有一道同样的拦截，
   * 所以"禁不掉"这件事不靠界面自觉。
   */
  const builtinSelected = !!selectedId && isBuiltinChannelId(selectedId)
  const menuChannel = channelMenu
    ? channelsList.find((channel) => channel.id === channelMenu.channelId) ?? null
    : null
  const menuBuiltin = !!menuChannel && isBuiltinChannelId(menuChannel.id)
  const menuWidth = 184
  const menuHeight = menuConfirmDelete ? 164 : menuBuiltin ? 52 : 104
  const menuLeft = channelMenu
    ? Math.max(8, Math.min(channelMenu.x, window.innerWidth - menuWidth - 8))
    : 0
  const menuTop = channelMenu
    ? Math.max(8, Math.min(channelMenu.y, window.innerHeight - menuHeight - 8))
    : 0

  return (
    <div className={styles.page}>
      {/*
        ⛔ 页内标题「后台设置」与左侧二级菜单**已删除**（用户 2026-09-27 第 9 轮）：
        「后台设置这几个词贴边了，不需要了，后台设置工作区里面左边的几个菜单也不需要了」。

        两条理由：
        ① 身份与导航**已由应用壳侧栏表达**（它那一项就叫「渠道配置」），
           页内再放标题与菜单就是同一个事实的第二份说法；
        ② 三个菜单项里，功能预设词与技能库已按 §7A 迁去技能库一级页，
           只剩「渠道」一项 —— 一个只有单个选项的菜单没有任何导航价值。

        于是这个页面现在就是**渠道配置本身**，从内容直接开始。
      */}
      {(
      <div className={styles.layout} data-settings-card>
        {/* —— 全局选路策略（用户 2026-09-29 第 12/13 轮）——
            跨渠道比较用的一把尺子，与「当前选中哪条渠道」无关。
            它**不放进渠道编辑区**（否则看上去像是右边渠道表单里的一项）——
            独立成一条横跨左右两栏的顶栏，未选中渠道时也能设置。 */}
        <section className={styles.globalRoute} data-settings-global-route>
          <div className={styles.globalRouteText}>
            <span className={styles.cardTitle}>选路策略</span>
            <span className={styles.cardSub}>
              同一个模型在多条渠道都能用时，所有渠道统一按这个规则挑一条
            </span>
            {routeStrategy === 'performance' && (
              <span className={styles.cardSub}>
                性能优先按「验证地址」测出的延迟排序；没测过的渠道会排在测过的后面。
              </span>
            )}
          </div>
          <StrategyPicker
            value={routeStrategy}
            options={ROUTE_STRATEGIES.map((s) => ({
              value: s.value,
              label: s.label,
              hint: s.hint,
            }))}
            onChange={(value) => void channels.setRouteStrategy(value as RouteStrategy)}
          />
        </section>

        <div className={styles.workarea} data-settings-workarea>
          <aside className={styles.sidebar} data-settings-sidebar>
            <div className={styles.sidebarTools} data-channel-tools>
              <div className={styles.channelSearch}>
                <IconSearch size={16} />
                <input
                  value={channelSearch}
                  data-channel-search
                  placeholder="搜索模型平台..."
                  aria-label="搜索模型服务"
                  onChange={(event) => setChannelSearch(event.target.value)}
                />
                <ChoicePicker
                  name="channel-filter"
                  value={channelFilter}
                  compact
                  iconOnly
                  alignEnd
                  triggerIcon={<IconFilter size={16} />}
                  ariaLabel="筛选模型服务"
                  options={CHANNEL_FILTER_OPTIONS}
                  onChange={(value) => setChannelFilter(value as ChannelFilterKey)}
                  className={styles.channelFilterPicker}
                />
              </div>
            </div>
            <ul className={styles.list} data-channel-list>
              {visibleChannels.map((ch: Channel) => {
                const caps = channelCapabilities(
                  ch,
                  protocolById(ch.protocol, catalog)?.capabilities ?? [],
                )
                return (
                  <li key={ch.id}>
                    <div
                      className={
                        ch.id === selectedId
                          ? `${styles.item} ${styles.itemActive}`
                          : styles.item
                      }
                      data-channel-item
                      data-channel-id={ch.id}
                      data-channel-selected={ch.id === selectedId ? 'true' : undefined}
                      data-channel-proto={protocolShort(ch.protocol, catalog)}
                      data-channel-enabled-state={ch.enabled ? 'true' : 'false'}
                      data-channel-caps={(['chat', 'image', 'video'] as const)
                        .filter((key) => caps[key])
                        .join(',')}
                      data-channel-fixed={isBuiltinChannelId(ch.id) ? 'true' : undefined}
                      data-dragging={dragId === ch.id ? 'true' : undefined}
                      data-menu-open={channelMenu?.channelId === ch.id ? 'true' : undefined}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openChannelMenu(ch.id, event.clientX, event.clientY)
                      }}
                      onDragOver={(event) => {
                        if (!dragId) return
                        event.preventDefault()
                      }}
                      onDrop={(event) => {
                        if (!dragId) return
                        event.preventDefault()
                        void dropOnChannel(ch.id)
                      }}
                    >
                      <span className={styles.dragHandleSlot}>
                        {!isBuiltinChannelId(ch.id) ? (
                          <button
                            type="button"
                            className={styles.dragHandle}
                            draggable
                            aria-label={`拖动 ${ch.name} 排序`}
                            title="拖动排序"
                            data-channel-drag-handle={ch.id}
                            onDragStart={(event) => {
                              event.stopPropagation()
                              setDragId(ch.id)
                            }}
                            onDragEnd={() => setDragId(null)}
                          >
                            <IconGrip size={15} />
                          </button>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className={styles.itemMain}
                        onPointerDown={(event) => {
                          if (event.button === 0) setSelectedId(ch.id)
                        }}
                        onClick={() => setSelectedId(ch.id)}
                        onKeyDown={(event) => {
                          const menuKey =
                            event.key === 'ContextMenu' ||
                            (event.shiftKey && event.key === 'F10')
                          if (!menuKey) return
                          event.preventDefault()
                          const rect = event.currentTarget.getBoundingClientRect()
                          openChannelMenu(ch.id, rect.right - 8, rect.top + rect.height)
                        }}
                      >
                        <span className={styles.itemIcon} data-channel-icon-box>
                          <SettingsChannelAvatar
                            channelId={ch.id}
                            protocol={ch.protocol}
                            icon={ch.icon}
                            name={ch.name}
                            size={24}
                          />
                        </span>
                        <span className={styles.itemBody} data-channel-body>
                          <span className={styles.itemName}>{ch.name}</span>
                        </span>
                      </button>
                      <span className={styles.itemTrailing}>
                        {ch.enabled ? (
                          <span
                            className={styles.itemEnabledDot}
                            data-channel-state-dot={ch.id}
                            data-enabled="true"
                            title="已启用"
                            aria-label="已启用"
                          />
                        ) : null}
                        <button
                          type="button"
                          className={styles.itemMenuTrigger}
                          data-channel-menu-trigger={ch.id}
                          aria-label={`打开 ${ch.name} 菜单`}
                          aria-haspopup="menu"
                          aria-expanded={channelMenu?.channelId === ch.id}
                          title="更多操作"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => openChannelMenuFromButton(event, ch.id)}
                        >
                          <IconMoreVertical size={17} />
                        </button>
                      </span>
                    </div>
                  </li>
                )
              })}
              {visibleChannels.length === 0 && (
                <li className={styles.empty}>
                  {channelsList.length === 0
                    ? '还没有模型服务，点下方「添加服务商」'
                    : '没有符合搜索或筛选条件的模型服务'}
                </li>
              )}
            </ul>
            <div className={styles.sidebarFoot}>
              <button className={styles.addBtn} data-channel-add onClick={handleCreate}>
                + 添加服务商
              </button>
            </div>
          </aside>

        <section className={styles.editor} data-settings-editor>
          {!selected ? (
            <div className={styles.placeholder}>从左侧选择，或新增一个模型服务</div>
          ) : (
            <div className={styles.form} data-settings-form>
              <div className={styles.providerEditorHead} data-settings-provider-head>
                <SettingsChannelAvatar
                  protocol={protocol}
                  icon={selected.icon}
                  name={name}
                  size={34}
                />
                <div className={styles.providerNameGroup}>
                  <span className={styles.providerNameText} data-settings-name>
                    {name}
                  </span>
                  <button
                    type="button"
                    className={styles.providerGear}
                    data-settings-profile-edit
                    aria-label="编辑服务资料"
                    title="编辑服务资料"
                    onClick={() => editChannel(selected.id)}
                  >
                    <IconGear size={16} />
                  </button>
                </div>
                <label
                  className={styles.switch}
                  title={enabled ? '停用模型服务' : '启用模型服务'}
                >
                  <input
                    className={styles.switchInput}
                    type="checkbox"
                    checked={enabled}
                    aria-label={`${selected.name}：${enabled ? '已启用' : '未启用'}`}
                    data-channel-enabled={selected.id}
                    onChange={(event) => void handleEnableChange(event.target.checked)}
                  />
                  <span className={styles.switchTrack} aria-hidden="true" />
                </label>
              </div>
              {/* —— 连接与鉴权（§7.3）—— */}
              <section className={styles.editorSection} data-settings-connection>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>连接与鉴权</span>
                  <span className={styles.cardSub}>站点地址、API Key 与协议</span>
                </div>

                <label className={styles.field}>
                  <span className={styles.label}>地址</span>
                  <input
                    className={styles.input}
                    data-settings-baseurl
                    placeholder="https://your-relay.example.com（含 /v1 或不含都可以）"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => void persistForm()}
                  />
                </label>

                {activeGroup ? (
                  <div className={styles.keyGroups} data-key-groups>
                    <div className={styles.keyGroupsHead}>
                      <span className={styles.label}>Key 分组</span>
                      <button
                        className={styles.ghostBtn}
                        data-key-group-add
                        disabled={busy}
                        onClick={() => void handleAddKeyGroup()}
                      >
                        + 添加分组
                      </button>
                    </div>
                    <div className={styles.keyGroupTabs} role="tablist" aria-label="Key 分组">
                      {selectedKeyGroups.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          role="tab"
                          aria-selected={group.id === activeGroup.id}
                          className={
                            group.id === activeGroup.id
                              ? `${styles.keyGroupTab} ${styles.keyGroupTabOn}`
                              : styles.keyGroupTab
                          }
                          data-key-group-tab={group.id}
                          onClick={() => setActiveGroupId(group.id)}
                        >
                          {group.name}
                          {group.hasToken ? '' : ' · 未填 Key'}
                        </button>
                      ))}
                    </div>

                    <div className={styles.keyGroupEditor} data-key-group-editor={activeGroup.id}>
                      <div className={styles.fieldRow}>
                        <label className={`${styles.field} ${styles.grow}`}>
                          <span className={styles.label}>分组名称</span>
                          <input
                            key={`${activeGroup.id}-name`}
                            className={styles.input}
                            data-key-group-name
                            defaultValue={activeGroup.name}
                            onBlur={(event) => {
                              const value = event.target.value.trim()
                              if (value && value !== activeGroup.name) {
                                void channels.renameCredentialGroup(
                                  selected.id,
                                  activeGroup.id,
                                  value,
                                )
                              }
                            }}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.label}>分组优先级</span>
                          <input
                            key={`${activeGroup.id}-priority`}
                            className={`${styles.input} ${styles.numInput}`}
                            type="number"
                            data-key-group-priority
                            defaultValue={activeGroup.priority}
                            onBlur={(event) => {
                              const value = Number(event.target.value)
                              if (Number.isFinite(value) && value !== activeGroup.priority) {
                                void channels.setCredentialGroupPriority(
                                  selected.id,
                                  activeGroup.id,
                                  value,
                                )
                              }
                            }}
                          />
                        </label>
                      </div>
                      <ChannelTokenField
                        key={activeGroup.id}
                        channels={channels}
                        channelId={selected.id}
                        slot={selectedKeyGroups[0]?.id === activeGroup.id ? 'primary' : 'alt'}
                        groupId={activeGroup.id}
                        label="API Key"
                        docUrl={docUrl}
                        savedTail={activeGroup.tokenTail}
                        saved={activeGroup.hasToken}
                      />
                      <div className={styles.keyGroupFoot}>
                        <span className={styles.cardSub}>
                          这个分组独立保存 Key 和模型；优先级高的先请求。
                        </span>
                        <button
                          className={styles.ghostBtn}
                          data-key-group-remove
                          disabled={busy || selectedKeyGroups.length <= 1}
                          onClick={() => void handleRemoveKeyGroup()}
                        >
                          删除分组
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  (credentialSlots.length > 0
                    ? credentialSlots
                    : [{ id: 'primary', label: '令牌（API Key）' }]
                  ).map((cred, i) => (
                    <ChannelTokenField
                      key={cred.id}
                      channels={channels}
                      channelId={selected.id}
                      slot={i === 0 ? 'primary' : 'alt'}
                      label={cred.label}
                      hint={cred.hint}
                      required={cred.required}
                      docUrl={docUrl}
                      savedTail={i === 0 ? selected.tokenTail : selected.altTokenTail}
                      saved={i === 0 ? selected.hasToken : selected.hasAltToken}
                    />
                  ))
                )}

                {/* 协议区（§7.3）：协议下拉 + 三个动作按钮。
                    「验证地址」只回答地址通不通；「验证协议」按候选表试打并把命中的协议填进下拉；
                    「拉取模型」在下方模型区分内。三者职责不重叠，所以按钮文案也是三句不同的话。 */}
                <div className={styles.protocolRow}>
                  <label className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>协议</span>
                    <ChoicePicker
                      name="settings-protocol"
                      value={protocol}
                      ariaLabel="渠道协议"
                      disabled={builtinSelected}
                      onChange={handleProtocolChange}
                      options={[
                        ...(!visibleProtocolOptions.some((item) => item.id === protocol)
                          ? [
                              {
                                value: protocol,
                                label: `未知协议（${protocol}）`,
                                group: '当前协议',
                              },
                            ]
                          : []),
                        ...PROTOCOL_GROUPS.flatMap(({ kind, label }) =>
                          visibleProtocolOptions
                            .filter((item) => item.kind === kind)
                            .map((item) => ({
                              value: item.id,
                              label: `${item.name}${item.status !== 'ready' ? '（待支持）' : ''}`,
                              group: label,
                              disabled: item.status !== 'ready',
                            })),
                        ),
                      ]}
                    />
                  </label>
                  <button
                    className={styles.ghostBtn}
                    data-settings-detect
                    disabled={busy}
                    onClick={handleDetect}
                    title="按候选协议逐个试打，第一个通的自动选中"
                  >
                    验证协议
                  </button>
                  <button
                    className={styles.ghostBtn}
                    data-settings-verify
                    disabled={busy}
                    onClick={handleVerify}
                  >
                    验证地址
                  </button>
                </div>

                <div
                  className={styles.status}
                  data-settings-status
                  data-status-tone={statusTone}
                  {...noticeA11y(statusTone)}
                >
                  {statusLine}
                </div>

                <div className={styles.protoTools}>
                  <button
                    className={styles.ghostBtn}
                    data-proto-add-toggle
                    onClick={() => setNewProtoOpen((v) => !v)}
                  >
                    {newProtoOpen ? '收起' : '添加自定义协议'}
                  </button>
                  {npNotice && <span className={styles.saved}>{npNotice}</span>}
                </div>

                {newProtoOpen && (
                  <div className={styles.protoForm} data-proto-form>
                    <p className={styles.protoHint}>
                      只支持 OpenAI 兼容形态（对话 / 生图）。输入异步任务、CLI 一类需要专用程序抓取的协议，
                      请先用内置协议；自建渠道的地址、版本段、能力都可按站点文档填。
                    </p>
                    {/*
                      用户问「里面的东西从什么地方获取」（2026-09-29）。
                      表单原本只给占位提示，没说这些值从哪来 —— 于是「自定义协议」对
                      非技术用户等于不可用的入口。这里把四个字段的来源一次说清，
                      并给一条最短路径：先试「OpenAI 兼容」，只有确定站点的版本段与
                      能力不符合时才需要自建。
                    */}
                    <p className={styles.protoHint} data-proto-guide>
                      <strong>从哪找这些值：</strong>
                      <br />
                      ① <b>地址</b>：站点文档里的「API 基址 / Base URL」，<b>不要带</b>结尾的 <code>/v1</code>
                      （版本段单独填下一格）。例：<code>https://api.xxx.com</code>。
                      <br />
                      ② <b>版本段</b>：文档里基址结尾那一段，多数是 <code>/v1</code>；火山方舟是{' '}
                      <code>/api/v3</code>。填错的表现是验证报 404。
                      <br />
                      ③ <b>能力</b>：看站点提供哪些接口 —— 有 <code>/chat/completions</code> 勾「对话」，
                      有 <code>/images/generations</code> 勾「生图」。
                      <br />
                      ④ <b>标识 / 名称 / 短标签</b>：自己起，只用于界面显示，不影响请求；标识只能用小写字母、数字、
                      <code>-</code>、<code>_</code>。
                      <br />
                      <strong>最短路径</strong>：大多数中转站不用自建 —— 直接选「OpenAI 兼容」填地址即可；
                      只有当这个站的版本段或接口形态与通用模板不一致时才需要建一条。
                    </p>
                    <div className={styles.protoRow}>
                      <label className={`${styles.field} ${styles.grow}`}>
                        <span className={styles.label}>名称</span>
                        <input
                          className={styles.input}
                          data-proto-field="name"
                          placeholder="例如：某站点"
                          value={npName}
                          onChange={(e) => setNpName(e.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>短标签</span>
                        <input
                          className={styles.input}
                          data-proto-field="short"
                          placeholder="最多 8 字"
                          value={npShort}
                          onChange={(e) => setNpShort(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className={styles.protoRow}>
                      <label className={`${styles.field} ${styles.grow}`}>
                        <span className={styles.label}>协议标识</span>
                        <input
                          className={styles.input}
                          data-proto-field="id"
                          placeholder="小写字母 / 数字 / - / _"
                          value={npId}
                          onChange={(e) => setNpId(e.target.value)}
                        />
                      </label>
                      <div className={styles.field}>
                        <span className={styles.label}>能力</span>
                        <div className={styles.capRow}>
                          {(['chat', 'image'] as ProtocolCapability[]).map((c) => (
                            <label key={c} className={styles.capBox}>
                              <input
                                type="checkbox"
                                data-proto-cap={c}
                                checked={npCaps.includes(c)}
                                onChange={(e) => toggleNewCap(c, e.target.checked)}
                              />
                              <span>{CAPABILITY_LABEL[c]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className={styles.protoRow}>
                      <label className={`${styles.field} ${styles.grow}`}>
                        <span className={styles.label}>默认地址</span>
                        <input
                          className={styles.input}
                          data-proto-field="baseurl"
                          placeholder="https://your-site.com（可留空，渠道里再填）"
                          value={npBaseUrl}
                          onChange={(e) => setNpBaseUrl(e.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>版本段</span>
                        <input
                          className={styles.input}
                          data-proto-field="version"
                          placeholder="/v1"
                          value={npVersionPath}
                          onChange={(e) => setNpVersionPath(e.target.value)}
                        />
                      </label>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.label}>文档地址（可选）</span>
                      <input
                        className={styles.input}
                        data-proto-field="doc"
                        placeholder="https://站点文档"
                        value={npDocUrl}
                        onChange={(e) => setNpDocUrl(e.target.value)}
                      />
                    </label>
                    {npError && (
                      <p className={styles.protoError} data-proto-error>
                        {npError}
                      </p>
                    )}
                    <div className={styles.protoFoot}>
                      <button className={styles.primary} data-proto-create onClick={handleCreateProtocol}>
                        添加
                      </button>
                    </div>
                  </div>
                )}

                {customProtocols.length > 0 && (
                  <div className={styles.protoMine} data-proto-mine>
                    <span className={styles.label}>我添加的协议</span>
                    {customProtocols.map((p) => (
                      <div key={p.id} className={styles.protoMineRow}>
                        <span className={styles.protoMineName}>
                          {p.name}（{p.short}）
                        </span>
                        <button
                          className={styles.chipX}
                          data-proto-remove={p.id}
                          aria-label={`删除协议 ${p.name}`}
                          onClick={() => void handleRemoveProtocol(p.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                {protoRemoveError && (
                      <p className={styles.protoError} data-proto-remove-error>
                        {protoRemoveError}
                      </p>
                    )}
                  </div>
                )}

                {/*
                  待支持协议（CLI / RunningHub）。

                  为什么单独列一块而不是只留在下拉里灰掉：灰掉的 `<option>` 在多数浏览器里
                  几乎看不见，用户只会以为「根本没有 CLI 这一项」。列出来才回答得上
                  「支不支持」这个问题，同时明写为什么不支持 —— 这也是「能看到但选不了」
                  与「压根不知道有」的区别。
                */}
                {pendingProtocols.length > 0 && (
                  <div className={styles.protoMine} data-proto-pending>
                    <span className={styles.label}>待支持协议</span>
                    {pendingProtocols.map((p) => (
                      <div key={p.id} className={styles.protoMineRow} data-proto-pending-item={p.id}>
                        <span className={styles.protoMineName}>{p.name}</span>
                        <span className={styles.protoPendingWhy}>{p.note}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/*
                  ⛔ 「本机 CLI」那一块**整块删掉**（用户第 21 批第 1 条：
                  「每个渠道的这里的cli都不需要了，cli有单独的位置了」）——
                  CLI 现在在「全局设置 → 左侧 CLI 一栏」，渠道页再挂一份入口就是两处口径
                  （而且它看起来像"这条渠道的 CLI 配置"，实际是全局的）。
                */}

                {showMockNote && (
                  <p className={styles.offlineNote} data-settings-mock-note>
                    Mock 是离线协议：不发任何网络请求、也不会去访问上面填的地址，所以验证必然通过。
                    要联调真实中转，把「协议」切到「OpenAI 兼容（对话 + 生图）」后再点一次「验证地址」，
                    或者直接点「验证协议」让它自己认。
                  </p>
                )}
                {/*
                  「这条协议有什么前提」一直写在目录的 `note` 里，却从未显示 ——
                  于是 CLI 网关类协议看起来与普通站点无异，用户把 CLI 官网地址填进来
                  必然验证失败，还不知道为什么。这里把当前协议的说明显式说出来。
                  mock 另有专门提示（要点是「没出网」），故仅在非 mock 时显示。
                */}
                {selectedProtocolNote && protocol !== 'mock' && (
                  <p className={styles.offlineNote} data-settings-proto-note>
                    {selectedProtocolNote}
                  </p>
                )}
              </section>

              {/* —— 模型管理（§7.4）—— */}
              <section className={styles.editorSection} data-settings-models>
                <div className={styles.modelsHead}>
                  <div className={styles.modelsTitleBox}>
                    <span className={styles.cardTitle}>模型列表</span>
                    <span className={styles.cardSub}>
                      {activeGroup ? `当前分组：${activeGroup.name}` : '从上游 api 自动拉取所有可用模型'}
                    </span>
                  </div>
                  <button className={styles.ghostBtn} disabled={busy} onClick={handleRefresh}>
                    拉取模型
                  </button>
                  <button
                    className={styles.ghostBtn}
                    disabled={busy || activeModelCache.length === 0}
                    onClick={openPanel}
                  >
                    选择模型
                  </button>
                </div>

                {activeModelCache.length === 0 ? (
                  <p className={styles.modelsEmpty} data-models-empty>
                    还没有拉取过模型。点「拉取模型」从上游取回全部可用模型，再点「选择模型」勾选要用的。
                  </p>
                ) : selectedGroups.length === 0 ? (
                  <p className={styles.modelsEmpty} data-models-none>
                    {/* ⚠️ 2026-10-08：删掉"与漫画"——漫画剧工作台 2026-09-25 已整体移除，
                        这句是漏网的旧文案（用户第 3 条一眼看到：「怎么会有个漫画的东西」）。 */}
                    上游有 {activeModelCache.length} 个模型，但还没勾选任何一个——画布的模型下拉只列这里选中的。
                    点「选择模型」去挑。
                  </p>
                ) : (
                  <div className={styles.selectedGroups}>
                    {selectedGroups.map((group) => (
                      <div key={group.category} className={styles.selectedRow}>
                        <span className={styles.selectedLabel}>{group.label}模型</span>
                        <div className={styles.chips}>
                          {group.models.map((m) => (
                            <span key={m.id} className={styles.chip} data-model-chip data-model-id={m.id}>
                              {m.id}
                              <button
                                className={styles.chipX}
                                aria-label={`移除模型 ${m.id}`}
                                data-model-remove={m.id}
                                onClick={() => void dropSelectedModel(m.id)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {panelOpen && (
                  <div className={styles.panel} data-model-panel>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>选择模型</span>
                      <button className={styles.chipX} aria-label="关闭选择模型" onClick={() => setPanelOpen(false)}>
                        ×
                      </button>
                    </div>
                    <div className={styles.panelFilters}>
                      <div className={styles.tabs}>
                        {CATEGORY_FILTERS.map((c) => (
                          <button
                            key={c.value}
                            className={c.value === draftCategory ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                            data-model-tab={c.value}
                            onClick={() => setDraftCategory(c.value)}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <input
                        className={`${styles.input} ${styles.search}`}
                        data-model-search
                        placeholder="搜索模型名称"
                        value={draftKeyword}
                        onChange={(e) => setDraftKeyword(e.target.value)}
                      />
                    </div>

                    <ul className={styles.optionList}>
                      {draftList.map((m) => (
                        <li key={m.id}>
                          <label className={styles.option} data-model-option={m.id}>
                            <input
                              type="checkbox"
                              checked={draftChecked.has(m.id)}
                              onChange={(e) => toggleDraft(m.id, e.target.checked)}
                            />
                            <span className={styles.optionName}>{m.id}</span>
                            <ChoicePicker
                              name={`model-category-${m.id}`}
                              value={m.category}
                              ariaLabel={`${m.id} 的模型分类`}
                              compact
                              className={styles.categorySelect}
                              options={CATEGORY_FILTERS.filter(
                                (item) => item.value !== 'all',
                              ).map((item) => ({
                                value: item.value,
                                label: item.label,
                              }))}
                              onChange={(next) =>
                                void channels.setModelCategory(
                                  selected.id,
                                  m.id,
                                  next as ModelCapability['category'],
                                  activeGroup?.id,
                                )
                              }
                            />
                          </label>
                        </li>
                      ))}
                      {draftList.length === 0 && (
                        <li className={styles.optionEmpty}>
                          {activeModelCache.length === 0 ? '没有可选的模型，先「拉取模型」' : '没有匹配的模型'}
                        </li>
                      )}
                    </ul>

                    <div className={styles.panelFoot}>
                      <button className={styles.ghostBtn} onClick={() => setPanelOpen(false)}>
                        取消
                      </button>
                      <button className={styles.primary} disabled={busy} data-model-apply onClick={applyDraft}>
                        应用到模型列表
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* —— 渠道的选路权重与模型映射（§7.4.1，M7-2）——
                  策略本身是全局的（见上方 `data-settings-global-route`）；
                  这里只留**按渠道**才有意义的优先度 / 权重 / 映射。 */}
              <section className={styles.editorSection} data-settings-channel-route>
                <div className={styles.modelsHead}>
                  <div className={styles.modelsTitleBox}>
                    <span className={styles.cardTitle}>渠道权重与模型映射</span>
                    <span className={styles.cardSub}>
                      优先度与权重只描述这条渠道本身；映射解决各站模型 ID 叫法不同
                    </span>
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span className={styles.label}>优先度（越大越先）</span>
                    <input
                      className={`${styles.input} ${styles.numInput}`}
                      type="number"
                      data-route-priority
                      value={selected.priority}
                      onChange={(e) =>
                        void channels.setRouteTuning(selectedId!, {
                          priority: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>权重（同档均摊）</span>
                    <input
                      className={`${styles.input} ${styles.numInput}`}
                      type="number"
                      min={0}
                      data-route-weight
                      value={selected.weight}
                      onChange={(e) =>
                        void channels.setRouteTuning(selectedId!, {
                          weight: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>

                <div className={styles.mapHead}>
                  <span className={styles.label}>模型映射（前端显示名 → 本站点真实 ID）</span>
                  <button
                    className={styles.ghostBtn}
                    data-global-model-add-toggle
                    onClick={() => setModelAddOpen((open) => !open)}
                  >
                    {modelAddOpen ? '收起' : '+ 添加前端模型'}
                  </button>
                </div>

                {modelAddOpen && (
                  <div className={styles.modelAddForm} data-global-model-form>
                    <label className={styles.field}>
                      <span className={styles.label}>前端显示名</span>
                      <input
                        className={styles.input}
                        data-global-model-name
                        value={newModelName}
                        placeholder="例如：My Image Pro"
                        onChange={(event) => setNewModelName(event.target.value)}
                      />
                    </label>
                    <div className={styles.modelAddRow}>
                      <span className={styles.label}>分类</span>
                      <div className={styles.mapFilters}>
                        {(['image', 'chat', 'video', 'audio'] as const).map((category) => (
                          <button
                            key={category}
                            type="button"
                            className={
                              newModelCategory === category
                                ? `${styles.mapFilter} ${styles.mapFilterOn}`
                                : styles.mapFilter
                            }
                            data-global-model-category={category}
                            onClick={() => setNewModelCategory(category)}
                          >
                            {categoryLabel(category)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.modelAddRow}>
                      <span className={styles.label}>图标</span>
                      <div className={styles.vendorGrid}>
                        {GLOBAL_MODEL_VENDORS.map((vendor) => (
                          <button
                            key={vendor.value}
                            type="button"
                            className={
                              newModelVendor === vendor.value
                                ? `${styles.vendorOption} ${styles.vendorOptionOn}`
                                : styles.vendorOption
                            }
                            data-global-model-vendor={vendor.value}
                            onClick={() => setNewModelVendor(vendor.value)}
                          >
                            <ModelIcon vendor={vendor.value} size={18} />
                            <span>{vendor.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.modelAddActions}>
                      <button
                        className={styles.ghostBtn}
                        onClick={() => setModelAddOpen(false)}
                      >
                        取消
                      </button>
                      <button
                        className={styles.primary}
                        data-global-model-add
                        disabled={!newModelName.trim()}
                        onClick={() => void handleAddGlobalModel()}
                      >
                        添加
                      </button>
                    </div>
                  </div>
                )}

                {/*
                  映射列表 = **前端固定显示名**。

                  为什么固定名一定要在这里出现（用户 2026-09-27）：
                  画布下拉列的就是这几个名字，它们**不一定出现在本站的模型清单里**
                  （例如前端叫 `GPT Image 2.5 Flare`，本站叫 `gpt-image-2.5-flare`）。
                  若这里只列「已勾选模型」，用户就没地方填这个翻译 ——
                  在画布选完固定名，请求会带着显示名发出去并被上游拒绝。

                  上游拉到的模型 ID 只作为输入框候选（`routeMapOptions`），
                  不再额外生成映射行；否则站点一拉模型，映射区就会越积越多。
                */}
                {(() => {
                  const presetIds = allGlobalModels.map((model) => model.id)
                  /**
                   * 一行的 `key` 固定取预设显示名，标签与它一致。
                   *
                   * 映射保存的就是「显示名 → 本站真实 ID」，上游 ID 不占一个显示槽位。
                   */
                  const rows = allGlobalModels.map((m) => ({
                    key: m.id,
                    label: m.id,
                    category: m.category,
                    // 图标与画布那边的模型下拉同源（同一份 ModelIcon），两处不会画出两个样
                    vendor: m.vendor,
                  }))
                  return (
                    <>
                      {/*
                        **五个筛选**（用户 2026-10-08 第 1 条：「换成五个筛选吧…加上音频，3d」），
                        以及**两行说明文案已删**（第 4 条：「这个框住的文字可以删掉了」）——
                        左列是什么、右列填什么，看一遍就懂；填错时那行会有自己的提示。
                      */}
                      <div className={styles.mapToolbar}>
                        <div className={styles.mapFilters} role="tablist" aria-label="模型映射分类">
                          {MAP_FILTERS.map((f) => (
                            <button
                              key={f.key}
                              type="button"
                              role="tab"
                              aria-selected={mapCategory === f.key}
                              data-route-map-filter={f.key}
                              className={
                                mapCategory === f.key
                                  ? `${styles.mapFilter} ${styles.mapFilterOn}`
                                  : styles.mapFilter
                              }
                              onClick={() => setMapCategory(f.key)}
                            >
                              {f.title}
                            </button>
                          ))}
                        </div>
                        <label className={styles.showUncommonToggle}>
                          <input
                            type="checkbox"
                            checked={showUncommonModels}
                            data-route-map-show-uncommon
                            onChange={(event) => setShowUncommonModels(event.target.checked)}
                          />
                          <span>显示不常用模型</span>
                        </label>
                      </div>
                      {/*
                        按类别分三组（用户 2026-09-27 第 9 轮）：
                        「模型映射的部分也需要分生图模型，对话模型和视频模型」。
                        上一版是一长条平铺 15 个名字 —— 找某个生图模型要扫过对话与视频。

                        分类取自 `PRESET_MODELS` 自己的 `category`，**不在这里另写一份**
                        （写两份必然漂移，那正是本项目反复踩的坑）。
                      */}
                      {(() => {
                        const uncommon = new Set(uncommonModelIds)
                        const allGroupRows = rows.filter(
                          (row) => String(row.category) === mapCategory,
                        )
                        const groupRows = allGroupRows.filter(
                          (row) => showUncommonModels || !uncommon.has(row.key),
                        )
                        /*
                         * 空的这一类**如实说**：前端显示名清单里目前只有生图 / 对话 / 视频，
                         * 音频与 3D 是预留位（清单里加上就会自动出现，不必改这里）。
                         */
                        if (groupRows.length === 0) {
                          return (
                            <p className={styles.modelsEmpty} data-route-map-empty={mapCategory}>
                              {allGroupRows.length > 0
                                ? '这一类的模型都已标为不常用。勾选“显示不常用模型”可恢复为常用。'
                                : '这一类的模型列表目前为空。'}
                            </p>
                          )
                        }
                        /*
                         * 候选 = 该渠道**已勾选且同类**的模型 ID。
                         * 这是用户要的「没填写的话可以下拉选择已经选择好类别的模型」——
                         * 上游 ID 本来就躺在已勾选清单里，让人重复默写没有道理。
                         *
                         * 控件是 `ModelMapCombo`（用户 2026-09-29 第 13 轮）：输入框仍可手填
                         * （模型没勾选、或 ID 不在清单里的情况依然存在），右侧的下拉开关
                         * 展开**与画布参数同一套**的浮层菜单。此前用的原生 `<datalist>`
                         * 的候选列表由浏览器绘制，既不受浮层规范约束，也无法被冒烟断言。
                         */
                        /* 候选取法见 domain 纯函数 routeMapOptions（已勾选优先、缺失回落已拉取） */
                        /* 走到这里类别必是 image / chat / video（空的那两类上面已经返回了）——
                           所以这个收窄是安全的；写它只是为了不把 `ModelCapability['category']` 这条
                           联合扩到音频 / 3D（那要动渠道拉取 / 选路 / 画布面板一整条链）。 */
                        const options = routeMapOptions(
                          mapCategory as 'image' | 'chat' | 'video' | 'audio',
                          activeModels,
                          activeModelCache,
                        )
                        return (
                          /* 组标题已撤：筛选项本身就是那一类的名字，再写一行是重复 */
                          <div className={styles.mapGroup} data-route-map-group={mapCategory}>
                            <div className={styles.mapList}>
                              {groupRows.map(({ key: id, label, vendor }) => {
                                const saved = selected.modelMap[id] ?? ''
                                const draft = mapDrafts[id]
                                const value = draft ?? saved
                                const isPreset = presetIds.includes(id)
                                const uncommon = uncommonModelIds.includes(id)
                                const test = mapTests[id]
                                return (
                                  <div
                                    key={id}
                                    className={styles.mapRow}
                                    data-route-map-row={id}
                                    data-route-map-preset={isPreset ? '1' : '0'}
                                  >
                                    <span className={styles.mapName} title={id} data-route-map-label>
                                      <ModelIcon vendor={vendor} size={19} />
                                      <span className={styles.mapLabelText}>{label}</span>
                                    </span>
                                    <ModelMapCombo
                                      rowId={id}
                                      category={mapCategory as 'image' | 'chat' | 'video' | 'audio'}
                                      value={value}
                                      options={options}
                                      placeholder="留空 = 按原名发送"
                                      emptyHint="该渠道还没勾选同类模型"
                                      ariaLabel={`${MAP_FILTERS.find((f) => f.key === mapCategory)?.title ?? ''} ${label} 对应的本站模型 ID`}
                                      onChange={(next) => {
                                        setMapDrafts((prev) => ({ ...prev, [id]: next }))
                                        scheduleModelMapping(id, next)
                                      }}
                                      onBlur={() => void flushModelMapping(id, value)}
                                    />
                                    <span
                                      className={
                                        mapSaveNotice?.tone === 'error'
                                          ? `${styles.mapSaveState} ${styles.mapSaveError}`
                                          : styles.mapSaveState
                                      }
                                      data-route-map-save-state={
                                        mapSaveNotice?.id === id ? mapSaveNotice.tone : undefined
                                      }
                                      aria-live="polite"
                                    >
                                      {mapSaveNotice?.id === id ? mapSaveNotice.text : ''}
                                    </span>
                                    <label
                                      className={styles.mapUncommonToggle}
                                      title="勾选后从画布、Agent、默认参数和电商模型中隐藏"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={uncommon}
                                        data-route-map-uncommon={id}
                                        onChange={(event) => {
                                          void channels.setModelUncommon(id, event.target.checked)
                                        }}
                                      />
                                      <span>不常用</span>
                                    </label>
                                    <button
                                      type="button"
                                      className={styles.mapTestButton}
                                      data-route-map-test={id}
                                      disabled={test?.status === 'checking'}
                                      onClick={() => void testModelMapping(id, value)}
                                    >
                                      {test?.status === 'checking' ? '测试中' : '测试'}
                                    </button>
                                    {customModels.some((model) => model.id === id) && (
                                      <button
                                        className={styles.chipX}
                                        aria-label={`删除前端模型 ${id}`}
                                        data-global-model-remove={id}
                                        onClick={() => void handleRemoveGlobalModel(id)}
                                      >
                                        ×
                                      </button>
                                    )}
                                    <span
                                      className={
                                        test?.status === 'ok'
                                          ? `${styles.mapTestState} ${styles.mapTestOk}`
                                          : test?.status === 'missing'
                                            ? `${styles.mapTestState} ${styles.mapTestMissing}`
                                            : test?.status === 'error'
                                              ? `${styles.mapTestState} ${styles.mapTestError}`
                                              : styles.mapTestState
                                      }
                                      data-route-map-test-state={test?.status}
                                      aria-live="polite"
                                    >
                                      {test?.message ?? ''}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )
                })()}
              </section>
            </div>
          )}
        </section>
        </div>
      </div>
      )}
      {profileDrawerOpen && selected && profileDrawerBounds
        ? createPortal(
            <div
              className={styles.profileDrawerLayer}
              style={profileDrawerBounds}
            >
              <div
                className={styles.profileDrawerBackdrop}
                aria-hidden
                onPointerDown={() => setProfileDrawerOpen(false)}
              />
              <aside
                className={styles.profileDrawer}
                data-settings-profile-drawer
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-profile-drawer-title"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <header className={styles.profileDrawerHead}>
                  <h2 id="settings-profile-drawer-title">编辑</h2>
                  <button
                    type="button"
                    className={styles.profileDrawerClose}
                    data-settings-profile-close
                    aria-label="关闭编辑"
                    title="关闭"
                    onClick={() => setProfileDrawerOpen(false)}
                  >
                    <IconClose size={18} />
                  </button>
                </header>
                <div className={styles.profileDrawerBody}>
                  <div className={styles.profileAvatarPreview}>
                    <SettingsChannelAvatar
                      protocol={selected.protocol}
                      icon={profileIconDraft}
                      name={profileNameDraft}
                      size={76}
                    />
                  </div>
                  <div className={styles.profileAvatarActions}>
                    <label
                      className={styles.profileAvatarButton}
                      data-settings-profile-upload
                    >
                      <IconImageUpload size={16} />
                      图片上传
                      <input
                        ref={profileFileRef}
                        className={styles.fileInput}
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          void handleProfileIconFile(event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.profileAvatarButton}
                      data-settings-profile-builtin
                      onClick={() => setProfileIconDraft(null)}
                    >
                      <IconChannels size={16} />
                      内置头像
                    </button>
                    <button
                      type="button"
                      className={styles.profileAvatarButton}
                      data-settings-profile-reset
                      onClick={() => setProfileIconDraft(selected.icon)}
                    >
                      <IconResetAvatar size={16} />
                      重置头像
                    </button>
                  </div>
                  <label className={styles.profileField}>
                    <span>
                      服务商名称 <b aria-hidden>*</b>
                    </span>
                    <input
                      className={styles.profileInput}
                      data-settings-profile-name
                      value={profileNameDraft}
                      onChange={(event) => setProfileNameDraft(event.target.value)}
                    />
                  </label>
                </div>
                <footer className={styles.profileDrawerFoot}>
                  <button
                    type="button"
                    className={styles.profileCancel}
                    onClick={() => setProfileDrawerOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className={styles.profileSave}
                    data-settings-profile-save
                    disabled={profileSaving || !profileNameDraft.trim()}
                    onClick={() => void saveProfileDrawer()}
                  >
                    {profileSaving ? '保存中' : '保存'}
                  </button>
                </footer>
              </aside>
            </div>,
            document.body,
          )
        : null}
      {channelMenu && menuChannel
        ? createPortal(
            <div
              ref={channelMenuRef}
              className={styles.channelContextMenu}
              data-channel-context-menu={menuChannel.id}
              role="menu"
              aria-label={`${menuChannel.name} 操作`}
              style={{ left: menuLeft, top: menuTop, width: menuWidth }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                event.preventDefault()
                const items = [
                  ...(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                    []),
                ]
                if (items.length === 0) return
                const current = items.indexOf(document.activeElement as HTMLButtonElement)
                const delta = event.key === 'ArrowDown' ? 1 : -1
                items[(current + delta + items.length) % items.length]?.focus()
              }}
            >
              {menuConfirmDelete ? (
                <>
                  <p className={styles.channelMenuConfirmText}>
                    删除「{menuChannel.name}」？不可撤销
                  </p>
                  <button
                    type="button"
                    className={`${styles.channelMenuItem} ${styles.channelMenuItemDanger}`}
                    role="menuitem"
                    data-channel-menu-delete-confirm={menuChannel.id}
                    disabled={busy}
                    onClick={() => void handleRemove(menuChannel.id)}
                  >
                    <IconDelete size={16} />
                    确认删除
                  </button>
                  <button
                    type="button"
                    className={styles.channelMenuItem}
                    role="menuitem"
                    data-channel-menu-delete-cancel
                    onClick={() => setMenuConfirmDelete(false)}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.channelMenuItem}
                    role="menuitem"
                    data-channel-menu-edit={menuChannel.id}
                    onClick={() => editChannel(menuChannel.id)}
                  >
                    <IconEdit size={16} />
                    编辑
                  </button>
                  {!menuBuiltin ? (
                    <button
                      type="button"
                      className={`${styles.channelMenuItem} ${styles.channelMenuItemDanger}`}
                      role="menuitem"
                      data-channel-menu-delete={menuChannel.id}
                      onClick={() => setMenuConfirmDelete(true)}
                    >
                      <IconDelete size={16} />
                      删除
                    </button>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}


