import { PRESETS, PRESET_CATEGORIES, presetById } from '../../../domain/canvas/layout/presets'
import type { PresetCategoryId } from '../../../domain/canvas/layout/presets'
import { IconCheck, IconEmotion } from '../toolbar/icons'
import { PRESET_ICON } from './presetIcons'
import styles from './PresetMenu.module.css'

/**
 * 预设菜单（用户 2026-10-05 第 14 条，参考图十八那两栏）。
 *
 * 分工钉在这里，别在别处再摆一份：
 * - 本组件只负责**选哪个 id**（`onPick(presetId)`），
 *   名字 / 示例小字 / 会拼进提示词的那句全在 `domain/canvas/layout/presets.ts`；
 * - 二级搭配是**另一个组件**（下面那个 `PresetOptions`），因为它的入口不是「换预设」
 *   而是预设上那枚齿轮（图十九：点右边不是切换，是选具体搭配）。
 */

/**
 * 菜单的**分栏**（用户 2026-10-05 第 2 条：「参考图二的位置以及大小还有分布」）。
 *
 * 参考图是：左栏「分镜叙事 + 质感调节」、右栏「空间与机位 + 设定图」。
 * 用 `column-count: 2` 是做不到的 —— 浏览器按高度自己分（实测分成了
 * 「分镜叙事 + 空间与机位 / 设定图 + 质感调节」），与参考图不一样。
 * 所以两栏**显式写死**：分布是产品决定，不该交给自动平衡。
 */
const MENU_COLUMNS: readonly (readonly PresetCategoryId[])[] = [
  ['story', 'texture'],
  ['camera', 'design'],
]

export function PresetMenu({
  activeId,
  onPick,
  emotionOn,
  onPickEmotion,
}: {
  activeId: string | null
  onPick: (presetId: string) => void
  /** 「情绪调节」开着没有（它有自己的状态，不是一条预设） */
  emotionOn: boolean
  onPickEmotion: () => void
}) {
  return (
    <div className={styles.menu} data-preset-menu>
      {MENU_COLUMNS.map((column, i) => (
        <div key={i} className={styles.column}>
          {column.map((categoryId) => {
            const category = PRESET_CATEGORIES.find((c) => c.id === categoryId)
            if (!category) return null
            return (
            <div key={categoryId} className={styles.group} data-preset-category={categoryId}>
              <div className={styles.groupLabel}>{category.label}</div>
              {PRESETS.filter((p) => p.category === categoryId).map((preset) => {
                const on = preset.id === activeId
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={on ? `${styles.item} ${styles.itemOn}` : styles.item}
                    data-preset={preset.id}
                    aria-pressed={on}
                    title={preset.hint}
                    onClick={() => onPick(preset.id)}
                  >
                    <span className={styles.itemIcon} aria-hidden="true">
                      {/* 每条预设自己的矢量图（用户第 8 条），见 presetIcons.tsx */}
                      {PRESET_ICON[preset.id]}
                    </span>
                    <span className={styles.itemName}>{preset.name}</span>
                    {on && (
                      <span className={styles.itemCheck} aria-hidden="true">
                        <IconCheck size={14} />
                      </span>
                    )}
                  </button>
                )
              })}
              {/*
                「情绪调节」跟在「质感调节」这一栏里（用户 2026-10-05 第 14 条后半）：
                它**不是一条预设**（没有那句拼进提示词的话，而是一个独立的点位选择面板），
                所以列在那份预设表之外，由素材下方那块独立面板（`EmotionBox`）承担。
              */}
              {categoryId === 'texture' && (
                <button
                  type="button"
                  className={emotionOn ? `${styles.item} ${styles.itemOn}` : styles.item}
                  data-preset-emotion
                  aria-pressed={emotionOn}
                  title="打开情绪面板，选一个表情"
                  onClick={onPickEmotion}
                >
                  <span className={styles.itemIcon} aria-hidden="true">
                    <IconEmotion size={16} />
                  </span>
                  <span className={styles.itemName}>情绪调节</span>
                  {emotionOn && (
                    <span className={styles.itemCheck} aria-hidden="true">
                      <IconCheck size={14} />
                    </span>
                  )}
                </button>
              )}
            </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * 二级搭配（图十九：人景融合 / 光影融合 / 皮肤 / 纹理 / 锐度，每组三档）。
 *
 * 只对**带 `options` 的预设**渲染（现在只有「人像质感调节」）；其余预设点开齿轮
 * 什么都不会有，所以调用方要先判断 `presetById(id)?.options`。
 */
export function PresetOptions({
  presetId,
  options,
  onPick,
}: {
  presetId: string
  options: Record<string, string>
  onPick: (group: string, choice: string) => void
}) {
  const preset = presetById(presetId)
  if (!preset?.options) return null
  return (
    <div className={styles.options} data-preset-options={preset.id}>
      {preset.options.map((group) => (
        <div key={group.id} className={styles.optionGroup} data-preset-option-group={group.id}>
          <div className={styles.groupLabel}>{group.label}</div>
          <div className={styles.choices}>
            {group.choices.map((choice) => {
              const on = options[group.id] === choice.id
              return (
                <button
                  key={choice.id}
                  type="button"
                  className={on ? `${styles.choice} ${styles.choiceOn}` : styles.choice}
                  data-preset-choice={`${group.id}:${choice.id}`}
                  aria-pressed={on}
                  onClick={() => onPick(group.id, choice.id)}
                >
                  {choice.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
