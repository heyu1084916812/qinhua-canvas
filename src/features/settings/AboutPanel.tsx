import { APP_VERSION } from '../../app/appVersion'
import styles from './AboutPanel.module.css'

/**
 * 「系统 → 关于与隐私」面板（对账 #386 的 E6）。
 *
 * 五段**如实**说明：数据在哪 / 什么时候联网 / 凭据怎么存 / 卸载与清数据的影响 /
 * 第三方组件与许可。再加一段隐私声明。
 *
 * 写法上的两条自我约束：
 * 1. **不写"加速""优化""更智能"这类空话** —— 这一栏回答的是"交给你用之前我要知道的事"，
 *    每一条都必须是**能核对的事实**（比如许可那几条是逐个查 node_modules 里的 license 字段抄来的）；
 * 2. 说清**边界**：应用自己不收集数据，但你配置的第三方渠道 / 图床有它们自己的规则 ——
 *    只写"我们很安全"而不提这一条，等于把风险藏着。
 */
const BLOCKS: { title: string; body: string }[] = [
  {
    title: '数据存放在哪',
    body: '项目、素材、生成记录全部存在本机：网页版是浏览器的数据库（IndexedDB），桌面版是应用数据目录 —— 具体路径在「设置 → 存储」里能看到并打开。没有服务器替你保存项目。',
  },
  {
    title: '什么时候会联网',
    body: '只有你做这些事时才发请求：生成（发给你自己配置的渠道）、拉取模型清单、上传到图床、桌面版检查更新。没有账号体系、没有埋点，应用不会向作者这边上报任何数据。',
  },
  {
    title: '令牌怎么存',
    body: '只存在本机的凭据表里，日志不会写令牌明文。导出的备份刻意不含凭据 —— 换机器要重填一次，这是有意的边界，不是漏了。',
  },
  {
    title: '卸载 / 清数据会怎样',
    body: '项目在共享权威库里，不再跟着浏览器站点数据或 WebView profile 走。卸载桌面程序不会自动删共享库；要彻底清掉得打开设置里的共享库目录手动删除。删除前先用「备份与恢复」导出一份。',
  },
  {
    title: '第三方组件与开源许可',
    body: '运行时主要依赖：React / React DOM / React Router / React Flow(xyflow) / zustand 为 MIT，Dexie 为 Apache-2.0；桌面壳 Tauri 为 MIT 或 Apache-2.0。完整许可条文在各自依赖包的 LICENSE 文件里，随包分发。',
  },
]

export function AboutPanel() {
  return (
    <div className={styles.panel} data-about-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>关于轻画</h3>
        <p className={styles.caption} data-about-version>
          当前版本 {APP_VERSION}。本地优先的 AI 出图 / 出视频工作台：用你自己的渠道，数据留在你自己的机器上。
        </p>
      </section>

      {BLOCKS.map((b, i) => (
        <section key={b.title} className={styles.block} data-about-block data-about-index={i}>
          <h4 className={styles.blockTitle}>{b.title}</h4>
          <p className={styles.body}>{b.body}</p>
        </section>
      ))}

      <section className={styles.block} data-about-privacy>
        <h4 className={styles.blockTitle}>隐私声明</h4>
        <p className={styles.body}>
          这份说明本身就是隐私政策：轻画不收集、不上传你的数据，没有账号，也没有遥测。
        </p>
        <p className={styles.body}>
          但请留意<b>边界</b>：你配置的第三方渠道、图床、更新源有它们各自的隐私政策 ——
          经它们处理的内容适用它们的规则。想完全不外发，就不要点生成，或者只连你自己的本地服务。
        </p>
      </section>
    </div>
  )
}
