import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { HostingPage } from '../pages/HostingPage/HostingPage'
import { SettingsPage } from '../pages/SettingsPage/SettingsPage'
import { StoragePanel } from '../features/settings/StoragePanel'
import { CliPanel } from '../features/settings/CliPanel'
import { FontManagerPanel } from '../features/settings/FontManagerPanel'
import { CanvasLookPanel } from '../features/settings/CanvasLookPanel'
import { ThemePanel } from '../features/settings/ThemePanel'
import { ShortcutsPanel } from '../features/settings/ShortcutsPanel'
import { SnapshotsPanel } from '../features/settings/SnapshotsPanel'
import { PackPanel } from '../features/settings/PackPanel'
import { HelpPanel } from '../features/settings/HelpPanel'
import { AboutPanel } from '../features/settings/AboutPanel'
import { DefaultParamsPanel } from '../features/settings/DefaultParamsPanel'
import { AgentMemoryPanel } from '../features/settings/AgentMemoryPanel'
import { AllLogsPanel } from '../features/settings/AllLogsPanel'
import { NotifyPanel } from '../features/settings/NotifyPanel'
import { BackupPanel } from '../features/settings/BackupPanel'
import { IconClose } from './AppSidebarIcons'
import {
  IconAbout,
  IconAppearance,
  IconBackup,
  IconChannels,
  IconCli,
  IconDefaults,
  IconHelp,
  IconHosting,
  IconKeyboard,
  IconLogs,
  IconMemory,
  IconNotify,
  IconPacks,
  IconPalette,
  IconSnapshot,
  IconStorage,
  IconTypography,
} from './SettingsIcons'
import {
  GLOBAL_SETTINGS_GROUPS,
  GLOBAL_SETTINGS_SECTIONS,
  closeGlobalSettings,
  getGlobalSettings,
  matchSettingsSections,
  openGlobalSettings,
  subscribeGlobalSettings,
  type GlobalSettingsSection,
} from '../state/ui/globalSettings'
import styles from './GlobalSettingsOverlay.module.css'

/**
 * 栏目 → 图标（用户 2026-10-10 #8）。
 *
 * 用**显式映射**而不是给每个栏目挂一个 React 节点：栏目表（`GLOBAL_SETTINGS_SECTIONS`）
 * 是数据、`state/ui` 里不该出现 JSX；映射放在这里，新增栏目忘了配图标会被 TS 立刻指出
 * （`Record<GlobalSettingsSection, …>` 少一个键就报错）。
 */
const SECTION_ICONS: Record<GlobalSettingsSection, ComponentType<{ size?: number }>> = {
  channels: IconChannels,
  cli: IconCli,
  hosting: IconHosting,
  storage: IconStorage,
  allLogs: IconLogs,
  appearance: IconPalette,
  typography: IconTypography,
  canvasLook: IconAppearance,
  backup: IconBackup,
  snapshots: IconSnapshot,
  defaults: IconDefaults,
  agentMemory: IconMemory,
  packs: IconPacks,
  notify: IconNotify,
  help: IconHelp,
  shortcuts: IconKeyboard,
  about: IconAbout,
}

const SECTION_INTROS: Record<GlobalSettingsSection, string> = {
  channels: '配置模型服务与密钥。',
  cli: '管理本机 CLI。',
  hosting: '设置素材上传与公网访问。',
  storage: '管理数据与缓存。',
  allLogs: '查看全部运行记录。',
  appearance: '设置主题与动效。',
  typography: '调整界面与节点字体。',
  canvasLook: '设置当前项目画布。',
  backup: '导出、导入与恢复数据。',
  snapshots: '保存和还原项目结构。',
  defaults: '设置新建节点默认值。',
  agentMemory: '管理 Agent 长期记忆。',
  packs: '管理扩展包。',
  notify: '设置完成与失败提醒。',
  help: '查看帮助与新手引导。',
  shortcuts: '查看快捷键。',
  about: '版本、更新与隐私。',
}

