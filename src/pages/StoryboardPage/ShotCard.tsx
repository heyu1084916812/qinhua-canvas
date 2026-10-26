import { useState } from 'react'
import { DEFAULT_TRANSITION_SECONDS } from '../../domain/storyboard/storyboard'
import type {
  DramaCharacter,
  DramaScene,
  StoryboardLine,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import { digitalHumanPlanOf } from '../../domain/storyboard/digitalHuman'
import {
  normalizeVideoUpscaleSettings,
} from '../../domain/storyboard/videoUpscale'
import {
  normalizeVideoEditResolution,
} from '../../domain/storyboard/videoEdit'
import {
  normalizeVideoExtendSettings,
} from '../../domain/storyboard/videoExtend'
import { describeError } from '../../shared/result'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import type { SpeechTarget } from '../../domain/shared/chatTarget'
import type {
  VideoEditTarget,
  VideoEraseTarget,
  VideoExtendTarget,
  VideoUpscaleTarget,
} from '../../workbenches/storyboard/useStoryboardVideoExecutionController'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import { IconDown, IconTrash, IconUp } from './StoryboardIcons'
import { LineVoiceAudio, ShotThumb, ShotVideo } from './StoryboardMedia'
import styles from './StoryboardPage.module.css'

export function ShotCard({
  shot,
  index,
  total,
  confirming,
  laidOut,
  state,
  characters,
  scenes,
  onPatch,
  onMove,
  onRemove,
  onRun,
  onBindScene,
  onToggleCharacter,
  onLocate,
  onMakeVideo,
  videoPairHint,
  videoUpscaleTargets,
  videoUpscaleBusyShotId,
  onVideoUpscale,
  videoEraseTargets,
  videoEraseBusyShotId,
  onVideoErase,
  videoEditTargets,
  videoEditBusyShotId,
  onVideoEdit,
  videoExtendTargets,
  videoExtendBusyShotId,
  onVideoExtend,
  onDownloadVideo,
  onShowSource,
  onAddLine,
  onLinePatch,
  onLineRemove,
  speechTarget,
  voiceBusy,
  onVoice,
  onMakeDigitalHuman,
  digitalHumanBusyShotId,
  digitalHumanModel,
}: {
  shot: StoryboardShot
  index: number
  total: number
  confirming: boolean
  /** 这一镜的节点**现在还在画布上**（不是"曾经铺过"） */
  laidOut: boolean
  state?: RunTaskState
  characters: readonly DramaCharacter[]
  scenes: readonly DramaScene[]
  onPatch: (
    id: string,
    patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  ) => void
  /** 对白层的三个动作（增 / 改 / 删）—— 与 `updateShot` 分开，各管一件事 */
  onAddLine: () => void
  onLinePatch: (lineId: string, patch: Partial<Omit<StoryboardLine, 'id'>>) => void
  onLineRemove: (lineId: string) => void
  speechTarget: SpeechTarget | null
  voiceBusy: Record<string, boolean>
  onVoice: (lineId: string) => void
  onMakeDigitalHuman?: () => void
  digitalHumanBusyShotId: string | null
  digitalHumanModel?: string
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onRun: () => void
  onBindScene: (sceneId: string | null) => void
  onToggleCharacter: (characterId: string) => void
  /** 「在画布里定位这一镜」（对账 #424）：跳过去选中并居中这一镜的节点；没有节点就不传 */
  onLocate?: () => void
  /** 「出视频」（对账 #429）：这一镜有图且节点还在时才传；不传就不渲染这个入口 */
  onMakeVideo?: () => void
  /** 下一镜也已经出图：视频将优先使用首尾帧，把两镜画面接起来 */
  videoPairHint?: boolean
  /** 当前启用渠道里真实可路由的视频超清模型 */
  videoUpscaleTargets: readonly VideoUpscaleTarget[]
  videoUpscaleBusyShotId: string | null
  onVideoUpscale?: (
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => void
  videoEraseTargets: readonly VideoEraseTarget[]
  videoEraseBusyShotId: string | null
  onVideoErase?: (target: VideoEraseTarget) => void
  videoEditTargets: readonly VideoEditTarget[]
  videoEditBusyShotId: string | null
  onVideoEdit?: (
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => void
  videoExtendTargets: readonly VideoExtendTarget[]
  videoExtendBusyShotId: string | null
  onVideoExtend?: (
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => void
  onDownloadVideo?: () => void
  /** 「看本集原文」（对账 #547）：这一集有可回看的原文片段时才传 */
  onShowSource?: () => void
}) {
  const [upscaleOpen, setUpscaleOpen] = useState(false)
  const [upscaleTargetIndex, setUpscaleTargetIndex] = useState(0)
  const [upscaleResolution, setUpscaleResolution] = useState('1080p')
  const [upscaleFrameRate, setUpscaleFrameRate] = useState<number | null>(30)
  const [videoEraseOpen, setVideoEraseOpen] = useState(false)
  const [videoEraseTargetIndex, setVideoEraseTargetIndex] = useState(0)
  const [videoEditOpen, setVideoEditOpen] = useState(false)
  const [videoEditTargetIndex, setVideoEditTargetIndex] = useState(0)
  const [videoEditInstruction, setVideoEditInstruction] = useState('')
  const [videoEditResolution, setVideoEditResolution] = useState('480p')
  const [videoEditUseReference, setVideoEditUseReference] = useState(false)
  const [videoExtendOpen, setVideoExtendOpen] = useState(false)
  const [videoExtendTargetIndex, setVideoExtendTargetIndex] = useState(0)
  const [videoExtendInstruction, setVideoExtendInstruction] = useState('')
  const [videoExtendResolution, setVideoExtendResolution] = useState('720P')
  const [videoExtendDuration, setVideoExtendDuration] = useState<number | null>(5)
  const currentUpscaleTarget =
    videoUpscaleTargets[Math.min(upscaleTargetIndex, videoUpscaleTargets.length - 1)]
  const currentVideoEraseTarget =
    videoEraseTargets[Math.min(videoEraseTargetIndex, videoEraseTargets.length - 1)]
  const currentVideoEditTarget =
    videoEditTargets[Math.min(videoEditTargetIndex, videoEditTargets.length - 1)]
  const currentVideoExtendTarget =
    videoExtendTargets[Math.min(videoExtendTargetIndex, videoExtendTargets.length - 1)]
  const canReferenceShotImage =
    Boolean(shot.imageHash) &&
    laidOut &&
    Boolean(currentVideoEditTarget?.supportsReferenceImage)
  const upscaleBusy = videoUpscaleBusyShotId === shot.id
  const videoErasing = videoEraseBusyShotId === shot.id
  const videoEditing = videoEditBusyShotId === shot.id
  const videoExtending = videoExtendBusyShotId === shot.id
  const digitalHumanPlan = digitalHumanPlanOf(shot)
  const digitalHumanBusy = digitalHumanBusyShotId === shot.id

  const openUpscale = () => {
    const target = videoUpscaleTargets[0]
    if (!target) return
    const normalized = normalizeVideoUpscaleSettings(target.model)
    setUpscaleTargetIndex(0)
    setUpscaleResolution(normalized.resolution)
    setUpscaleFrameRate(normalized.frameRate)
    setUpscaleOpen(true)
  }

  const openVideoEdit = () => {
    const target = videoEditTargets[0]
    if (!target) return
    setVideoEditTargetIndex(0)
    setVideoEditInstruction('')
    setVideoEditResolution(normalizeVideoEditResolution(target.model))
    setVideoEditUseReference(
      Boolean(target.supportsReferenceImage && shot.imageHash && laidOut),
    )
    setVideoEditOpen(true)
  }

  const openVideoExtend = () => {
    const target = videoExtendTargets[0]
    if (!target) return
    const normalized = normalizeVideoExtendSettings(target.model)
    setVideoExtendTargetIndex(0)
    setVideoExtendInstruction('延续当前镜头内容与运动，保持人物、场景和画风一致')
    setVideoExtendResolution(normalized.resolution)
    setVideoExtendDuration(normalized.duration)
    setVideoExtendOpen(true)
  }

  /**
   * 状态一格写完（界面 / 冒烟都读这一个属性）：
   * 没铺 → idle；铺了没跑 → laid；跑着 → running；失败 → failed；有图 → done。
   * **失败优先于"有图"**：重出失败时旧图还在，但用户此刻要知道的是"这次失败了"。
   */
  const kind = !laidOut
    ? 'idle'
    : state?.kind === 'failed'
      ? 'failed'
      : state?.kind === 'queued' || state?.kind === 'running'
        ? 'running'
        : shot.imageHash
          ? 'done'
          : 'laid'
  const stateText =
    kind === 'idle'
      ? '还没铺到画布'
      : kind === 'laid'
        ? '已在画布上'
        : kind === 'running'
          ? state?.kind === 'queued'
            ? '排队中…'
            : '生成中…'
          : kind === 'failed'
            ? '生成失败'
            : '已出图'
  const busy = state?.kind === 'queued' || state?.kind === 'running'
  return (
    <li className={styles.shot} data-storyboard-shot={shot.id}>
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
          {onShowSource ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-source={shot.id}
              onClick={onShowSource}
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
            onClick={() => onMove(shot.id, -1)}
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
            onClick={() => onMove(shot.id, 1)}
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
            onClick={() => onRemove(shot.id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>
      <div className={styles.shotBar}>
        {shot.videoHash ? (
          <span className={styles.shotVideo} data-storyboard-shot-video-preview={shot.id}>
            <ShotVideo hash={shot.videoHash} />
          </span>
        ) : null}
        {shot.imageHash ? (
          <span className={styles.shotImage} data-storyboard-shot-image={shot.id}>
            <ShotThumb hash={shot.imageHash} />
          </span>
        ) : null}
        <div className={styles.itemTools}>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-shot-run={shot.id}
            disabled={!laidOut || busy}
            onClick={onRun}
          >
            {shot.imageHash ? '重出这一镜' : '出图'}
          </button>
          {/*
            在画布里定位这一镜（对账 #424）：以前只有这一集级别的「在画布里打开」，
            一集十几镜铺下去之后，要在画布上找到"刚才那一镜"只能靠肉眼扫。
          */}
          {onLocate ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-locate={shot.id}
              onClick={onLocate}
            >
              在画布里定位
            </button>
          ) : null}
          {/*
            「出视频」（对账 #429）：只在这一镜**已经铺到画布、且已经出了图**时出现 ——
            图生视频要先有画面。不摆一个点了会被拒的按钮。
            另起一个视频节点（图不会被顶掉），跑完 hash 由镜像 effect 收回文档。
          */}
          {onMakeVideo ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-video={shot.id}
              disabled={busy}
              title={
                videoPairHint
                  ? '下一镜也已出图：优先用这一镜和下一镜做首尾帧；模型不支持时回落单张首帧'
                  : '拿这一镜的图去生成一段视频（另起一个视频节点，这一镜的图不会被顶掉）'
              }
              onClick={onMakeVideo}
            >
              {shot.videoHash
                ? `重出这一镜的视频${videoPairHint ? ' · 首尾帧' : ''}`
                : `出视频${videoPairHint ? ' · 首尾帧' : ''}`}
            </button>
          ) : null}
          {onVideoUpscale && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-upscale={shot.id}
              disabled={busy || upscaleBusy}
              onClick={() => (upscaleOpen ? setUpscaleOpen(false) : openUpscale())}
            >
              {upscaleBusy ? '视频处理中…' : '视频后处理'}
            </button>
          ) : null}
          {onVideoErase && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-erase={shot.id}
              disabled={busy || videoErasing}
              onClick={() => setVideoEraseOpen((current) => !current)}
            >
              {videoErasing ? '字幕擦除中…' : '字幕擦除'}
            </button>
          ) : null}
          {onVideoEdit && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-edit={shot.id}
              disabled={busy || videoEditing}
              onClick={() =>
                videoEditOpen ? setVideoEditOpen(false) : openVideoEdit()
              }
            >
              {videoEditing ? '视频编辑中…' : '视频编辑'}
            </button>
          ) : null}
          {onVideoExtend && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-extend={shot.id}
              disabled={busy || videoExtending}
              onClick={() =>
                videoExtendOpen ? setVideoExtendOpen(false) : openVideoExtend()
              }
            >
              {videoExtending ? '视频续写中…' : '视频续写'}
            </button>
          ) : null}
          {onDownloadVideo && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-download-video={shot.id}
              onClick={onDownloadVideo}
            >
              下载视频
            </button>
          ) : null}
        </div>
      </div>
      {upscaleOpen && currentUpscaleTarget ? (
        <div className={styles.upscalePanel} data-storyboard-upscale-panel={shot.id}>
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-upscale-target-${shot.id}`}
              className={styles.select}
              value={String(upscaleTargetIndex)}
              ariaLabel="超清模型"
              options={videoUpscaleTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(next) => {
                const nextIndex = Number(next)
                const nextTarget = videoUpscaleTargets[nextIndex]
                if (!nextTarget) return
                const normalized = normalizeVideoUpscaleSettings(nextTarget.model)
                setUpscaleTargetIndex(nextIndex)
                setUpscaleResolution(normalized.resolution)
                setUpscaleFrameRate(normalized.frameRate)
              }}
            />
          </label>
          {currentUpscaleTarget.resolutions.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>清晰度</span>
              <ChoicePicker
                name={`storyboard-upscale-resolution-${shot.id}`}
                className={styles.select}
                value={upscaleResolution}
                ariaLabel="超清清晰度"
                options={currentUpscaleTarget.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setUpscaleResolution}
              />
            </label>
          ) : null}
          {currentUpscaleTarget.frameRates.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>帧率</span>
              <ChoicePicker
                name={`storyboard-upscale-fps-${shot.id}`}
                className={styles.select}
                value={upscaleFrameRate == null ? '' : String(upscaleFrameRate)}
                ariaLabel="超清帧率"
                options={currentUpscaleTarget.frameRates.map((value) => ({
                  value: String(value),
                  label: `${value}fps`,
                }))}
                onChange={(value) => setUpscaleFrameRate(Number(value))}
              />
            </label>
          ) : null}
          <div className={styles.upscaleActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-upscale-cancel={shot.id}
              disabled={upscaleBusy}
              onClick={() => setUpscaleOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-upscale-submit={shot.id}
              disabled={upscaleBusy}
              onClick={() => {
                setUpscaleOpen(false)
                onVideoUpscale?.(
                  currentUpscaleTarget,
                  upscaleResolution,
                  upscaleFrameRate,
                )
              }}
            >
              开始超清
            </button>
          </div>
        </div>
      ) : null}
      {videoEraseOpen && currentVideoEraseTarget ? (
        <div
          className={styles.videoEditPanel}
          data-storyboard-video-erase-panel={shot.id}
        >
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-video-erase-target-${shot.id}`}
              className={styles.select}
              value={String(videoEraseTargetIndex)}
              ariaLabel="字幕擦除模型"
              options={videoEraseTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(value) => setVideoEraseTargetIndex(Number(value))}
            />
          </label>
          <div className={styles.videoEditActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-erase-cancel={shot.id}
              disabled={videoErasing}
              onClick={() => setVideoEraseOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-video-erase-submit={shot.id}
              disabled={videoErasing}
              onClick={() => {
                setVideoEraseOpen(false)
                onVideoErase?.(currentVideoEraseTarget)
              }}
            >
              开始擦除
            </button>
          </div>
        </div>
      ) : null}
      {videoEditOpen && currentVideoEditTarget ? (
        <div
          className={styles.videoEditPanel}
          data-storyboard-video-edit-panel={shot.id}
        >
          <label className={`${styles.inlineField} ${styles.videoEditPrompt}`}>
            <span className={styles.label}>修改要求</span>
            <textarea
              className={styles.textarea}
              rows={2}
              value={videoEditInstruction}
              placeholder="例如：把白天改成雨夜，保留人物动作和镜头运动"
              data-storyboard-video-edit-instruction={shot.id}
              onChange={(e) => setVideoEditInstruction(e.target.value)}
            />
          </label>
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-video-edit-target-${shot.id}`}
              className={styles.select}
              value={String(videoEditTargetIndex)}
              ariaLabel="视频编辑模型"
              options={videoEditTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(value) => {
                const nextIndex = Number(value)
                const nextTarget = videoEditTargets[nextIndex]
                if (!nextTarget) return
                setVideoEditTargetIndex(nextIndex)
                setVideoEditResolution(normalizeVideoEditResolution(nextTarget.model))
                setVideoEditUseReference(
                  Boolean(nextTarget.supportsReferenceImage && shot.imageHash && laidOut),
                )
              }}
            />
          </label>
          {currentVideoEditTarget.resolutions.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>清晰度</span>
              <ChoicePicker
                name={`storyboard-video-edit-resolution-${shot.id}`}
                className={styles.select}
                value={videoEditResolution}
                ariaLabel="视频编辑清晰度"
                options={currentVideoEditTarget.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setVideoEditResolution}
              />
            </label>
          ) : null}
          {currentVideoEditTarget.supportsReferenceImage ? (
            <label
              className={styles.videoEditReference}
              title={
                canReferenceShotImage
                  ? '把当前镜头画面作为参考图一起发送'
                  : '当前镜头没有可引用的画面'
              }
            >
              <input
                type="checkbox"
                checked={videoEditUseReference && canReferenceShotImage}
                disabled={!canReferenceShotImage}
                data-storyboard-video-edit-reference={shot.id}
                onChange={(e) => setVideoEditUseReference(e.target.checked)}
              />
              <span>
                参考当前画面
                {currentVideoEditTarget.requiresReferenceImage ? '（必需）' : ''}
              </span>
            </label>
          ) : null}
          <div className={styles.videoEditActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-edit-cancel={shot.id}
              disabled={videoEditing}
              onClick={() => setVideoEditOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-video-edit-submit={shot.id}
              disabled={
                videoEditing ||
                !videoEditInstruction.trim() ||
                (currentVideoEditTarget.requiresReferenceImage &&
                  !(videoEditUseReference && canReferenceShotImage))
              }
              onClick={() => {
                setVideoEditOpen(false)
                onVideoEdit?.(
                  currentVideoEditTarget,
                  videoEditInstruction,
                  videoEditResolution,
                  videoEditUseReference && canReferenceShotImage,
                )
              }}
            >
              开始编辑
            </button>
          </div>
        </div>
      ) : null}
      {videoExtendOpen && currentVideoExtendTarget ? (
        <div
          className={styles.videoEditPanel}
          data-storyboard-video-extend-panel={shot.id}
        >
          <label className={`${styles.inlineField} ${styles.videoEditPrompt}`}>
            <span className={styles.label}>续写要求</span>
            <textarea
              className={styles.textarea}
              rows={2}
              value={videoExtendInstruction}
              placeholder="续写接下来发生什么，保持人物、场景和画风一致"
              data-storyboard-video-extend-instruction={shot.id}
              onChange={(e) => setVideoExtendInstruction(e.target.value)}
            />
          </label>
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-video-extend-target-${shot.id}`}
              className={styles.select}
              value={String(videoExtendTargetIndex)}
              ariaLabel="视频续写模型"
              options={videoExtendTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(value) => {
                const nextIndex = Number(value)
                const nextTarget = videoExtendTargets[nextIndex]
                if (!nextTarget) return
                const normalized = normalizeVideoExtendSettings(nextTarget.model)
                setVideoExtendTargetIndex(nextIndex)
                setVideoExtendResolution(normalized.resolution)
                setVideoExtendDuration(normalized.duration)
              }}
            />
          </label>
          {currentVideoExtendTarget.resolutions.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>清晰度</span>
              <ChoicePicker
                name={`storyboard-video-extend-resolution-${shot.id}`}
                className={styles.select}
                value={videoExtendResolution}
                ariaLabel="视频续写清晰度"
                options={currentVideoExtendTarget.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setVideoExtendResolution}
              />
            </label>
          ) : null}
          {currentVideoExtendTarget.durations.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>新增时长</span>
              <ChoicePicker
                name={`storyboard-video-extend-duration-${shot.id}`}
                className={styles.select}
                value={videoExtendDuration == null ? '' : String(videoExtendDuration)}
                ariaLabel="视频续写新增时长"
                options={currentVideoExtendTarget.durations.map((value) => ({
                  value: String(value),
                  label: `${value}s`,
                }))}
                onChange={(value) => setVideoExtendDuration(Number(value))}
              />
            </label>
          ) : null}
          <div className={styles.videoEditActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-extend-cancel={shot.id}
              disabled={videoExtending}
              onClick={() => setVideoExtendOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-video-extend-submit={shot.id}
              disabled={videoExtending}
              onClick={() => {
                setVideoExtendOpen(false)
                onVideoExtend?.(
                  currentVideoExtendTarget,
                  videoExtendInstruction,
                  videoExtendResolution,
                  videoExtendDuration,
                )
              }}
            >
              开始续写
            </button>
          </div>
        </div>
      ) : null}
      {state?.kind === 'failed' ? (
        <p className={styles.error} data-storyboard-shot-error={shot.id}>
          {describeError(state.error)}
        </p>
      ) : null}
      {/**
       * 这一镜绑了谁 / 在哪拍（对账 #416）。
       *
       * 一镜**一个场景**（场景是资产不是容器）+ 若干出场角色（点一下切换）。
       * 绑定只改文档，不动提示词：提示词仍以这一镜的 `prompt` / `scene` 为准
       * （把角色描述拼进提示词，是接参考图 / 定妆图那一步的事，别混在这一步里）。
       */}
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
            onChange={(value) => onBindScene(value || null)}
          />
        </label>
        <div className={styles.inlineField}>
          <span className={styles.label}>出场角色</span>
          <div className={styles.chips} data-storyboard-shot-cast={shot.id}>
            {characters.length === 0 ? (
              <span className={styles.hint}>还没有角色</span>
            ) : (
              characters.map((c) => {
                const on = shot.characterIds?.includes(c.id) ?? false
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={on}
                    data-storyboard-shot-character={shot.id}
                    data-character-id={c.id}
                    data-on={on ? 'true' : 'false'}
                    onClick={() => onToggleCharacter(c.id)}
                  >
                    {c.name}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.scene}
          placeholder="这一镜画什么"
          data-storyboard-shot-scene={shot.id}
          onChange={(e) => onPatch(shot.id, { scene: e.target.value })}
        />
      </label>
      <div className={styles.row2}>
        {/**
         * **对白层**（对账 #435）：「一镜一句自由文本」升级成**一镜多句 + 谁说的**。
         * 两个理由都是实的：① 两个人对着说话的镜头本来就需要两条；
         * ② 说话人是**压字幕 / 将来喂 TTS** 的必需字段（研究稿 §34）。
         * 空态写清"可以是空的（空镜）"，不摆一个必须填的框。
         */}
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
                  onClick={onMakeDigitalHuman}
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
                onClick={onAddLine}
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
                        onChange={(value) => onLinePatch(line.id, { speakerId: value })}
                      />
                      <input
                        className={styles.input}
                        value={line.text}
                        placeholder="这一句"
                        aria-label="台词"
                        data-storyboard-line-text={line.id}
                        onChange={(e) => onLinePatch(line.id, { text: e.target.value })}
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label="删掉这一句"
                        data-storyboard-line-remove={line.id}
                        onClick={() => onLineRemove(line.id)}
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
                          onChange={(value) => onLinePatch(line.id, { voice: value })}
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
                          onChange={(e) => onLinePatch(line.id, { speed: Number(e.target.value) })}
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.ghost}
                        data-storyboard-line-voice={line.id}
                        disabled={!speechTarget || busy || !line.text.trim()}
                        title={speechTarget?.label ?? '先在设置里勾选配音模型'}
                        onClick={() => onVoice(line.id)}
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
            onChange={(e) => onPatch(shot.id, { durationSec: Number(e.target.value) })}
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
                  onPatch(shot.id, {
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
                    onPatch(shot.id, { transitionSec: Number(e.target.value) })
                  }
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面提示词</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.prompt}
          placeholder="留空就用上面的「画面」"
          data-storyboard-shot-prompt={shot.id}
          onChange={(e) => onPatch(shot.id, { prompt: e.target.value })}
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
          onChange={(e) => onPatch(shot.id, { videoPrompt: e.target.value })}
        />
      </label>
    </li>
  )
}
