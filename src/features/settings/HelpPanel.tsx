import { APP_VERSION } from '../../app/appVersion'
import { resetOnboarding } from '../../state/ui/onboarding'
import styles from './HelpPanel.module.css'

/**
 * 「系统 → 帮助」面板（对账 #388 / E7）。
 *
 * 两条**静态**说明：常见问题 / 版本与更新；快捷键已拆到独立栏目。
 * 它们不是营销页 —— 每一条都回答"我现在卡住了怎么办"，
 * 所以宁可少写，也不写"更高效""更智能"这类没有信息量的话。
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: '点了生成没反应？',
    a: '先看渠道：是否启用、有没有勾选模型；再看节点上选的模型在不在那条渠道里。右上角「日志」会写明原因（比如"没有渠道提供这个模型"）。',
  },
  {
    q: '我的项目和数据存在哪？',
    a: '在本机的共享权威库（调试壳、release 壳、浏览器共用同一份），不上云。换机器走「设置 → 备份与恢复」：导出整库、在新机器导入。',
  },
  {
    q: '令牌安全吗？',
    a: '令牌只存在本机的共享凭据库、加密保存；导出的备份**刻意不含凭据** —— 换机器需要重填一次，这是有意的边界。',
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