/**
 * 全局设置浮层（用户 2026-10-06 定，对账 #259）。
 *
 * ## 为什么直接复用两个页面组件，而不是重写一份"设置内容"
 *
 * `SettingsPage` / `HostingPage` 本来就是这个业务（渠道、图床）的**唯一实现**，
 * 而且它们都只依赖 `platform` 端口与 store，**不吃 props、不认路由**。
 * 在这里重写一份"浮层版"等于把同一套表单维护两遍 —— 那正是仓库里反复记过的教训
 * （"两处各写一遍必然分叉"）。所以浮层只负责**外壳**：遮罩、面板、子菜单、关闭。
 *
 * ## 交互三条
 *
 * - **模态**：遮罩铺满整窗，点击遮罩即关闭（用户："需要关掉才能点击其他的功能"）；
 * - **Esc 关闭**（浮层的通行约定）；
 * - 打开时**滚动锁在浮层内**：面板自己滚，底下的页面收不到滚轮（遮罩挡住了指针）。
 *
 * ## 布局：左侧一列导航 + 右侧内容（用户 2026-10-06，对账 #284）
 *
 * 原来是一排顶部标签（图四），用户给了参考图五：**左侧一列**，右侧是具体区域。
 * 同时修掉「素材传输无法下拉」—— 病根是那一栏的内容**没有滚动容器**：
 * `HostingPage` 是照"整页工作区"写的（自己没有 `overflow`，靠外层壳滚），
 * 而浮层里它的外层是 `overflow: hidden` 的 flex 列 ⇒ 多出来的字段被直接裁掉、
 * 滚轮无处可滚。现在右栏**自带 `overflow-y: auto`**，两页各按自己的方式滚：
 * `HostingPage` 交给这层滚，`SettingsPage` 内部两栏自己滚（它本来就是这么写的）。
 */
