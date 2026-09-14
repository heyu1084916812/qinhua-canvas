/**
 * comic 词表的中文标签（M6-4）。
 *
 * 与 `comicProject.ts` 的词表常量（`BALLOON_TYPES` / `SHOT_FRAMINGS` / `SHOT_ANGLES` /
 * `PANEL_TRANSITIONS`）是**同一份封闭枚举的两面**：常量给代码遍历，这里给界面显示。
 * 放在 domain 而非 UI 的理由：它们是词表的一部分，跟着词表走才不会漂移；单测断言
 * 「每个词表成员都有非空标签」，词表扩充时忘了补标签会立刻红。
 *
 * 纯数据（`Record<Union, string>`），不含 React / platform（架构 §2.2 domain 纯度约束）。
 */

import type {
  BalloonType,
  PanelRunStatus,
  PanelTransition,
  ShotAngle,
  ShotFraming,
} from './comicProject'

/**
 * 留痕状态（M6-15）。词表来自共享执行词（`RUN_STATUSES`），本表只给它配中文——
 * 于是「成功 / 失败」在版本历史（canvas）与格的留痕（comic）里是同一套说法。
 */
export const PANEL_RUN_STATUS_LABELS: Record<PanelRunStatus, string> = {
  succeeded: '成功',
  failed: '失败',
  canceled: '取消',
  interrupted: '中断',
}

/** 对白类型（ACBF `text-area@type` × CBML 通行叫法） */
export const BALLOON_TYPE_LABELS: Record<BalloonType, string> = {
  speech: '对白',
  thought: '心理',
  narration: '旁白',
  sfx: '拟声',
}

/** 景别 */
export const SHOT_FRAMING_LABELS: Record<ShotFraming, string> = {
  'extreme-wide': '大远景',
  wide: '远景',
  medium: '中景',
  'close-up': '特写',
  'extreme-close-up': '大特写',
}

/** 机位角度 */
export const SHOT_ANGLE_LABELS: Record<ShotAngle, string> = {
  'eye-level': '平视',
  high: '俯视',
  low: '仰视',
  dutch: '斜角',
  'birds-eye': '鸟瞰',
  'worms-eye': '虫视',
}

/** 与上一格的转场（McCloud 六类） */
export const PANEL_TRANSITION_LABELS: Record<PanelTransition, string> = {
  'moment-to-moment': '瞬间到瞬间',
  'action-to-action': '动作到动作',
  'subject-to-subject': '主体到主体',
  'scene-to-scene': '场景到场景',
  'aspect-to-aspect': '方面到方面',
  'non-sequitur': '无关联',
}
