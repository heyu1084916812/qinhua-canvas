import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import styles from './StoryboardPage.module.css'

export function ShotCastPanel({
  model,
  actions,
}: {
  model: ShotCardModel
  actions: ShotCardActions
}) {
  const { shot, characters, scenes } = model

  return (
    <div className={styles.shotBind}>
      <label className={styles.inlineField}>
        <span className={styles.label}>场景</span>
        <ChoicePicker
          name={`storyboard-shot-scene-${shot.id}`}
          className={styles.select}
          value={shot.sceneId ?? ''}
          ariaLabel="绑定场景"
          options={[
            { value: '', label: '未指定' },
            ...scenes.map((scene) => ({ value: scene.id, label: scene.name })),
          ]}
          onChange={(value) => actions.onBindScene(value || null)}
        />
      </label>
      <div className={styles.inlineField}>
        <span className={styles.label}>出场角色</span>
        <div className={styles.chips} data-storyboard-shot-cast={shot.id}>
          {characters.length === 0 ? (
            <span className={styles.hint}>还没有角色</span>
          ) : (
            characters.map((character) => {
              const on = shot.characterIds?.includes(character.id) ?? false
              return (
                <button
                  key={character.id}
                  type="button"
                  className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                  aria-pressed={on}
                  data-storyboard-shot-character={shot.id}
                  data-character-id={character.id}
                  data-on={on ? 'true' : 'false'}
                  onClick={() => actions.onToggleCharacter(character.id)}
                >
                  {character.name}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
