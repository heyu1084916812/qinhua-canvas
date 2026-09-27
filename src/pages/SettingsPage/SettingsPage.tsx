import { useEffect, useMemo, useSyncExternalStore, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import {
  maskTokenTail,
  protocolShort,
  SUPPORTED_PROTOCOLS,
  type Channel,
} from '../../domain/project/channel'
import {
  applySelection,
  CATEGORY_FILTERS,
  categoryLabel,
  filterModels,
  groupModelsByCategory,
  initialChecked,
  removeModel,
  type CategoryFilter,
} from '../../domain/project/modelSelection'
import styles from './SettingsPage.module.css'
import { SkillsPanel } from '../SkillsPage/SkillsPanel'
import { usePresetText } from '../../app/providers/PresetTextProvider'
import {
  PRESET_TEXT_MAX,
  presetTextEntries,
  validatePresetText,
  type PromptToolAction,
} from '../../domain/prompt/presetText'
import { IconPrompt, IconGeneration, IconBoard } from '../../workbenches/canvas/toolbar/icons'
import {
  ROUTE_STRATEGIES,
  type RouteStrategy,
} from '../../domain/project/modelRouting'
import { PRESET_MODELS } from '../../domain/project/modelPresets'

/**
 * 后台的三个分区（用户 2026-09-25「后台中枢」）。
 *
 * 以往这里是「后台模型设置」——只管渠道。而用户要管的东西有三类：
 * 渠道（连什么）、功能预设词（内置动作怎么做）、技能库（自己新增什么动作）。
 * 三者都是「配置」，只是此前散在三个入口（设置页 / 代码常量 / 独立技能页）。
 */
type SettingsSection = 'channels' | 'presets' | 'skills'

/**
 * 侧栏导航项（用户 2026-09-25：「渠道、功能等替换成这种风格的 ui」——
 * 参考图是**左侧竖排图标导航 + 右侧内容区**，此处只搬结构，配色全走本项目令牌）。
 *
 * 图标复用画布工具栏那一套（`toolbar/icons`），不另画三个 ——
 * 「渠道 / 预设词 / 技能」在语感上分别对应「连生成 / 提示词 / 画板」的意象，
 * 且同一套图标让两个页面看起来是一家的。
 */
const SECTIONS: readonly { id: SettingsSection; label: string; Icon: typeof IconPrompt }[] = [
  { id: 'channels', label: '渠道', Icon: IconGeneration },
  { id: 'presets', label: '功能预设词', Icon: IconPrompt },
  { id: 'skills', label: '技能库', Icon: IconBoard },
]

/**
 * 后台模型设置页（产品文档 §7）。
 * 左：渠道列表（可拖动排序）；右：选中渠道的配置（名称 / 地址 / 加密令牌 / 启用 / 协议 / 验证）
 * + 模型管理（§7.4：拉取 → 勾选 → 已选三行分组）。
 * 所有写操作经 useChannels() 的 channel store，直连 storage + 凭据层，不进画布 undo 栈。
 */
export function SettingsPage() {
  const channels = useChannels()
  /** 功能预设词（后台中枢）：三区之一，改的是「优化 / 翻译 / 反推」做什么 */
  const presetText = usePresetText()
  const [section, setSection] = useState<SettingsSection>('channels')
  // 来源路径由工作台顶栏在跳转时带上（`state.from`）。据此把返回按钮指回**刚才那个项目**，
  // 而不是一律丢回首页——在画布中间去配个渠道，回来还得重新找项目，是纯粹的摩擦。
  // 直接输 URL 进来（无 state）时回落首页。
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? null
  const cameFromWorkbench = typeof from === 'string' && from.startsWith('/canvas/')
  const backTo = cameFromWorkbench ? from : '/'
  const backLabel = cameFromWorkbench ? '← 返回画布' : '← 返回首页'
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
      if (detect.status === 'ok' && detect.protocol) return `✓ 已识别协议 · ${protoLabel(detect.protocol)}`
      if (detect.status === 'error') return `✗ 未识别出协议 · ${detect.message ?? '所有候选协议均未通过'}`
      return null
    }
    const label = protoLabel(verifiedFor?.protocol ?? '')
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
  }, [action, verifiedFor, verify, modelsResult, detect])

  // mock 提示只在**真的拿 mock 验了地址**时出现（探测的候选表不含 mock，故不受其影响）。
  const showMockNote = action === 'verify' && verify.status === 'ok' && verifiedFor?.protocol === 'mock'
  const tokenHint = selected?.tokenTail ? maskTokenTail(selected.tokenTail) : ''

  /** 预设词的界面模型（用户改过的 + 出厂默认，由 domain 组装，本页不做回落判断） */
  const presets = presetTextEntries(presetText.overrides)

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.back} to={backTo} data-settings-back>
          {backLabel}
        </Link>
        <h1 className={styles.heading}>后台设置</h1>
      </header>

      {/*
        左侧竖排导航 + 右侧内容区（用户 2026-09-25 参考图的**结构**）。

        只搬结构：参考图里那块墨绿侧栏与亮黄选中态不取（本项目没有这两个颜色，
        且 §3.3 定的是「无投影 + 1px 细描边」），配色一律走既有令牌。

        `data-settings-section` 锚点原样保留 —— 冒烟按它切区，换成侧栏不该让断言失效。
      */}
      <div className={styles.shell} data-settings-shell>
        <nav className={styles.rail} role="tablist" aria-label="后台分区">
          {SECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              className={section === id ? styles.railOn : styles.railBtn}
              data-settings-section={id}
              onClick={() => setSection(id)}
            >
              <span className={styles.railIcon} aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className={styles.railLabel}>{label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.content}>
      {section === 'presets' ? (
        <PresetTextSection presets={presets} presetText={presetText} />
      ) : section === 'skills' ? (
        <div className={styles.skillsHost} data-settings-skills>
          <SkillsPanel />
        </div>
      ) : (
      <div className={styles.layout} data-settings-card>
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
                      {protocolShort(ch.protocol)}
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
          </ul>
          <button className={styles.addBtn} data-channel-add onClick={handleCreate}>
            + 新增渠道
          </button>
          {channelsList.length > 0 && <p className={styles.dragHint}>按住条目上下拖动可排序</p>}

          {/* 删除渠道（§7.2）：挪到「+ 新增渠道」正下方——增/删是同类的**列表级**操作，挨着才找得到；
              它此前孤零零挂在右栏最底部，既远，又容易被读成「保存类」按钮。
              删除不可逆，所以走**就地二次确认**而不是点一下就走。 */}
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
        </aside>

        <section className={styles.editor}>
          {!selected ? (
            <div className={styles.placeholder}>从左侧选择，或新增一个渠道</div>
          ) : (
            <div className={styles.form}>
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

              <div className={styles.fieldRow}>
                <label className={styles.switch}>
                  <input type="checkbox" checked={enabled} onChange={handleToggleEnabled} />
                  <span>已启用（出现在画布平台选择中）</span>
                </label>
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
                    onChange={(e) => setProtocol(e.target.value)}
                  >
                    {SUPPORTED_PROTOCOLS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
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
                <button className={styles.ghostBtn} data-settings-verify disabled={busy} onClick={handleVerify}>
                  验证地址
                </button>
              </div>

              <div className={styles.status} role="status" aria-live="polite" data-settings-status>
                {statusLine}
              </div>

              {showMockNote && (
                <p className={styles.offlineNote} data-settings-mock-note>
                  Mock 是离线协议：不发任何网络请求、也不会去访问上面填的地址，所以验证必然通过。
                  要联调真实中转，把「协议」切到「OpenAI 兼容 · 生图」后再点一次「验证地址」，
                  或者直接点「验证协议」让它自己认。
                </p>
              )}

              {/* —— 模型管理（§7.4）—— */}
              <section className={styles.models} data-settings-models>
                <div className={styles.modelsHead}>
                  <div className={styles.modelsTitleBox}>
                    <span className={styles.label}>模型列表</span>
                    <span className={styles.modelsSub}>从上游 api 自动拉取所有可用模型</span>
                  </div>
                  <button className={styles.ghostBtn} disabled={busy} onClick={handleRefresh}>
                    拉取模型
                  </button>
                  <button className={styles.ghostBtn} disabled={busy || selected.modelCache.length === 0} onClick={openPanel}>
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

              {/* —— 选路与模型映射（§7.4.1，M7-2）—— */}
              <section className={styles.route} data-settings-route>
                <div className={styles.modelsHead}>
                  <div className={styles.modelsTitleBox}>
                    <span className={styles.label}>选路策略</span>
                    <span className={styles.modelsSub}>
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
                  映射列表 = **固定显示名** + 该渠道已勾选的模型，后者去重。

                  为什么固定名一定要在这里出现（用户 2026-09-27）：
                  画布下拉列的就是这几个名字，它们**不一定出现在本站的模型清单里**
                  （例如前端叫 `GPT Image 2.5 Flare`，本站叫 `gpt-image-2.5-flare`）。
                  若这里只列「已勾选模型」，用户就没地方填这个翻译 ——
                  在画布选完固定名，请求会带着显示名发出去并被上游拒绝。
                */}
                {(() => {
                  const presetIds = PRESET_MODELS.map((m) => m.id)
                  const extraIds = selected.models
                    .map((m) => m.id)
                    .filter((id) => !presetIds.includes(id))
                  const rows = [...presetIds, ...extraIds]
                  return (
                    <>
                      <p className={styles.modelsSub} data-route-map-help>
                        下面这些是画布里可选的显示名；只填你本站有的那几个即可。
                      </p>
                      <div className={styles.mapList}>
                        {rows.map((id) => {
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
                              <span className={styles.mapName} title={id}>
                                {id}
                              </span>
                              <input
                                className={`${styles.input} ${styles.mapInput}`}
                                data-route-map-input={id}
                                placeholder="留空 = 按原名发送"
                                value={value}
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
                      </div>
                    </>
                  )
                })()}
              </section>
            </section>
            </div>
          )}
        </section>
      </div>
      )}
        </div>
      </div>
    </div>
  )
}

/**
 * 功能预设词分区（后台中枢，用户 2026-09-25）。
 *
 * 三条固定动作（优化 / 翻译 / 反推）各一段可编辑的**系统指令**。
 * 它是「改造内置动作」——与技能区「新增自己的动作」是两件事，界面上也分区放。
 *
 * 每条的编辑是**草稿态**：先写在本地，点「保存」才落库；这与设置页既有的
 * 渠道表单、模型选择面板同一条口径（中途反悔不该留下半份改动）。
 */
function PresetTextSection({
  presets,
  presetText,
}: {
  presets: ReturnType<typeof presetTextEntries>
  presetText: ReturnType<typeof usePresetText>
}) {
  /** action → 正在编辑的草稿；只有被点开的那条在草稿里出现 */
  const [drafts, setDrafts] = useState<Partial<Record<PromptToolAction, string>>>({})
  const [busy, setBusy] = useState<PromptToolAction | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const save = async (action: PromptToolAction) => {
    const draft = drafts[action]
    if (draft === undefined) return
    const err = validatePresetText(draft)
    if (err) {
      setNotice({ kind: 'error', text: err })
      return
    }
    setBusy(action)
    try {
      await presetText.save(action, draft)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[action]
        return next
      })
      setNotice({ kind: 'ok', text: '已保存' })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  /** 恢复默认 = 清掉覆盖值（写 null），于是它与「从没改过」是同一种状态 */
  const restore = async (action: PromptToolAction) => {
    setBusy(action)
    try {
      await presetText.save(action, null)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[action]
        return next
      })
      setNotice({ kind: 'ok', text: '已恢复默认' })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.presetHost} data-settings-presets>
      <p className={styles.presetLead}>
        提示词节点上的这三个按钮各有一段**系统指令**。改这里就是改它们的行为 ——
        想新增一个自己的动作，去「技能库」。
      </p>
      {notice && (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-settings-preset-notice={notice.kind}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </div>
      )}
      <div className={styles.presetList}>
        {presets.map((p) => {
          const draft = drafts[p.id]
          const editing = draft !== undefined
          const value = editing ? draft : p.content
          return (
            <section key={p.id} className={styles.presetCard} data-preset-card={p.id}>
              <header className={styles.presetHead}>
                <span className={styles.presetName} data-preset-label>
                  {p.label}
                </span>
                {!p.isDefault && (
                  <span className={styles.presetChanged} data-preset-changed>
                    已改
                  </span>
                )}
                <span className={styles.presetHint}>{p.hint}</span>
              </header>
              <textarea
                className={styles.presetTextarea}
                data-preset-text={p.id}
                value={value}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
              <div className={styles.presetFoot}>
                <span className={styles.presetCounter}>
                  {value.length} / {PRESET_TEXT_MAX}
                </span>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  data-preset-restore={p.id}
                  disabled={busy !== null || p.isDefault}
                  onClick={() => void restore(p.id)}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  data-preset-save={p.id}
                  disabled={busy !== null || !editing}
                  onClick={() => void save(p.id)}
                >
                  保存
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function protoLabel(proto: string): string {
  return SUPPORTED_PROTOCOLS.find((p) => p.value === proto)?.label ?? proto
}
