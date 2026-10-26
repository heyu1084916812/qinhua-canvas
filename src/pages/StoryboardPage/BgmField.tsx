import { useEffect, useRef } from 'react'
import { useAssetMeta } from '../../features/shared/assets'
import type { StoryboardEpisode } from '../../domain/storyboard/storyboard'
import styles from './StoryboardPage.module.css'

export function BgmField({
  episode,
  onPick,
  onRemove,
  onVolume,
}: {
  episode: StoryboardEpisode
  onPick: () => void
  onRemove: () => void
  onVolume: (volume: number) => void
}) {
  const meta = useAssetMeta(episode.bgmHash)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const volume = episode.bgmVolume ?? 0.2

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume, meta.url])

  return (
    <div className={styles.bgmField} data-storyboard-bgm={episode.id}>
      <div className={styles.bgmHead}>
        <div>
          <span className={styles.label}>背景音乐</span>
          <p className={styles.bgmName} data-storyboard-bgm-name>
            {episode.bgmHash ? episode.bgmName || episode.bgmHash.slice(0, 12) : '这一集还没有背景音乐'}
          </p>
        </div>
        <div className={styles.bgmActions}>
          <button type="button" className={styles.ghost} data-storyboard-bgm-pick onClick={onPick}>
            {episode.bgmHash ? '更换音频' : '选择音频'}
          </button>
          {episode.bgmHash ? (
            <button type="button" className={styles.ghost} data-storyboard-bgm-remove onClick={onRemove}>
              移除
            </button>
          ) : null}
        </div>
      </div>
      {episode.bgmHash ? (
        meta.missing ? (
          <p className={styles.bgmMissing} data-storyboard-bgm-missing>
            音频素材缺失{meta.expectedPath ? `（本该在 ${meta.expectedPath}）` : ''}
          </p>
        ) : meta.url ? (
          <div className={styles.bgmPlayer}>
            <audio ref={audioRef} controls src={meta.url} data-storyboard-bgm-audio />
            <label className={styles.bgmVolume}>
              <span>音量 {Math.round(volume * 100)}%</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(volume * 100)}
                data-storyboard-bgm-volume
                onChange={(e) => onVolume(Number(e.target.value) / 100)}
              />
            </label>
          </div>
        ) : (
          <p className={styles.hint}>正在读取音频…</p>
        )
      ) : (
        <p className={styles.hint}>支持 MP3 / WAV / OGG / M4A / AAC / FLAC，最大 50MB。</p>
      )}
    </div>
  )
}
