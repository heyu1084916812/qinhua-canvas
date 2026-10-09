import { useSyncExternalStore } from 'react'
import {
  dismissCanvasGuide,
  isCanvasGuideDismissed,
  subscribeOnboarding,
} from '../../../state/ui/onboarding'
import { seedTemplate, type TemplateId } from '../../../state/project/templates'
import { useCanvasStore, useGraph } from '../storeContext'
import styles from './EmptyCanvasGuide.module.css'

/**
 * 空画布的"从模板开始"卡片（对账 #388 / E7）。
 *
 * 两个条件同时成立才出现：**画布是空的** 且 **新手引导还没看过**。
 * 第二个条件读的是**它自己那个标记**（`flow:canvasGuideDismissed`）：
 * 老用户清空画布是想自己摆，不需要每次都被推荐一次模板；
 * 而新人第一次打开一片空白，最需要的正是"点一下就有东西"。
 * （别把它和"引导看过没有"混成一个标记 —— 那样模态一关，这张卡片就永远见不到了。）
 *
 * 模板按钮直接用 `seedTemplate`（与项目页点模板进画布是同一条链路、同一个函数），
 * 不另写一套预置逻辑。
 */
const PICKS: { id: TemplateId; name: string; hint: string }[] = [
  { id: 'batch-img', name: '批量出图', hint: '一句提示词 → 4 张 + 对比' },
  { id: 'img2video', name: '图生视频', hint: '图片 → 视频生成' },
  /* 「局部融合」目前没有独立模板：融合节点的入口在生成节点跟随栏里，
     所以这里给的是最接近的"图生图"（带参考图再生成），不编一个不存在的模板名。 */
  { id: 'img2img', name: '图生图', hint: '带上参考图再生成' },
]

export function EmptyCanvasGuide() {
  const store = useCanvasStore()
  const graph = useGraph()
  const dismissed = useSyncExternalStore(
    subscribeOnboarding,
    isCanvasGuideDismissed,
    isCanvasGuideDismissed,
  )
  if (dismissed || graph.nodes.length > 0) return null

  return (
    <div className={styles.card} data-empty-canvas-guide>
      <span className={styles.title}>空画布 · 从一个模板开始</span>
      <button
        type="button"
        className={styles.close}
        aria-label="不用了"
        title="不用了"
        data-empty-guide-close
        onClick={dismissCanvasGuide}
      >
        ×
      </button>
      <div className={styles.row}>
        {PICKS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.pick}
            data-empty-template={p.id}
            onClick={() => {
              seedTemplate(store, p.id)
              dismissCanvasGuide()
            }}
          >
            <span className={styles.name}>{p.name}</span>
            <span className={styles.hint}>{p.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
