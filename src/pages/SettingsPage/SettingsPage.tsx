import { useEffect, useMemo, useSyncExternalStore, useState } from 'react'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import {
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
import { PRESET_MODELS } from '../../domain/project/modelPresets'

/**
 * 模型映射区的三个分组（用户 2026-09-27 第 9 轮）。
 *
 * `category` 必须与 `modelPresets` 里的取值**同字面**（`image | chat | video`）——
 * 这里只是给它配了个中文标题，没有第二份分类口径。
 * 顺序 = 用户说的顺序：生图 → 对话 → 视频。
 */
const MAP_GROUPS = [
  { category: 'image' as const, title: '生图模型' },
  { category: 'chat' as const, title: '对话模型' },
  { category: 'video' as const, title: '视频模型' },
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
export function SettingsPage() {
  const channels = useChannels()
  const channelsList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
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

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState('mock')
  const [baseUrl, setBaseUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [tokenSaved, setTokenSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 删除渠道的就地二次确认（§7.2）：删除不可逆，点一下就走太容易误触 */
  const [confirmDelete, setConfirmDelete] = useState(false)
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

  /**
   * 协议目录版本号。`protocolCatalog()` 每次返回**新对象**，但 useSyncExternalStore
   * 只在 store 快照变化时重渲染；自建协议增删后靠这个计数把目录重算一遍，
   * 让新协议立刻出现在下拉里（不必刷新页面）。
   */
  const [catalogVersion, setCatalogVersion] = useState(0)
  const catalog = useMemo(() => channels.protocolCatalog(), [channels, catalogVersion])
  /** 下拉里的全部协议（含 pending：它们显示为“待支持”且不可选，见协议区渲染） */
  const protocolOptions = catalog.all
  /** 当前所选协议的说明（CLI 网关等有前提的协议必须显示出来，否则用户会填错地址） */
  const selectedProtocolNote = protocolById(protocol, catalog)?.note ?? ''

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

  // 选中变化 → 同步表单。
  //
  // 依赖**刻意只放 `selectedId`**，不跟随 `selected`：表单是「这条渠道」的初始化，
  // 而 store 每次落库（验证回写 modelCache、启用开关回写 enabled）都会产生新的渠道对象。
  // 若跟着 `selected` 走，用户在下拉里刚选好的协议会被静默弹回库里旧值——
  // 表现为「刚切到 OpenAI 兼容，点一下别处就又变回 Mock」，且没有任何提示。
  useEffect(() => {
    const ch = channels.getState().channels.find((c) => c.id === selectedId) ?? null
    setPanelOpen(false)
    // 换一条渠道 → 撤掉上一条残留的删除确认态，否则「删除 A？」会跟着光标挂到 B 头上。
    setConfirmDelete(false)
    setMapDrafts({})
    if (!ch) return
    setName(ch.name)
    setProtocol(ch.protocol)
    setBaseUrl(ch.baseUrl)
    setEnabled(ch.enabled)
    setToken('')
    setShowToken(false)
    void channels.hasToken(ch.id).then(setTokenSaved)
  }, [selectedId, channels])

  const handleCreate = async () => {
    const ch = await channels.create({ name: '新建渠道', protocol: 'mock', baseUrl: '' })
    setSelectedId(ch.id)
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
      name: name.trim() || '新建渠道',
      protocol,
      baseUrl: baseUrl.trim(),
      enabled,
    })
    syncForm(saved)
    return saved
  }

  const handleSaveConfig = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await persistForm()
    } finally {
      setBusy(false)
    }
  }

  const handleSaveToken = async () => {
    if (!selectedId || !token) return
    setBusy(true)
    try {
      await channels.saveToken(selectedId, token)
      setTokenSaved(true)
      setToken('')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveToken = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await channels.removeToken(selectedId)
      setTokenSaved(false)
      setToken('')
    } finally {
      setBusy(false)
    }
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
      await channels.verify(selectedId)
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
      const hit = await channels.detectProtocol(selectedId)
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
      await channels.refreshModels(selectedId)
    } finally {
      setBusy(false)
    }
  }

  /** 二次确认后才真正删除（按钮在左栏「+ 新增渠道」下方） */
  const handleRemove = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await channels.remove(selectedId)
      setSelectedId(null)
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const handleToggleEnabled = async () => {
    if (!selectedId) return
    const next = !enabled
    setEnabled(next)
    await channels.setEnabled(selectedId, next)
  }

  // —— 模型管理（§7.4）——

  const openPanel = () => {
    if (!selected) return
    // 打开时此前已选的保持勾上（§7.4「可再次打开面板勾选此前未选中的模型」）
    setDraftChecked(initialChecked(selected.models))
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
      await channels.setModels(selectedId, applySelection(selected.models, selected.modelCache, draftChecked))
      setPanelOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const dropSelectedModel = async (modelId: string) => {
    if (!selectedId || !selected) return
    await channels.setModels(selectedId, removeModel(selected.models, modelId))
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
    () => (selected ? filterModels(selected.modelCache, draftCategory, draftKeyword) : []),
    [selected, draftCategory, draftKeyword],
  )
  const selectedGroups = useMemo(
    () => groupModelsByCategory(selected?.models ?? []).filter((g) => g.models.length > 0),
    [selected],
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
    if (nextDefault && (!current || current === prevDefault)) setBaseUrl(nextDefault)
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
    if (verify.status === 'checking') return '正在验证地址…'
    if (verify.status === 'ok')
      return `✓ 地址可达 · ${label}${typeof verify.latency === 'number' ? ` · ${verify.latency}ms` : ''}`
    if (verify.status === 'error') return `✗ ${verify.message ?? '地址不可达'}`
    return null
  }, [action, verifiedFor, verify, modelsResult, detect, catalog])

  // mock 提示只在**真的拿 mock 验了地址**时出现（探测的候选表不含 mock，故不受其影响）。
  const showMockNote = action === 'verify' && verify.status === 'ok' && verifiedFor?.protocol === 'mock'
  const tokenHint = selected?.tokenTail ? maskTokenTail(selected.tokenTail) : ''

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
        <div className={styles.workarea} data-settings-workarea>
          <aside className={styles.sidebar}>
          <ul className={styles.list}>
            {channelsList.map((ch: Channel) => (
              <li key={ch.id}>
                <button
                  className={ch.id === selectedId ? `${styles.item} ${styles.itemActive}` : styles.item}
                  data-channel-item
                  data-channel-id={ch.id}
                  draggable
                  onDragStart={() => setDragId(ch.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    void dropOnChannel(ch.id)
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => setSelectedId(ch.id)}
                >
                  <span className={styles.itemTop}>
                    <span className={styles.itemName}>{ch.name}</span>
                    <span className={styles.itemProto} data-channel-proto>
                      {protocolShort(ch.protocol, catalog)}
                    </span>
                  </span>
                  <span className={styles.itemMeta}>
                    {ch.enabled && <span className={styles.itemOn}>已启用</span>}
                    <span className={styles.itemModels}>
                      {ch.models.length > 0 ? `${ch.models.length} 个模型` : '未选模型'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {channelsList.length === 0 && <li className={styles.empty}>还没有渠道，点下方「+ 新增渠道」</li>}

            {/* 列表级操作跟在**最后一条渠道**后面（用户 2026-09-28）：
                它们此前被 `flex: 1` 的滚动列表挤到左栏最底部，渠道少时离条目很远；
                放回列表尾部后，新增/删除仍是同一组操作，但视线不用跨越空白。
                删除不可逆，所以继续走就地二次确认。 */}
            <li className={styles.listActions} data-channel-actions>
              <button className={styles.addBtn} data-channel-add onClick={handleCreate}>
                + 新增渠道
              </button>
              {channelsList.length > 0 && <p className={styles.dragHint}>按住条目上下拖动可排序</p>}

              <div className={styles.dangerZone}>
                {!confirmDelete ? (
                  <button
                    className={styles.dangerBtn}
                    data-channel-remove
                    disabled={!selectedId || busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除渠道
                  </button>
                ) : (
                  <div className={styles.confirmBox} data-channel-remove-confirm>
                    <span className={styles.confirmText}>删除「{selected?.name ?? ''}」？不可撤销</span>
                    <div className={styles.confirmRow}>
                      <button
                        className={styles.dangerSolid}
                        data-channel-remove-yes
                        disabled={busy}
                        onClick={handleRemove}
                      >
                        确认删除
                      </button>
                      <button
                        className={styles.ghostBtn}
                        data-channel-remove-no
                        onClick={() => setConfirmDelete(false)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          </ul>
        </aside>

        <section className={styles.editor} data-settings-editor>
          {!selected ? (
            <div className={styles.placeholder}>从左侧选择，或新增一个渠道</div>
          ) : (
            <div className={styles.form} data-settings-form>
              {/* —— 基本信息（§7.2）—— */}
              <section className={styles.card} data-settings-basics>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>基本信息</span>
                  <span className={styles.cardSub}>这条渠道在画布里显示的名字</span>
                </div>
                <div className={styles.fieldRowTop}>
                  <label className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>名称</span>
                    <input
                      className={styles.input}
                      data-settings-name
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button
                    className={styles.primary}
                    data-settings-save
                    disabled={busy}
                    onClick={handleSaveConfig}
                  >
                    保存配置
                  </button>
                </div>

                <div className={styles.fieldRow}>
                  <label className={styles.switch}>
                    <input
                      className={styles.switchInput}
                      type="checkbox"
                      checked={enabled}
                      onChange={handleToggleEnabled}
                    />
                    <span className={styles.switchTrack} aria-hidden="true" />
                    <span>已启用（出现在画布平台选择中）</span>
                  </label>
                </div>
              </section>

              {/* —— 连接与鉴权（§7.3）—— */}
              <section className={styles.card} data-settings-connection>
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
                  />
                </label>

                <div className={styles.field}>
                  <span className={styles.label}>令牌（API Key）</span>
                  <div className={styles.tokenRow}>
                    <input
                      className={styles.input}
                      type={showToken ? 'text' : 'password'}
                      placeholder={tokenSaved ? '已保存（重新输入可覆盖）' : '粘贴 API Key'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <button className={styles.ghostBtn} onClick={() => setShowToken((v) => !v)}>
                      {showToken ? '隐藏' : '显示'}
                    </button>
                    <button
                      className={styles.ghostBtn}
                      data-settings-token-save
                      disabled={!token || busy}
                      onClick={handleSaveToken}
                    >
                      保存
                    </button>
                    <button
                      className={styles.ghostBtn}
                      data-settings-token-remove
                      disabled={!tokenSaved || busy}
                      onClick={handleRemoveToken}
                    >
                      删除
                    </button>
                  </div>
                  {/* 尾 4 位是唯一的身份线索：看不出来存的是哪把钥匙，就只能靠「删了重存」来确认。
                      整串明文不回显（凭据层只在调用前注入），所以这里只给尾号。 */}
                  {tokenSaved && (
                    <span className={styles.saved} data-settings-token-tail>
                      ● 令牌已加密保存{tokenHint ? ` · ${tokenHint}` : ''}
                    </span>
                  )}
                </div>

                {/* 协议区（§7.3）：协议下拉 + 三个动作按钮。
                    「验证地址」只回答地址通不通；「验证协议」按候选表试打并把命中的协议填进下拉；
                    「拉取模型」在下方模型区分内。三者职责不重叠，所以按钮文案也是三句不同的话。 */}
                <div className={styles.protocolRow}>
                  <label className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>协议</span>
                    <select
                      className={styles.input}
                      data-settings-protocol
                      value={protocol}
                      onChange={(e) => handleProtocolChange(e.target.value)}
                    >
                      {!protocolOptions.some((p) => p.id === protocol) && (
                        <option value={protocol}>未知协议（{protocol}）</option>
                      )}
                      {PROTOCOL_GROUPS.map(({ kind, label }) => {
                        const items = protocolOptions.filter((p) => p.kind === kind)
                        if (items.length === 0) return null
                        return (
                          <optgroup key={kind} label={label}>
                            {items.map((p) => (
                              <option key={p.id} value={p.id} disabled={p.status !== 'ready'}>
                                {p.name}
                                {p.status !== 'ready' ? '（待支持）' : ''}
                              </option>
                            ))}
                          </optgroup>
                        )
                      })}
                    </select>
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

                <div className={styles.status} role="status" aria-live="polite" data-settings-status>
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
              <section className={styles.card} data-settings-models>
                <div className={styles.modelsHead}>
                  <div className={styles.modelsTitleBox}>
                    <span className={styles.cardTitle}>模型列表</span>
                    <span className={styles.cardSub}>从上游 api 自动拉取所有可用模型</span>
                  </div>
                  <button className={styles.ghostBtn} disabled={busy} onClick={handleRefresh}>
                    拉取模型
                  </button>
                  <button
                    className={styles.ghostBtn}
                    disabled={busy || selected.modelCache.length === 0}
                    onClick={openPanel}
                  >
                    选择模型
                  </button>
                </div>

                {selected.modelCache.length === 0 ? (
                  <p className={styles.modelsEmpty} data-models-empty>
                    还没有拉取过模型。点「拉取模型」从上游取回全部可用模型，再点「选择模型」勾选要用的。
                  </p>
                ) : selectedGroups.length === 0 ? (
                  <p className={styles.modelsEmpty} data-models-none>
                    上游有 {selected.modelCache.length} 个模型，但还没勾选任何一个——画布与漫画的模型下拉只列这里选中的。
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
                            <span className={styles.optionCat}>{categoryLabel(m.category)}</span>
                          </label>
                        </li>
                      ))}
                      {draftList.length === 0 && (
                        <li className={styles.optionEmpty}>
                          {selected.modelCache.length === 0 ? '没有可选的模型，先「拉取模型」' : '没有匹配的模型'}
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

              {/* —— 选路与模型映射（§7.4.1，M7-2）—— */}
              <section className={styles.card} data-settings-route>
                <div className={styles.modelsHead}>
                  <div className={styles.modelsTitleBox}>
                    <span className={styles.cardTitle}>选路策略</span>
                    <span className={styles.cardSub}>
                      同一个模型在多条渠道都能出图时，按什么规则挑一条
                    </span>
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <label className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>策略</span>
                    <select
                      className={styles.input}
                      data-route-strategy
                      value={selected.routeStrategy}
                      onChange={(e) =>
                        void channels.update(selectedId!, {
                          routeStrategy: e.target.value as RouteStrategy,
                        })
                      }
                    >
                      {ROUTE_STRATEGIES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}·{s.hint}
                        </option>
                      ))}
                    </select>
                  </label>
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

                {selected.routeStrategy === 'performance' &&
                  selected.lastTestLatency == null && (
                    <p className={styles.modelsEmpty}>
                      还没测过延迟，这条渠道会排在测过的后面。点上面的「验证地址」测一次。
                    </p>
                  )}

                <div className={styles.mapHead}>
                  <span className={styles.label}>模型映射（前端显示名 → 本站点真实 ID）</span>
                  <span className={styles.modelsSub}>
                    左边是画布里显示的名字，填这一站点实际要发的模型 ID；留空即按原名发送
                  </span>
                </div>

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
                  const presetIds = PRESET_MODELS.map((m) => m.id)
                  /**
                   * 一行的 `key` 固定取预设显示名，标签与它一致。
                   *
                   * 映射保存的就是「显示名 → 本站真实 ID」，上游 ID 不占一个显示槽位。
                   */
                  const rows = PRESET_MODELS.map((m) => ({
                    key: m.id,
                    label: m.id,
                    category: m.category,
                  }))
                  return (
                    <>
                      <p className={styles.modelsSub} data-route-map-help>
                        左边是画布里可选的显示名，右边填你本站对应的模型 ID；
                        只填你本站有的那几个即可。带下拉的可以直接从**已勾选的同类模型**里挑。
                      </p>
                      {/*
                        按类别分三组（用户 2026-09-27 第 9 轮）：
                        「模型映射的部分也需要分生图模型，对话模型和视频模型」。
                        上一版是一长条平铺 15 个名字 —— 找某个生图模型要扫过对话与视频。

                        分类取自 `PRESET_MODELS` 自己的 `category`，**不在这里另写一份**
                        （写两份必然漂移，那正是本项目反复踩的坑）。
                      */}
                      {MAP_GROUPS.map(({ category, title }) => {
                        const groupRows = rows.filter((r) => r.category === category)
                        if (groupRows.length === 0) return null
                        /*
                         * 候选 = 该渠道**已勾选且同类**的模型 ID。
                         * 这是用户要的「没填写的话可以下拉选择已经选择好类别的模型」——
                         * 上游 ID 本来就躺在已勾选清单里，让人重复默写没有道理。
                         * 用 `<datalist>` 而不是 `<select>`：仍允许手填
                         * （模型没勾选、或 ID 不在清单里的情况依然存在）。
                         */
                        /* 候选取法见 domain 纯函数 routeMapOptions（已勾选优先、缺失回落已拉取） */
                        const options = routeMapOptions(category, selected.models, selected.modelCache)
                        const listId = `route-map-${selectedId}-${category}`
                        return (
                          <div key={category} className={styles.mapGroup} data-route-map-group={category}>
                            <div className={styles.mapGroupTitle}>{title}</div>
                            <div className={styles.mapList}>
                              {groupRows.map(({ key: id, label }) => {
                                const saved = selected.modelMap[id] ?? ''
                                const draft = mapDrafts[id]
                                const value = draft ?? saved
                                const isPreset = presetIds.includes(id)
                                return (
                                  <div
                                    key={id}
                                    className={styles.mapRow}
                                    data-route-map-row={id}
                                    data-route-map-preset={isPreset ? '1' : '0'}
                                  >
                                    <span className={styles.mapName} title={id} data-route-map-label>
                                      {label}
                                    </span>
                                    <input
                                      className={`${styles.input} ${styles.mapInput}`}
                                      data-route-map-input={id}
                                      placeholder="留空 = 按原名发送"
                                      value={value}
                                      list={listId}
                                      onChange={(e) =>
                                        setMapDrafts((prev) => ({ ...prev, [id]: e.target.value }))
                                      }
                                    />
                                    <button
                                      className={styles.ghostBtn}
                                      data-route-map-save={id}
                                      disabled={value === saved}
                                      onClick={async () => {
                                        await channels.setModelMapping(selectedId!, id, value)
                                        setMapDrafts((prev) => {
                                          const next = { ...prev }
                                          delete next[id]
                                          return next
                                        })
                                      }}
                                    >
                                      保存
                                    </button>
                                  </div>
                                )
                              })}
                              {options.length > 0 && (
                                <datalist id={listId} data-route-map-options={category}>
                                  {options.map((o) => (
                                    <option key={o} value={o} />
                                  ))}
                                </datalist>
                              )}
                            </div>
                          </div>
                        )
                      })}
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
    </div>
  )
}


