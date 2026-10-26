import { IconDown, IconTrash, IconUp } from './StoryboardIcons'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import styles from './StoryboardPage.module.css'

export function ShotCardHeader({
  model,
  actions,
  kind,
  stateText,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  kind: 'idle' | 'laid' | 'running' | 'failed' | 'done'
  stateText: string
}) {
  const { shot, index, total, confirming } = model

  return (
    <div className={styles.shotHead}>
      <span className={styles.shotNo}>第 {index + 1} 镜</span>
      <span
        className={kind === 'failed' ? `${styles.shotState} ${styles.shotStateBad}` : styles.shotState}
        data-storyboard-shot-status={shot.id}
        data-kind={kind}
      >
        {stateText}
      </span>
      <div className={styles.itemTools}>
        {actions.onShowSource ? (
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-shot-source={shot.id}
            onClick={actions.onShowSource}
          >
            看原文
          </button>
        ) : null}
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="上移这一镜"
          title="上移"
          disabled={index === 0}
          data-storyboard-shot-up={shot.id}
          onClick={() => actions.onMove(shot.id, -1)}
        >
          <IconUp />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="下移这一镜"
          title="下移"
          disabled={index === total - 1}
          data-storyboard-shot-down={shot.id}
          onClick={() => actions.onMove(shot.id, 1)}
        >
          <IconDown />
        </button>
        <button
          type="button"
          className={confirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
          aria-label={confirming ? '再点一次，删除这一镜' : '删除这一镜'}
          title={confirming ? '再点一次，删除这一镜' : '删除'}
          data-storyboard-shot-remove={shot.id}
          data-confirming={confirming ? 'true' : 'false'}
          onClick={() => actions.onRemove(shot.id)}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}
