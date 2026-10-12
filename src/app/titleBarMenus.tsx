import styles from './TitleBar.module.css'

/**
 * 自绘标题栏里那两个菜单的**内容**（抽出来是为了能单测）。
 *
 * 为什么不留在 `TitleBar.tsx` 里：那个组件只在桌面壳里渲染（`isTauri()` 为假时返回 null），
 * 而它 import 了 `@tauri-apps/*` —— 于是"菜单里到底列了哪几条快捷键"这件事在单测里根本够不着，
 * 只能靠人打开菜单看。抽到这里之后，`titleBarMenus.test.ts` 能直接断言条目与格式。
 */

/**
 * 「编辑」菜单列出的快捷键。**只列真实存在的那些**（来源：`useCanvasKeyboard` / `RunHotkeys`）。
 *
 * 2026-10-06 用户第 3 条：文案精简成动作词（原来带括号解释："复位视图（缩放到全部节点）"），
 * 并**只保留这 9 条** —— 撤掉了"在节点之间移动选中""跳到最前/最后一个节点"
 * （用户原话给了要留的清单）。
 *
 * ⚠️ **这份清单是"用户点名要留的 9 条"，不是"全部快捷键"**：2026-10-12 新增的
 * `Alt + 方向键` 微移 / `Ctrl + Alt + 方向键` 改尺寸**刻意没有加进来**（用户没点它们，
 * 而这份清单是他逐条裁过的）。要查全量键位看「设置 → 帮助」那份（`HelpPanel`）。
 */
export const SHORTCUTS: readonly { keys: string; what: string }[] = [
  { keys: 'Ctrl + Z', what: '撤销' },
  { keys: 'Ctrl + Shift + Z', what: '重做' },
  { keys: 'Z', what: '复位视图' },
  { keys: 'Ctrl + G', what: '打组' },
  { keys: 'Tab', what: '下一个节点' },
  { keys: 'R', what: '运行节点' },
  { keys: 'Delete', what: '删除' },
  { keys: '空格 + 拖拽', what: '平移画布' },
  { keys: '滚轮 / 触控板', what: '缩放画布' },
] as const

/** 「编辑」菜单的内容：标题 + 那张快捷键表 */
export function EditShortcuts() {
  return (
    <>
      <div className={styles.menuHead}>常用快捷键</div>
      <ul className={styles.shortcuts} data-title-shortcuts>
        {SHORTCUTS.map((row) => (
          <li key={row.keys} className={styles.shortcutRow} data-title-shortcut={row.what}>
            <span className={styles.shortcutWhat}>{row.what}</span>
            {/*
              ⚠️ 按键**不是 `<kbd>` 也不再带胶囊底**（用户第 3 条：「右边的快捷键不要有胶囊」）。
              用 `<span>` + 弱色等宽字：底色会让每一行都长出一个"像按钮"的东西。
              顺便这也是"溢出"那条的修法之一 —— 少了左右各 8px 内距，`Home / End` 那种
              长按键才排得下（那一行原先会被菜单右边缘切掉）。
            */}
            <span className={styles.kbd} data-title-shortcut-keys>
              {row.keys}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * 「应用」菜单的内容：版本号 + 仓库地址 + **全屏**。
 *
 * 用户 2026-10-06 第 11 批第 7 条：「就补那五条权限，**顺手加全屏**，记住上次窗口尺寸和位置」。
 * 全屏与 F11 同一个动作（两条入口，一个人抬手、一个人找菜单 —— 与 §2.1 里
 * 「点整块 / 点按钮」那种双入口同一考虑）。
 */
export function AppMenuContent({
  version,
  onOpenRepo,
  fullscreen,
  onToggleFullscreen,
}: {
  /** 壳自己的版本号；拿不到时给"（开发预览）" */
  version: string
  onOpenRepo: () => void
  /** 当前是不是全屏（菜单文案跟着变） */
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  return (
    <>
      <div className={styles.menuHead} data-title-version>
        轻画 {version ? `v${version}` : '（开发预览）'}
      </div>
      <button
        type="button"
        role="menuitem"
        className={styles.menuItem}
        data-title-fullscreen
        aria-pressed={fullscreen}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? '退出全屏（F11）' : '全屏（F11）'}
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.menuItem}
        data-title-open-repo
        onClick={onOpenRepo}
      >
        GitHub 项目地址 ↗
      </button>
    </>
  )
}
