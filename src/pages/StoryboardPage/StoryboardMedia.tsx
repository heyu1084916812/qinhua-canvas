import { useAsset, useAssetMeta } from '../../features/shared/assets'
import styles from './StoryboardPage.module.css'

/** 资产的基准图缩略图（角色定妆图 / 场景基准图）：按 hash 取素材 */
export function AssetThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.shotImg} src={url} alt="" />
}

export function LineVoiceAudio({ hash }: { hash: string }) {
  const meta = useAssetMeta(hash)
  if (meta.missing) return <span className={styles.error}>配音素材缺失</span>
  if (!meta.url) return <span className={styles.hint}>正在读取配音…</span>
  return (
    <audio
      className={styles.lineVoiceAudio}
      controls
      preload="metadata"
      src={meta.url}
      data-storyboard-line-audio={hash}
    />
  )
}

/** 这一镜的出图缩略图：按 hash 取素材（hook 必须落在子组件里，不能在 map 里调） */
export function ShotThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.shotImg} src={url} alt="" />
}

/** 当前镜头视频预览：视频节点可能已被替换，但镜头 hash 始终指向当前版本。 */
export function ShotVideo({ hash }: { hash: string }) {
  const meta = useAssetMeta(hash)
  if (meta.missing) return <span className={styles.error}>视频素材缺失</span>
  if (!meta.url) return <span className={styles.hint}>正在读取视频…</span>
  return (
    <video
      className={styles.shotVideoPlayer}
      controls
      playsInline
      preload="metadata"
      src={meta.url}
      data-storyboard-shot-video={hash}
    />
  )
}
