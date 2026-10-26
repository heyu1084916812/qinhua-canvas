import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardSourcePanel({
  doc,
  split,
  splitConfirm,
  chatTarget,
  actions,
  authoringActions,
}: StoryboardEditorViewProps) {
  return (
    <>
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className={styles.blockTitle}>原文（小说 / 大纲）</h2>
          <div className={styles.headTools}>
            {split.kind === 'running' ? (
              <button
                type="button"
                className={styles.ghost}
                data-storyboard-split-cancel
                onClick={authoringActions.cancelSplit}
              >
                取消
              </button>
            ) : null}
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-split-run
              disabled={split.kind === 'running'}
              onClick={() => void authoringActions.runSplit()}
            >
              {splitConfirm
                ? `再点一次：替换这 ${doc.episodes.length} 集（含 ${doc.shots.length} 镜）`
                : '拆成多集'}
            </button>
          </div>
        </div>
        <textarea
          className={styles.textarea}
          rows={7}
          value={doc.sourceText}
          placeholder="把小说 / 大纲粘进来。有「第一章 / 楔子 / Chapter 1」这类标记就按标记切，没有就按字数兜底"
          data-storyboard-source-text
          onChange={(e) => actions.patchSourceText(e.target.value)}
        />
        <p className={styles.hint} data-storyboard-split-hint>
          {chatTarget
            ? `会用 ${chatTarget.label} 起名 / 写梗概；条数对不上就回落章节名`
            : '还没配对话模型也能拆：按结构切分，标题用章节名 / 第 N 集'}
        </p>
        {split.kind !== 'idle' ? (
          <p
            className={split.kind === 'error' ? styles.error : styles.hint}
            role="status"
            data-storyboard-split-status={split.kind}
          >
            {split.kind === 'running' ? '正在拆集…' : split.text}
          </p>
        ) : null}
      </div>

      <div className={styles.block}>
        <h2 className={styles.blockTitle}>剧本</h2>
        <label className={styles.field}>
          <span className={styles.label}>片名</span>
          <input
            className={styles.input}
            value={doc.script.title}
            data-storyboard-script-title
            onChange={(e) => actions.patchScript({ title: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>一句话故事</span>
          <input
            className={styles.input}
            value={doc.script.logline}
            placeholder="一句话说清这个故事"
            data-storyboard-script-logline
            onChange={(e) => actions.patchScript({ logline: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>正文</span>
          <textarea
            className={styles.textarea}
            rows={9}
            value={doc.script.body}
            placeholder="把故事写下来；分集与分镜从这一段拆"
            data-storyboard-script-body
            onChange={(e) => actions.patchScript({ body: e.target.value })}
          />
        </label>
      </div>
    </>
  )
}
