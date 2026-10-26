import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardShotToolbar({
  shots,
  needNodes,
  laidCount,
  videoPending,
  voicePending,
  timeline,
  timelineSrt,
  timelineSrtCues,
  breaking,
  breakMsg,
  breakConfirm,
  lay,
  rendering,
  voiceBusy,
  chatTarget,
  speechTarget,
  canvas,
  canRenderLocally,
  actions,
  authoringActions,
  imageActions,
  videoActions,
  audioActions,
  exportActions,
  shotActions,
}: StoryboardEditorViewProps) {
  return (
    <>
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle}>分镜</h2>
        <div className={styles.headTools}>
          {breaking === 'running' ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-breakdown-cancel
              onClick={authoringActions.cancelBreakdown}
            >
              取消
            </button>
          ) : null}
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-breakdown-run
            disabled={breaking === 'running' || !chatTarget}
            onClick={() => void authoringActions.runBreakdown()}
          >
            {breakConfirm ? `再点一次：替换这 ${shots.length} 镜` : '用模型拆这一集'}
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-lay-out
            disabled={shots.length === 0}
            onClick={() => void shotActions.layOut()}
          >
            {needNodes.length > 0
              ? `铺到画布（${needNodes.length} 镜）`
              : '已铺到画布'}
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-run-all
            disabled={laidCount === 0 || canvas.isRunning}
            onClick={() => void imageActions.runEpisode()}
          >
            这一集出图
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-run-all-video
            disabled={videoPending === 0 || canvas.isRunning}
            title={
              videoPending > 0
                ? `逐镜生成这一集还缺视频的 ${videoPending} 个镜头`
                : '这一集没有待出视频的镜头'
            }
            onClick={() => void videoActions.runEpisodeVideos(shots)}
          >
            这一集出视频
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-run-all-voice
            disabled={
              voicePending === 0 ||
              !speechTarget ||
              Object.keys(voiceBusy).length > 0
            }
            title={
              speechTarget
                ? voicePending > 0
                  ? `逐句补齐这一集还缺配音的 ${voicePending} 句台词`
                  : '这一集没有待补配音的台词'
                : '先去设置里给渠道勾选一个 audio / tts 模型'
            }
            onClick={() => void audioActions.runEpisodeVoices()}
          >
            补齐本集配音
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-preview
            disabled={timeline.clips.length === 0}
            onClick={actions.openPreview}
          >
            预览这一集
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-export-pack
            disabled={shots.length === 0}
            onClick={() => void exportActions.onExportPack()}
          >
            导出合成包
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-export-srt
            disabled={!timelineSrt}
            title={
              timelineSrt
                ? `下载这一集的 SRT，共 ${timelineSrtCues} 条字幕`
                : '这一集还没有可导出的台词字幕'
            }
            onClick={() => void exportActions.onExportSrt()}
          >
            导出 SRT
          </button>
          {canRenderLocally ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-render-video
              disabled={timeline.clips.length === 0 || rendering}
              title="调用本机 FFmpeg 直接合成并保存成片；需要 FFmpeg 已加入 PATH"
              onClick={() => void exportActions.renderEpisode()}
            >
              {rendering ? '本机合成中…' : '本机合成成片'}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-sync-prompts
            disabled={laidCount === 0}
            onClick={shotActions.syncPrompts}
          >
            刷新提示词
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-add-shot
            onClick={actions.addShot}
          >
            新增一镜
          </button>
        </div>
      </div>
      <p className={styles.hint} data-storyboard-breakdown-hint>
        {chatTarget
          ? `将用 ${chatTarget.label} 拆解；结果只写进这一集`
          : '还没有可用的对话模型 —— 去「全局设置 → 模型服务」给一条服务勾上对话模型'}
      </p>
      {breaking !== 'idle' ? (
        <p
          className={breaking === 'error' ? styles.error : styles.hint}
          role="status"
          data-storyboard-breakdown-status={breaking}
        >
          {breaking === 'running' ? '正在拆解…' : breakMsg}
        </p>
      ) : null}
      <p className={styles.hint} data-storyboard-canvas-hint={laidCount}>
        画布：这一集 {laidCount}/{shots.length} 镜已在画布上
        <button
          type="button"
          className={styles.linkBtn}
          data-storyboard-open-canvas
          onClick={actions.openCanvas}
        >
          在画布里打开
        </button>
      </p>
      {lay.kind !== 'idle' ? (
        <p
          className={lay.kind === 'error' ? styles.error : styles.hint}
          role="status"
          data-storyboard-lay-status={lay.kind}
        >
          {lay.text}
        </p>
      ) : null}
      {shots.some(
        (shot) => shot.sceneId || (shot.characterIds?.length ?? 0) > 0,
      ) ? (
        <p className={styles.hint} data-storyboard-asset-prompt-hint>
          提示词里已带上绑定的场景 / 角色设定；改完描述点「刷新提示词」同步到画布。
        </p>
      ) : null}
    </>
  )
}
