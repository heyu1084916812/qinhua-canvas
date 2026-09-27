import styles from './AssetsPage.module.css'

/**
 * 我的素材页（产品文档 §2.1 #6；路由 `/assets`）。
 *
 * **占位页，刻意的**：产品文档写的是「素材库 / 角色库 / 场景库的占位页；
 * 瀑布流卡片，交互后期补齐」。所以这里如实写明「还没做」，
 * 而不是摆一堆点了没反应的假卡片 —— 后者正是本项目反复踩过的「假功能」。
 *
 * 它存在的意义是把侧栏那一项**接住**：没有这个路由，点「我的素材」
 * 会走 `*` 兜底跳回首页，用户看到的是「点了没用」。
 */
export function AssetsPage() {
  return (
    <div className={styles.page} data-assets-page>
      <div className={styles.empty}>
        <p className={styles.title}>我的素材</p>
        <p className={styles.hint}>
          素材库 / 角色库 / 场景库还没开始做。
          <br />
          现在生成的图片与视频都存在各个项目里。
        </p>
      </div>
    </div>
  )
}
