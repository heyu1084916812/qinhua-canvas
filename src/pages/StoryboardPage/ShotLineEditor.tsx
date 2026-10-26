import { DEFAULT_TRANSITION_SECONDS } from '../../domain/storyboard/storyboard'
import { digitalHumanPlanOf } from '../../domain/storyboard/digitalHuman'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import { LineVoiceAudio } from './StoryboardMedia'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import styles from './StoryboardPage.module.css'

export function ShotLineEditor({
  model,
  actions,
}: {
  model: ShotCardModel
  actions: ShotCardActions
}) {
  const {
    shot,
    index,
    total,
    characters,
    speechTarget,
    voiceBusy,
    digitalHumanBusyShotId,
    digitalHumanModel,
  } = model
  const digitalHumanPlan = digitalHumanPlanOf(shot)
  const digitalHumanBusy = digitalHumanBusyShotId === shot.id

  return (
    <div className={styles.row2}>
      <div className={styles.field} data-storyboard-lines={shot.id}>
        <div className={styles.linesHead}>
          <span className={styles.label}>台词 / 旁白</span>
          <div className={styles.linesHeadActions}>
            {shot.lines.length > 0 ? (
              <button
                type="button"
                className={styles.ghost}
                data-storyboard-shot-digital-human={shot.id}
                disabled={!digitalHumanPlan.ok || digitalHumanBusy}
                title={
                  digitalHumanPlan.ok
                    ? `用 ${digitalHumanModel ?? '数字人口播模型'} 生成这一镜的口播视频`
                    : digitalHumanPlan.reason
                }
                onClick={actions.onMakeDigitalHuman}
              >
                {digitalHumanBusy
                  ? '口播视频生成中…'
                  : shot.videoHash
                    ? shot.lines.length > 1
                      ? `重做数字人口播（${shot.lines.length} 句）`
                      : '重做数字人口播'
                    : shot.lines.length > 1
                      ? `数字人口播（${shot.lines.length} 句）`
                      : '数字人口播'}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-line-add={shot.id}
              onClick={actions.onAddLine}
            >
              加一句
            </button>
          </div>
        </div>
        {shot.lines.length === 0 ? (
          <p className={styles.hint} data-storyboard-lines-empty={shot.id}>
            可以是空的（空镜）
          </p>
        ) : (
          <ul className={styles.lineList}>
            {shot.lines.map((line) => {
              const voices = speechTarget?.voices.length ? speechTarget.voices : ['alloy', 'nova']
              const speaker = characters.find((item) => item.id === line.speakerId)
              const inheritedVoice = speaker?.voice?.trim() || ''
              const inheritedSpeed = speaker?.speed ?? 1
              const voiceOptions = [
                ...new Set(
                  [line.voice, inheritedVoice, ...voices].filter(
                    (item): item is string => Boolean(item),
                  ),
                ),
              ]
              const busy = !!voiceBusy[line.id]
              return (
                <li key={line.id} className={styles.lineRow} data-storyboard-line={line.id}>
                  <div className={styles.lineMain}>
                    <ChoicePicker
                      name={`storyboard-line-speaker-${line.id}`}
                      className={styles.lineSpeaker}
                      value={line.speakerId ?? ''}
                      ariaLabel="谁说的"
                      options={[
                        { value: '', label: '谁说…' },
                        ...characters.map((character) => ({
                          value: character.id,
                          label: character.name,
                        })),
                      ]}
                      onChange={(value) => actions.onLinePatch(line.id, { speakerId: value })}
                    />
                    <input
                      className={styles.input}
                      value={line.text}
                      placeholder="这一句"
                      aria-label="台词"
                      data-storyboard-line-text={line.id}
                      onChange={(e) => actions.onLinePatch(line.id, { text: e.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label="删掉这一句"
                      data-storyboard-line-remove={line.id}
                      onClick={() => actions.onLineRemove(line.id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className={styles.lineVoiceControls}>
                    <label className={styles.lineVoiceSelect}>
                      <span>音色</span>
                      <ChoicePicker
                        name={`storyboard-line-voice-${line.id}`}
                        className={styles.select}
                        value={line.voice ?? ''}
                        ariaLabel="台词语音音色"
                        options={[
                          {
                            value: '',
                            label: inheritedVoice
                              ? `跟随角色（${inheritedVoice}）`
                              : '跟随渠道默认',
                          },
                          ...voiceOptions.map((item) => ({ value: item, label: item })),
                        ]}
                        onChange={(value) => actions.onLinePatch(line.id, { voice: value })}
                      />
                    </label>
                    <label className={styles.lineVoiceSpeed}>
                      <span>语速</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={0.25}
                        max={4}
                        step={0.05}
                        value={line.speed ?? inheritedSpeed}
                        data-storyboard-line-voice-speed={line.id}
                        onChange={(e) =>
                          actions.onLinePatch(line.id, { speed: Number(e.target.value) })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-line-voice={line.id}
                      disabled={!speechTarget || busy || !line.text.trim()}
                      title={speechTarget?.label ?? '先在设置里勾选配音模型'}
                      onClick={() => actions.onVoice(line.id)}
                    >
                      {busy ? '生成中…' : line.audioHash ? '重配这一句' : '生成配音'}
                    </button>
                    {line.audioHash ? (
                      <LineVoiceAudio hash={line.audioHash} />
                    ) : (
                      <span className={styles.hint}>
                        {speechTarget ? `未生成 · ${speechTarget.label}` : '未配置配音模型'}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <label className={styles.field}>
        <span className={styles.label}>时长（秒）</span>
        <input
          className={styles.input}
          type="number"
          min={1}
          step={1}
          value={shot.durationSec}
          data-storyboard-shot-duration={shot.id}
          onChange={(e) => actions.onPatch(shot.id, { durationSec: Number(e.target.value) })}
        />
      </label>
      {index < total - 1 ? (
        <>
          <label className={styles.field}>
            <span className={styles.label}>转场到下一镜</span>
            <ChoicePicker
              name={`storyboard-shot-transition-${shot.id}`}
              className={styles.select}
              value={shot.transition ?? 'cut'}
              ariaLabel="转场到下一镜"
              options={[
                { value: 'cut', label: '硬切' },
                { value: 'fade', label: '淡入淡出（黑场）' },
              ]}
              onChange={(value) =>
                actions.onPatch(shot.id, {
                  transition: value === 'fade' ? 'fade' : 'cut',
                })
              }
            />
          </label>
          {shot.transition === 'fade' ? (
            <label className={styles.field}>
              <span className={styles.label}>转场时长（秒）</span>
              <input
                className={styles.input}
                type="number"
                min={0.1}
                max={1}
                step={0.1}
                value={shot.transitionSec ?? DEFAULT_TRANSITION_SECONDS}
                data-storyboard-shot-transition-seconds={shot.id}
                onChange={(e) =>
                  actions.onPatch(shot.id, { transitionSec: Number(e.target.value) })
                }
              />
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
