import styles from './ShortcutsPanel.module.css'

/**
 * 「系统 → 快捷键」面板。
 *
 * 从「帮助」拆出来：这是参考手册，不与常见问题抢注意力。
 */
const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Z', what: '复位视图（全部节点回到视野）' },
  { keys: 'Ctrl / ⌘ + Z', what: '撤销' },
  { keys: 'Ctrl / ⌘ + Shift + Z', what: '重做' },
  { keys: 'Ctrl / ⌘ + G', what: '把选中的节点打组' },
  { keys: 'Ctrl / ⌘ + C、V', what: '复制 / 粘贴选中的节点' },
  { keys: 'Delete / Backspace', what: '删除选中（焦点在输入框里时不接管）' },
  { keys: 'R', what: '生成（选中单个生成节点）' },
  { keys: 'Alt + R', what: '保留旧内容，结果铺到新的下游节点' },
  { keys: 'Tab', what: '逐个选中节点' },
  { keys: '方向键', what: '在节点之间移动选中；没选中时选中第一个' },
  { keys: 'Alt + 方向键', what: '微移选中的节点（加 Shift 每次 10px）' },
  { keys: 'Ctrl / ⌘ + Alt + 方向键', what: '改选中节点的尺寸（加 Shift 每次 10px）' },
  { keys: 'Home / End', what: '跳到第一个 / 最后一个节点' },
  { keys: '空格 + 拖拽', what: '平移画布' },
]

export function ShortcutsPanel() {
  return (
    <div className={styles.panel} data-shortcuts-panel data-help-panel data-settings-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>快捷键</h3>
        <p className={styles.caption}>焦点在输入框里时，快捷键让位给打字。</p>
        <div className={styles.list}>
          {SHORTCUTS.map((item) => (
            <div className={styles.row} key={item.keys}>
              <span className={styles.keys}>{item.keys}</span>
              <span className={styles.what}>{item.what}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
