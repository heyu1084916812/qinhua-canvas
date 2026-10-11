import { useEffect, useRef } from 'react'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import { dialogueTextOf, type TimelineClip } from '../../domain/storyboard/ffmpegPack'
import styles from './EpisodePreview.module.css'

/**
 * 漫剧「这一集的时间轴预览」（对账 #432；《轻画-漫剧形态调研.md》§M7-6）。
 *
 * 调研稿把合成那一格写成两半：**浏览器内预览播放** + **导出 FFmpeg 合成包**（#431）。
 * 这一件是前一半，三条口径都跟导出同源：
 *
 * 1. **时间轴来自 `episodeTimeline`**（与合成包同一个函数）—— 各算一遍必然漂成
 *    "预览里 12 段、命令里 11 段"，那种不一致用户根本对不出来；
 * 2. **静帧按分镜表的秒数走、视频用它自己的长度**：这正是命令里 `-loop 1 -t N` 与
 *    原样进片的区别；视频这里用 `onEnded` 推下一段，不去裁它；
 * 3. **零依赖**：一个 `<img>` + 一个 `<video>` + 定时器，不引播放器库、不做实时录制
 *    （架构 §16.2 的轻量边界；真编码在用户本地的 FFmpeg 里）。
 *
 * 素材读法与页面其它小图一致（`useAssetMeta`，但**要原图**不是缩略图 —— 预览要看清画面）；
 * 读不到就**如实显示缺失**，不留一块永远转圈的空白。
 */
export interface EpisodePreviewProps {
  clips: readonly TimelineClip[]
  /** 当前第几段（0 起；调用方已按片段数夹好范围） */
  at: number
  playing: boolean
  onAt: (index: number) => void
  onTogglePlay: () => void
  onClose: () => void
}

export function EpisodePreview({ clips, at, playing, onAt, onTogglePlay, onClose }: EpisodePreviewProps) {
  /**
   * 键盘口径与画布灯箱 / 文本编辑灯箱一致：**Esc 关闭**；
   * 空格顺手做播放暂停（预览里最顺手的一个键，且不会与页面其它快捷键打架 —— 这一层是浮层）。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') {
        e.preventDefault()
        onTogglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onTogglePlay])

  if (clips.length === 0) return null
  const index = Math.min(Math.max(at, 0), clips.length - 1)
  const clip = clips[index]!
  const step = (delta: number) => onAt((index + delta + clips.length) % clips.length)

  return (
    <div
      className={styles.overlay}
      /**
       * 浮层用**另一个**属性：入口按钮叫 `data-storyboard-preview`，
       * 两个同名的话选择器会同时命中按钮与浮层（冒烟里第一版就撞上了）。
       */
      data-storyboard-preview-overlay
      role="dialog"
      aria-label="这一集的时间轴预览"
      /* 点浮层空白处关闭（与灯箱同一条交互）；面板内的点击不许穿到这一层 */
      onClick={onClose}
    >
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.stage}>
          <PreviewMedia
            key={`${clip.shotId}-${index}`}
            clip={clip}
            playing={playing}
            onAdvance={() => step(1)}
          />
        </div>
        <div className={styles.bar}>
          <span className={styles.counter} data-preview-counter>
            第 {clip.index} 镜 · {index + 1}/{clips.length} · {clip.seconds} 秒
          </span>
          <span className={styles.dialogue} data-preview-dialogue>
            {dialogueTextOf(clip) || '（这一镜没有台词）'}
          </span>
          <div className={styles.tools}>
            <button type="button" className={styles.btn} data-preview-prev onClick={() => step(-1)}>
              上一镜
            </button>
            <button type="button" className={styles.btn} data-preview-play onClick={onTogglePlay}>
              {playing ? '暂停' : '播放'}
            </button>
            <button type="button" className={styles.btn} data-preview-next onClick={() => step(1)}>
              下一镜
            </button>
            <button type="button" className={styles.btn} data-preview-close onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewMedia({
  clip,
  playing,
  onAdvance,
}: {
  clip: TimelineClip
  playing: boolean
  onAdvance: () => void
}) {
  /** 要**原图**：预览是"看清画面"，用缩略图（240px）糊在大屏上等于没预览 */
  const meta = useAssetMeta(clip.hash, { preferThumb: false })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  /**
   * 回调放 ref：`onAdvance` 每次渲染都是新函数，直接进依赖会让静帧的定时器
   * **每渲染一次就重头计时** —— 于是它永远走不到下一段（"点了播放但不动"）。
   */
  const advance = useRef(onAdvance)
  advance.current = onAdvance

  /** 静帧：按分镜表的秒数撑够时间（命令里那一段就是 `-loop 1 -t N`） */
  useEffect(() => {
    if (clip.kind !== 'image' || !playing || !meta.url) return
    const timer = setTimeout(() => advance.current(), clip.seconds * 1000)
    return () => clearTimeout(timer)
  }, [clip.kind, clip.seconds, playing, meta.url])

  /** 视频：跟着"播放 / 暂停"走，**长度由它自己决定**（`onEnded` 才推下一段） */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) void video.play().catch(() => undefined)
    else video.pause()
  }, [playing, meta.url])

  if (meta.missing) {
    return (
      <p className={styles.empty} data-preview-missing>
        素材缺失{meta.expectedPath ? `（它本该在 ${meta.expectedPath}）` : ''}
      </p>
    )
  }
  if (!meta.url) return <p className={styles.empty}>正在取素材…</p>
  if (clip.kind === 'video') {
    return (
      <video
        ref={videoRef}
        className={styles.media}
        data-preview-media="video"
        src={meta.url}
        muted
        playsInline
        autoPlay={playing}
        onEnded={onAdvance}
      />
    )
  }
  return <img className={styles.media} data-preview-media="image" src={meta.url} alt="" />
}
