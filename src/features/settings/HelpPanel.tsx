import { APP_VERSION } from '../../app/appVersion'
import { resetOnboarding } from '../../state/ui/onboarding'
import styles from './HelpPanel.module.css'

/**
 * 「系统 → 帮助」面板（对账 #388 / E7）。
 *
 * 三条**静态**说明：快捷键 / 常见问题 / 版本与更新。
 * 它们不是营销页 —— 每一条都回答"我现在卡住了怎么办"，
 * 所以宁可少写，也不写"更高效""更智能"这类没有信息量的话。
 *
 * 快捷键这几行是从代码里抄的，出处写在下面对应条目的注释里（别凭印象加）：
 * - `workbenches/canvas/useCanvasKeyboard.ts`：Z / Ctrl+Z / Ctrl+Shift+Z / Tab / 方向键 / Home / End
 * - `workbenches/canvas/flow/FlowSurface.tsx`：Delete / Backspace（焦点在输入框时不接管）
 * - `workbenches/canvas/execution/RunHotkeys.tsx`：R / Alt+R
 * - `features/canvas/useClipboardHotkeys.ts`：Ctrl+C / Ctrl+V
 * - 空格 + 拖拽平移：`features/canvas/useSpaceHeld.ts`
 * - Ctrl+G 打组：`useCanvasKeyboard.ts`
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
  { keys: 'Home / End', what: '跳到第一个 / 最后一个节点' },
  { keys: '空格 + 拖拽', what: '平移画布' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: '点了生成没反应？',
    a: '先看渠道：是否启用、有没有勾选模型；再看节点上选的模型在不在那条渠道里。右上角「日志」会写明原因（比如"没有渠道提供这个模型"）。',
  },
  {
    q: '我的项目和数据存在哪？',
    a: '在本机（网页版是浏览器数据库，桌面版是应用数据目录）。不上云。换机器走「设置 → 备份与恢复」：导出整库、在新机器导入。',
  },
  {
    q: '令牌安全吗？',
    a: '令牌只存在本机、加密保存在凭据表里；导出的备份**刻意不含凭据** —— 换机器需要重填一次，这是有意的边界。',
  },
  {
    q: '生成的图还能继续改吗？',
    a: '能。结果就是画布上的节点：可以继续接生成节点（改图 / 出视频）、打组、导出，也能单独下载。',
  },
  {
    q: '扩展包会不会执行代码？',
    a: '阶段一只装数据（技能与电商平台规则），不执行任何代码。带权限声明或代码字段的包会在导入时直接被拒收。',
  },
]

export function HelpPanel() {
  return (
    <div className={styles.panel} data-help-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>快捷键</h3>
        <p className={styles.caption}>焦点在输入框里时，快捷键让位给打字。</p>
        <dl className={styles.shortcuts}>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className={styles.shortcut} data-help-shortcut>
              <dt className={styles.keys}>{s.keys}</dt>
              <dd className={styles.what}>{s.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>常见问题</h3>
        <ul className={styles.faq}>
          {FAQ.map((item) => (
            <li key={item.q} className={styles.qa} data-help-faq>
              <span className={styles.q}>{item.q}</span>
              <span className={styles.a}>{item.a}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>版本与更新</h3>
        <p className={styles.caption} data-help-version>
          当前版本 {APP_VERSION}。桌面版：侧栏底部的「检查更新」；网页版随部署更新，页面刷新即可。
        </p>
        <button
          type="button"
          className={styles.btn}
          data-help-replay
          onClick={() => resetOnboarding()}
        >
          重看新手引导
        </button>
      </section>
    </div>
  )
}
