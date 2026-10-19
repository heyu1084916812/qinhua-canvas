import type { StoryboardLine, StoryboardShot } from './storyboard'

export type DigitalHumanPlan =
  | { ok: true; lines: StoryboardLine[] }
  | { ok: false; reason: string }

/**
 * One digital-human render can only represent one visible person.
 * Multiple lines are allowed only when every line already has audio and all
 * lines resolve to the same declared speaker.
 */
export function digitalHumanPlanOf(shot: StoryboardShot): DigitalHumanPlan {
  if (shot.lines.length === 0) {
    return { ok: false, reason: '这一镜没有台词，数字人口播没有可念的内容' }
  }
  if (shot.lines.some((line) => !line.text.trim())) {
    return { ok: false, reason: '先把这一镜的每句台词写完整' }
  }
  if (shot.lines.some((line) => !line.audioHash)) {
    return { ok: false, reason: '先把这一镜的每句台词都生成配音' }
  }
  if (shot.lines.length === 1) {
    return { ok: true, lines: shot.lines }
  }
  if (shot.lines.some((line) => !line.speakerId?.trim())) {
    return { ok: false, reason: '多句口播需要先给每句标明同一个说话人' }
  }
  const speakerIds = new Set(shot.lines.map((line) => line.speakerId!.trim()))
  if (speakerIds.size !== 1) {
    return {
      ok: false,
      reason: '这一镜有多位说话人；单个数字人无法同时表演多人的口型',
    }
  }
  return { ok: true, lines: shot.lines }
}
