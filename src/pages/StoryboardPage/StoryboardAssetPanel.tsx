import { AssetRow } from './AssetRow'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardAssetPanel({
  doc,
  confirming,
  liveNodeIds,
  executionStatus,
  speechTarget,
  merge,
  merges,
  mergeScan,
  mergeConfirmId,
  chatTarget,
  actions,
  imageActions,
  authoringActions,
}: StoryboardEditorViewProps) {
  const mergeChoicesOf = (kind: 'char' | 'scene', dropId: string) =>
    (kind === 'char' ? doc.characters : doc.scenes)
      .filter((asset) => asset.id !== dropId)
      .map((asset) => ({
        id: asset.id,
        name: asset.name.trim() || '未命名',
        refs: doc.shots.filter((shot) =>
          kind === 'char'
            ? (shot.characterIds ?? []).includes(asset.id)
            : shot.sceneId === asset.id,
        ).length,
      }))

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle}>角色 / 场景</h2>
        <div className={styles.headTools}>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-add-character
            onClick={actions.addCharacter}
          >
            新增角色
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-add-scene
            onClick={actions.addScene}
          >
            新增场景
          </button>
        </div>
      </div>
      <p className={styles.hint} data-storyboard-assets-hint>
        项目级资产，跨集复用：拆镜时模型会提一遍，也可以在这里改 / 加 / 删。
      </p>
      {doc.characters.length === 0 && doc.scenes.length === 0 ? (
        <p className={styles.hint} data-storyboard-assets-empty>
          还没有角色 / 场景。拆一次镜，或点上面的「新增」自己建。
        </p>
      ) : null}
      {doc.characters.map((character) => (
        <AssetRow
          key={character.id}
          asset={character}
          kind="char"
          usedBy={
            doc.shots.filter((shot) =>
              shot.characterIds?.includes(character.id),
            ).length
          }
          confirming={confirming === `char:${character.id}`}
          hasNode={Boolean(
            character.nodeId && liveNodeIds.has(character.nodeId),
          )}
          state={
            executionStatus.subjectStateOf(
              `char:${character.id}:base`,
              'asset-base',
            )
          }
          hasTurnaroundNode={Boolean(
            character.turnaroundNodeId &&
              liveNodeIds.has(character.turnaroundNodeId),
          )}
          turnaroundState={
            executionStatus.subjectStateOf(
              `char:${character.id}:turnaround`,
              'asset-turnaround',
            )
          }
          voices={speechTarget?.voices ?? []}
          onPatch={(patch) => actions.patchCharacter(character.id, patch)}
          onRemove={() => actions.removeAsset('char', character.id)}
          onMake={() => void imageActions.makeAssetBase('char', character.id)}
          onTurnaround={() =>
            void imageActions.makeAssetTurnaround(character.id)
          }
          merge={
            merge?.dropId === character.id ? { keepId: merge.keepId } : null
          }
          mergeChoices={mergeChoicesOf('char', character.id)}
          onMergeOpen={() => actions.openMerge('char', character.id)}
          onMergePick={(keepId) =>
            actions.pickMerge('char', character.id, keepId)
          }
          onMergeConfirm={() => actions.confirmMerge('char', character.id)}
          onMergeCancel={actions.cancelMerge}
        />
      ))}
      {doc.scenes.map((scene) => (
        <AssetRow
          key={scene.id}
          asset={scene}
          kind="scene"
          usedBy={doc.shots.filter((shot) => shot.sceneId === scene.id).length}
          confirming={confirming === `scene:${scene.id}`}
          hasNode={Boolean(scene.nodeId && liveNodeIds.has(scene.nodeId))}
          state={executionStatus.subjectStateOf(
            `scene:${scene.id}:base`,
            'asset-base',
          )}
          onPatch={(patch) => actions.patchScene(scene.id, patch)}
          onRemove={() => actions.removeAsset('scene', scene.id)}
          onMake={() => void imageActions.makeAssetBase('scene', scene.id)}
          merge={merge?.dropId === scene.id ? { keepId: merge.keepId } : null}
          mergeChoices={mergeChoicesOf('scene', scene.id)}
          onMergeOpen={() => actions.openMerge('scene', scene.id)}
          onMergePick={(keepId) =>
            actions.pickMerge('scene', scene.id, keepId)
          }
          onMergeConfirm={() => actions.confirmMerge('scene', scene.id)}
          onMergeCancel={actions.cancelMerge}
        />
      ))}
      {doc.characters.length + doc.scenes.length >= 2 ? (
        <div className={styles.mergeScan} data-storyboard-merge-scan-box>
          <div className={styles.headTools}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-merge-scan
              disabled={mergeScan.kind === 'running'}
              onClick={() => void authoringActions.scanMerges()}
            >
              {mergeScan.kind === 'running' ? '正在查…' : '查一遍重复'}
            </button>
            <span className={styles.hint} data-storyboard-merge-scan-note>
              {chatTarget
                ? `会用 ${chatTarget.label} 查（会花一次对话额度）`
                : '还没有可用的对话模型：先去「设置 → 模型服务」给一条服务勾上对话模型'}
            </span>
          </div>
          {mergeScan.text ? (
            <p
              className={
                mergeScan.kind === 'error' ? styles.error : styles.hint
              }
              role={mergeScan.kind === 'error' ? 'alert' : undefined}
              data-storyboard-merge-scan-status={mergeScan.kind}
            >
              {mergeScan.text}
            </p>
          ) : null}
          {merges.map((suggestion) => {
            const key = `${suggestion.keepId}|${suggestion.dropIds.join(',')}`
            const list =
              suggestion.kind === 'char' ? doc.characters : doc.scenes
            const nameOf = (id: string) =>
              list.find((asset) => asset.id === id)?.name ?? '（已删）'
            const drops = suggestion.dropIds.map(nameOf).join('、')
            const refs = suggestion.dropIds.reduce(
              (sum, id) =>
                sum +
                doc.shots.filter((shot) =>
                  suggestion.kind === 'char'
                    ? (shot.characterIds ?? []).includes(id)
                    : shot.sceneId === id,
                ).length,
              0,
            )
            return (
              <div
                className={styles.suggestion}
                key={key}
                data-storyboard-merge-suggestion={key}
              >
                <p className={styles.suggestionText}>
                  疑似重复：「{drops}」与「{nameOf(suggestion.keepId)}」
                  {suggestion.reason ? ` —— ${suggestion.reason}` : ''}
                </p>
                {mergeConfirmId === key ? (
                  <p
                    className={styles.hint}
                    data-storyboard-merge-accept-note={key}
                  >
                    再点一次「确认合并」：会把 {refs} 镜的引用改到「
                    {nameOf(suggestion.keepId)}」，并删掉「{drops}」。
                  </p>
                ) : null}
                <div className={styles.headTools}>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-accept={key}
                    onClick={() => actions.handleMergeSuggestion(suggestion)}
                  >
                    {mergeConfirmId === key ? '确认合并' : '合并'}
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-dismiss={key}
                    onClick={() =>
                      authoringActions.dismissMergeSuggestion(suggestion)
                    }
                  >
                    不是同一个
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
