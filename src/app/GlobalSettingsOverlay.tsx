import { useEffect, useSyncExternalStore } from 'react'
import { HostingPage } from '../pages/HostingPage/HostingPage'
import { SettingsPage } from '../pages/SettingsPage/SettingsPage'
import { StoragePanel } from '../features/settings/StoragePanel'
import { CliPanel } from '../features/settings/CliPanel'
import { FontManagerPanel } from '../features/settings/FontManagerPanel'
import { IconClose } from './AppSidebarIcons'
import {
  GLOBAL_SETTINGS_SECTIONS,
  closeGlobalSettings,
  getGlobalSettings,
  openGlobalSettings,
  subscribeGlobalSettings,
} from '../state/ui/globalSettings'
import styles from './GlobalSettingsOverlay.module.css'

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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGlobalSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
            {GLOBAL_SETTINGS_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={section === item.id ? `${styles.navItem} ${styles.navItemOn}` : styles.navItem}
                data-global-settings-tab={item.id}
                aria-pressed={section === item.id}
                onClick={() => openGlobalSettings(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          {/*
            右：具体内容。**这一层是滚动容器**（`overflow-y: auto`）—— 没有它，
            `HostingPage` 那段"靠外层滚"的内容就会被裁掉（用户报的无法下拉）。
            三个栏目各自的实现：前两个直接复用页面组件（见文件头注释），
            「存储」是新增的面板（对账 #261）—— 它没有对应页面，只活在设置里。
            `key` 让切栏时重新挂载：两页各自的状态不该跨栏串味。
          */}
          <div className={styles.content} data-global-settings-content>
            {section === 'channels' && <SettingsPage key="channels" />}
            {section === 'cli' && <CliPanel key="cli" />}
            {section === 'hosting' && <HostingPage key="hosting" />}
            {section === 'storage' && <StoragePanel key="storage" />}
            {/* 「外观与体验」（用户 2026-10-09）：字体 / 界面字号 / 字距。
                它是本机偏好，与业务配置分开 —— 改它不动任何项目数据。 */}
            {section === 'appearance' && <FontManagerPanel key="appearance" />}
          </div>
        </div>
      </div>
    </div>
  )
}