export function GlobalSettingsOverlay() {
  const { open, section } = useSyncExternalStore(
    subscribeGlobalSettings,
    getGlobalSettings,
    getGlobalSettings,
  )
  /**
   * 搜索词（对账 #385 的"搜索基线"）。
   *
   * 搜索结果**复用同一份栏目表**（`matchSettingsSections`）—— 不另建一套索引，
   * 也就不会出现"菜单里有、搜不到"或反之。每次**重新打开**浮层清空：
   * 上一次搜的词留在框里、下次一进来只剩一栏，会让人以为设置丢了。
   */
  const [query, setQuery] = useState('')
  const visible = matchSettingsSections(query)
  const currentSection = GLOBAL_SETTINGS_SECTIONS.find((item) => item.id === section) ?? null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGlobalSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  if (!open) return null

  return (
    <div
      className={styles.scrim}
      data-global-settings
      role="dialog"
      aria-modal="true"
      aria-label="全局设置"
      /*
       * 只有点在遮罩**本身**上才关（`e.target === e.currentTarget`）——
       * 不判这一下的话，面板内部的点击会冒泡到遮罩、把浮层自己关掉。
       */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeGlobalSettings()
      }}
    >
      <div className={styles.panel} data-global-settings-panel>
        <header className={styles.head}>
          <span className={styles.title}>全局设置</span>
          <button
            type="button"
            className={styles.close}
            data-global-settings-close
            aria-label="关闭全局设置"
            title="关闭"
            onClick={() => closeGlobalSettings()}
          >
            <IconClose size={18} />
          </button>
        </header>
        <div className={styles.body} data-global-settings-body>
          {/*
            左：一列导航（用户要的形态）。
            `data-global-settings-tab` 这个锚点**没变** —— 它是"栏目切换"的既有接口，
            冒烟与页内跳转（画布里那处"去后台设置"）都按它找人，换布局不该换锚点。
          */}
          <nav className={styles.nav} aria-label="设置栏目">
            {/*
              搜索框（对账 #385）。用户找设置时想的是"事情"不是栏目名，
              所以每个栏目都带了一组用户可能敲的词（见 `state/ui/globalSettings`）。
            */}
            <div className={styles.search}>
              <input
                className={styles.searchInput}
                data-global-settings-search
                type="search"
                value={query}
                placeholder="搜索设置"
                aria-label="搜索设置"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  className={styles.searchClear}
                  data-global-settings-search-clear
                  aria-label="清空搜索"
                  title="清空"
                  onClick={() => setQuery('')}
                >
                  <IconClose size={14} />
                </button>
              ) : null}
            </div>
            {/*
              按**能力域**分段渲染（用户 2026-10-09，参考 Cherry 的组织逻辑）：
              分组顺序与栏目归属都在 `state/ui/globalSettings` 里定义，
              这里只负责画出来 —— 菜单顺序与搜索、路由共用同一份数据，不会漂移。
            */}
            {GLOBAL_SETTINGS_GROUPS.map((group) => {
              const items = visible.filter((item) => item.group === group)
              if (items.length === 0) return null
              return (
                <div key={group} className={styles.navGroup}>
                  <div className={styles.navGroupTitle} data-global-settings-group={group}>
                    {group}
                  </div>
                  {items.map((item) => {
                    /* 栏目图标（用户 2026-10-10 #8）：与标签同一行、跟随选中态着色 —— 映射见文件顶部 */
                    const Icon = SECTION_ICONS[item.id]
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={
                          currentSection?.id === item.id
                            ? `${styles.navItem} ${styles.navItemOn}`
                            : styles.navItem
                        }
                        data-global-settings-tab={item.id}
                        aria-pressed={currentSection?.id === item.id}
                        onClick={() => openGlobalSettings(item.id)}
                      >
                        <span className={styles.navIcon} aria-hidden>
                          <Icon size={16} />
                        </span>
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {/* 搜不到时给一句话，而不是留一片空白菜单（用户会以为界面坏了） */}
            {visible.length === 0 && (
              <p className={styles.searchEmpty} data-global-settings-search-empty>
                没有匹配的设置项
              </p>
            )}
          </nav>
          {/*
            右：具体内容。**这一层是滚动容器**（`overflow-y: auto`）—— 没有它，
            `HostingPage` 那段"靠外层滚"的内容就会被裁掉（用户报的无法下拉）。
            三个栏目各自的实现：前两个直接复用页面组件（见文件头注释），
            「存储」是新增的面板（对账 #261）—— 它没有对应页面，只活在设置里。
            `key` 让切栏时重新挂载：两页各自的状态不该跨栏串味。
          */}
          <div className={styles.content} data-global-settings-content>
            <header className={styles.sectionHead} data-settings-section-head>
              <h2 className={styles.sectionTitle} data-settings-section-title>
                {currentSection?.label ?? '全局设置'}
              </h2>
              <p className={styles.sectionIntro} data-settings-section-intro>
                {SECTION_INTROS[currentSection?.id ?? section]}
              </p>
            </header>
            <div className={styles.sectionBody} data-settings-section-body>
              {section === 'channels' && <SettingsPage key="channels" embedded />}
              {section === 'cli' && <CliPanel key="cli" />}
              {section === 'hosting' && <HostingPage key="hosting" />}
              {section === 'storage' && <StoragePanel key="storage" />}
              {section === 'allLogs' && <AllLogsPanel key="allLogs" />}
              {section === 'appearance' && <ThemePanel key="appearance" />}
              {section === 'typography' && <FontManagerPanel key="typography" />}
              {section === 'canvasLook' && <CanvasLookPanel key="canvasLook" />}
              {/* 「备份与恢复」（对账 #378）：全量备份导出 / 导入。
                  与「存储」分栏：一个回答"在哪"，一个回答"出事怎么办"。 */}
              {section === 'backup' && <BackupPanel key="backup" />}
              {section === 'snapshots' && <SnapshotsPanel key="snapshots" />}
              {/* 「扩展包」（对账 #386 阶段一）：只装数据（技能 + 电商平台规则），不执行代码 */}
              {section === 'packs' && <PackPanel key="packs" />}
              {/* 「默认参数」（对账 #386 的 E4）：默认模型 / 比例 / 画质 / 张数 + 记住上次参数 */}
              {section === 'defaults' && <DefaultParamsPanel key="defaults" />}
              {section === 'agentMemory' && <AgentMemoryPanel key="agentMemory" />}
              {/* 「通知」（对账 #386 的 E5）：完成 / 失败 / 批量进度三档 + 系统通知能力说明 */}
              {section === 'notify' && <NotifyPanel key="notify" />}
              {/* 「帮助」（对账 #388 / E7）：快捷键 / 常见问题 / 版本 + 重看新手引导 */}
              {section === 'help' && <HelpPanel key="help" />}
              {section === 'shortcuts' && <ShortcutsPanel key="shortcuts" />}
              {/* 「关于与隐私」（对账 #386 的 E6）：五段如实说明 + 隐私声明 */}
              {section === 'about' && <AboutPanel key="about" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
