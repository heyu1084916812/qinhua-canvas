import { useState } from 'react'
import type {
  DramaAsset,
  DramaCharacter,
} from '../../domain/storyboard/storyboard'
import { describeError } from '../../shared/result'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import { IconTrash } from './StoryboardIcons'
import { AssetThumb } from './StoryboardMedia'
import styles from './StoryboardPage.module.css'

export function AssetRow({
  asset,
  kind,
  usedBy,
  confirming,
  hasNode,
  state,
  hasTurnaroundNode = false,
  turnaroundState,
  voices = [],
  onPatch,
  onRemove,
  onMake,
  onTurnaround,
  merge,
  mergeChoices = [],
  onMergeOpen,
  onMergePick,
  onMergeConfirm,
  onMergeCancel,
}: {
  asset: DramaAsset & Partial<Pick<DramaCharacter, 'voice' | 'speed'>>
  kind: 'char' | 'scene'
  /** 有多少镜在用（删除确认里如实报数） */
  usedBy: number
  confirming: boolean
  /** 这条资产的生成节点**现在还在画布上**（不是"曾经建过"） */
  hasNode: boolean
  state?: RunTaskState
  /** 多视角 turnaround 的节点现在还在画布上 */
  hasTurnaroundNode?: boolean
  turnaroundState?: RunTaskState
  voices?: readonly string[]
  onPatch: (
    patch: Partial<
      Pick<DramaCharacter, 'name' | 'description' | 'aliases' | 'voice' | 'speed'>
    >,
  ) => void
  onRemove: () => void
  onMake: () => void
  onTurnaround?: () => void
  /** 合并（#436）：`null` = 没在合并；`keepId` 空 = 还在选目标，有 = 等确认 */
  merge?: { keepId: string | null } | null
  /** 可以并进的同类资产（含各自的引用镜数）—— 没有别的同类资产时这个按钮不出现 */
  mergeChoices?: readonly { id: string; name: string; refs: number }[]
  onMergeOpen?: () => void
  onMergePick?: (keepId: string) => void
  onMergeConfirm?: () => void
  onMergeCancel?: () => void
}) {
  const [aliasText, setAliasText] = useState(asset.aliases.join('、'))
  const label = kind === 'char' ? '定妆图' : '基准图'
  /**
   * 状态一格写完（界面 / 冒烟都读这一个属性）：
   * 没节点 → idle；有节点没图 → laid；跑着 → running；失败 → failed；有图 → done。
   * **失败优先于"有图"**：重出失败时旧图还在，但用户此刻要知道的是"这次失败了"。
   */
  const statusKind =
    state?.kind === 'failed'
      ? 'failed'
      : state?.kind === 'queued' || state?.kind === 'running'
        ? 'running'
        : asset.baseHash
          ? 'done'
          : hasNode
            ? 'laid'
            : 'idle'
  const statusText =
    statusKind === 'idle'
      ? `还没出${label}`
      : statusKind === 'laid'
        ? '已建节点'
        : statusKind === 'running'
          ? state?.kind === 'queued'
            ? '排队中…'
            : '生成中…'
          : statusKind === 'failed'
            ? '生成失败'
            : '已出图'
  const busy = state?.kind === 'queued' || state?.kind === 'running'
  const turnaroundBusy =
    turnaroundState?.kind === 'queued' || turnaroundState?.kind === 'running'
  const turnaroundStatusKind =
    turnaroundState?.kind === 'failed'
      ? 'failed'
      : turnaroundBusy
        ? 'running'
        : asset.turnaroundHash
          ? 'done'
          : hasTurnaroundNode
            ? 'laid'
            : 'idle'
  const turnaroundStatusText =
    turnaroundStatusKind === 'idle'
      ? '还没出多视角'
      : turnaroundStatusKind === 'laid'
        ? '已建节点'
        : turnaroundStatusKind === 'running'
          ? '生成中…'
          : turnaroundStatusKind === 'failed'
            ? '生成失败'
            : '已出多视角'
  const voiceOptions = [
    ...new Set(
      [asset.voice, ...voices].filter((item): item is string => Boolean(item)),
    ),
  ]
  return (
    <div
      className={styles.assetRow}
      data-asset-kind={kind}
      {...(kind === 'char'
        ? { 'data-storyboard-character': asset.id }
        : { 'data-storyboard-scene': asset.id })}
    >
      <span className={styles.assetKind}>{kind === 'char' ? '角色' : '场景'}</span>
      <input
        className={styles.assetName}
        value={asset.name}
        aria-label="名字"
        data-storyboard-asset-name={asset.id}
        onChange={(e) => onPatch({ name: e.target.value })}
      />
      <input
        className={styles.assetDesc}
        value={asset.description}
        aria-label="描述"
        placeholder={kind === 'char' ? '外观 / 身份' : '场地与氛围'}
        data-storyboard-asset-desc={asset.id}
        onChange={(e) => onPatch({ description: e.target.value })}
      />
      <input
        className={styles.assetAliases}
        value={aliasText}
        aria-label="别名"
        placeholder="别名，用、分隔"
        data-storyboard-asset-aliases={asset.id}
        onChange={(e) => {
          setAliasText(e.target.value)
          onPatch({
            aliases: e.target.value
              .split(/[、,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }}
        onBlur={() => setAliasText(asset.aliases.join('、'))}
      />
      {kind === 'char' ? (
        <div className={styles.assetVoiceRow}>
          <label className={styles.inlineField}>
            <span className={styles.label}>默认音色</span>
            <ChoicePicker
              name={`storyboard-character-voice-${asset.id}`}
              className={styles.select}
              value={asset.voice ?? ''}
              ariaLabel="角色默认音色"
              options={[
                { value: '', label: '跟随渠道默认' },
                ...voiceOptions.map((voice) => ({ value: voice, label: voice })),
              ]}
              onChange={(voice) => onPatch({ voice })}
            />
          </label>
          <label className={styles.inlineField}>
            <span className={styles.label}>默认语速</span>
            <input
              className={styles.input}
              type="number"
              min={0.25}
              max={4}
              step={0.05}
              value={asset.speed ?? 1}
              data-storyboard-character-speed={asset.id}
              onChange={(e) => onPatch({ speed: Number(e.target.value) })}
            />
          </label>
        </div>
      ) : null}
      <button
        type="button"
        className={confirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
        aria-label={confirming ? `再点一次：会从 ${usedBy} 镜里去掉` : '删除'}
        title={confirming ? `再点一次：会从 ${usedBy} 镜里去掉` : '删除'}
        data-storyboard-asset-remove={asset.id}
        data-confirming={confirming ? 'true' : 'false'}
        onClick={onRemove}
      >
        <IconTrash />
      </button>
      <div className={styles.assetFoot}>
        <div className={styles.assetFootRow}>
          {asset.baseHash ? (
            <span className={styles.shotImage} data-storyboard-asset-image={asset.id}>
              <AssetThumb hash={asset.baseHash} />
            </span>
          ) : null}
          <span
            className={
              statusKind === 'failed' ? `${styles.shotState} ${styles.shotStateBad}` : styles.shotState
            }
            data-storyboard-asset-status={asset.id}
            data-kind={statusKind}
          >
            {statusText}
          </span>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-asset-base={asset.id}
            disabled={busy}
            onClick={onMake}
          >
            {asset.baseHash ? `重出${label}` : `出${label}`}
          </button>
          {kind === 'char' && asset.turnaroundHash ? (
            <span
              className={styles.shotImage}
              data-storyboard-asset-turnaround-image={asset.id}
            >
              <AssetThumb hash={asset.turnaroundHash} />
            </span>
          ) : null}
          {kind === 'char' && onTurnaround ? (
            <span
              className={
                turnaroundStatusKind === 'failed'
                  ? `${styles.shotState} ${styles.shotStateBad}`
                  : styles.shotState
              }
              data-storyboard-asset-turnaround-status={asset.id}
              data-kind={turnaroundStatusKind}
            >
              {turnaroundStatusText}
            </span>
          ) : null}
          {kind === 'char' && onTurnaround ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-asset-turnaround={asset.id}
              disabled={turnaroundBusy || busy}
              onClick={onTurnaround}
            >
              {asset.turnaroundHash ? '重出多视角' : '多视角'}
            </button>
          ) : null}
          {/**
           * 「并入…」（对账 #436）：拆镜按 `name + aliases` 自动归并，但模型换个叫法
           * （"林轩" / "林公子"）就会落下两条重复。以前只能删掉一条 —— 而删会把引用一起清掉。
           * 合并才是这件事的答案。没别的同类资产时按钮不出现（点了没人可并）。
           */}
          {onMergeOpen && mergeChoices.length > 0 ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-asset-merge={asset.id}
              onClick={onMergeOpen}
            >
              并入…
            </button>
          ) : null}
        </div>
        {merge ? (
          <div className={styles.mergeBox} data-storyboard-merge-box={asset.id}>
            {merge.keepId === null ? (
              <>
                <span className={styles.hint}>并入哪一条？</span>
                <div className={styles.mergeChoices}>
                  {mergeChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={styles.ghost}
                      data-storyboard-merge-target={choice.id}
                      onClick={() => onMergePick?.(choice.id)}
                    >
                      并入 {choice.name}（{choice.refs} 镜引用）
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/**
                 * 第二下**只说后果**：会改几镜的引用、然后删掉这一条。
                 * 与删资产那条"两下确认"同一条口径 —— 不可撤销的动作先把代价说清楚。
                 */}
                <p className={styles.hint} data-storyboard-merge-note={asset.id}>
                  把「{asset.name}」并进「
                  {mergeChoices.find((c) => c.id === merge.keepId)?.name ?? ''}」：会改 {usedBy}{' '}
                  镜的引用，然后删掉这一条。
                </p>
                <div className={styles.mergeChoices}>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-confirm={asset.id}
                    onClick={onMergeConfirm}
                  >
                    确认合并
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-cancel={asset.id}
                    onClick={onMergeCancel}
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {state?.kind === 'failed' ? (
          <p className={styles.error} data-storyboard-asset-error={asset.id}>
            {describeError(state.error)}
          </p>
        ) : null}
      </div>
    </div>
  )
}
