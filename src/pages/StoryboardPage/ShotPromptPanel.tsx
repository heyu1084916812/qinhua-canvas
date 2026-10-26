import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import { ShotLineEditor } from './ShotLineEditor'
import styles from './StoryboardPage.module.css'

export function ShotPromptPanel({
  model,
  actions,
}: {
  model: ShotCardModel
  actions: ShotCardActions
}) {
  const { shot } = model

  return (
    <>
      <label className={styles.field}>
        <span className={styles.label}>画面</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.scene}
          placeholder="这一镜画什么"
          data-storyboard-shot-scene={shot.id}
          onChange={(e) => actions.onPatch(shot.id, { scene: e.target.value })}
        />
      </label>
      <ShotLineEditor model={model} actions={actions} />
      <label className={styles.field}>
        <span className={styles.label}>画面提示词</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.prompt}
          placeholder="留空就用上面的「画面」"
          data-storyboard-shot-prompt={shot.id}
          onChange={(e) => actions.onPatch(shot.id, { prompt: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>视频提示词（运镜 / 动作）</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.videoPrompt ?? ''}
          placeholder="例如：镜头缓慢推进，人物抬头看向门口；留空则自动生成自然运动"
          data-storyboard-shot-video-prompt={shot.id}
          onChange={(e) => actions.onPatch(shot.id, { videoPrompt: e.target.value })}
        />
      </label>
    </>
  )
}
