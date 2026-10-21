## name: story-to-screenplay-cn description: Convert Chinese novels, story outlines, character setups, or narrative chapters into concrete Chinese film and short-drama screenplays. Use when the user asks to turn fiction into a script, create or review a movie/short-drama screenplay, produce episode-by-episode Markdown scripts, rewrite abstract prose into shootable action/dialogue, or calibrate a screenplay-generation Skill from examples.

# Story To Screenplay Cn

## Overview

Use this skill to convert Chinese fiction into concrete film or short-drama scripts. The output should be easy for a human production team or AI video workflow to understand: clear episode and scene headings, named action subjects, shootable action, dialogue, VO/OS labels, sound cues, and no invented story elements.

This `SKILL.md` is the single source of truth for the workflow and output rules. Do not rely on separate reference Markdown files.

## Workflow

1. Read the source material closely. Identify characters, locations, timeline, explicit objects, stated actions, conflicts, and plot turns.
2. Do not add props, events, relationships, locations, backstory, emotions, atmosphere, or visual details that are not present in the source unless the user explicitly asks for expansion.
3. Build a concrete scene-by-scene synopsis before writing the script. Each synopsis item must include time, place, named characters, concrete actions, audible information when important, and the scene end-state change.
4. Convert narration into shootable script language: visible actions, audible sounds, direct dialogue, on-screen text, VO/OS, and concrete scene transitions.
5. Output Markdown using the required metadata block and sections below.
6. Self-check every output against the final checklist before delivery.

## Required Markdown Opening

Every screenplay Markdown output must start with this block, filled in from the task or the best source-based inference:

```text
剧名：《》
题材：
画风：真人写实
剧集篇幅：
总集数：
总时长：
```

Do not begin with "转换定位" or any meta explanation. After the metadata, use these sections:

```text
## 旁白与画外音规则
## 人物动作规则
## 一、剧情大纲
## 二、人物小传
## 三、正文
```

## Scene Heading Format

Use this scene heading format:

```text
### 第一集 1-1 上午 内景 地下停车场
### 第一集 1-2 上午 内景 车内
```

The components are: episode, episode-scene number, time, interior/exterior, exact location.

## VO and OS Rules

VO means voice-over:

- `VO1`: present-tense inner voice from a character in the current moment.
- `VO2`: first-person narration from a later time, memory, retrospective explanation, or time-gap commentary.
- `VO3`: omniscient narration for objective facts, time, place, and background.
- `OS`: off-screen voice or off-screen mental activity from a character not visible in the current frame.

Use `系统（OS，机械声）` for system dialogue. The system is an independent invisible speaker, not the protagonist's inner monologue.

Dialogue, VO, and OS can use pronouns such as "我、你、他、她、我们、他们". Non-dialogue action and image descriptions should use names or explicit subjects.

## Dialogue Delivery Guidance

Short words in parentheses before dialogue are delivery guidance, not VO/OS psychology. They tell the actor how to deliver the line.

Examples:

```text
秦泽（有气无力）：知道了知道了。
梅长红（冷冷地）：我们有你的履历。
秦泽（故意）：俄文底蕴不深，确实看不出作者内涵的讽刺之意。
```

Use delivery guidance only when the source implies tone or performance. Keep it short.

## Action, Image, and Sound Labels

Use `Δ` only for actions with a clear subject:

- Character body action.
- Character expression change.
- Camera movement such as push, pull, pan, track.
- Visual change caused by a clear subject.

Do not use `Δ` for:

- Static scene description.
- Environment description.
- Sound-only description.
- Sunlight, atmosphere, or any subjectless state.

Use `【画面】` for static image, environment, atmosphere, and subjectless visible state.

Use `【音效】` for sound cues when sound itself matters. Sound should have a source, a change, or a dramatic function.

Example:

```text
【画面】阳光透过纱窗照进卧室。窗外传来车辆快速驶过的声音。
【画面】敲门声持续响起。
Δ 秦泽躺在床上睁开眼。一只手按住太阳穴，另一只手撑住床面。
【画面】敲门声继续。
```

## No-Invention Rule

Only convert source information. Do not add props, locations, extra characters, relationships, emotions, backstory, atmosphere, or visual details that are not supported by the source.

If the source lacks a detail, leave it out or write only what is known. Do not improve a scene by inventing objects, facial reactions, gestures, sound, or camera movement.

## Concrete Language Rule

Avoid vague action adverbs or abstract expression labels such as "猛地、忽然、突然、似乎、像是、感觉、情绪蔓延、心里发慌".

Prefer observable action:

```text
秦泽抬头速度很快，先看卧室门，再看窗边。
士兵甲后退半步，右手按住弹匣，左手连续两次没有扣上弹匣卡扣。
```

## Information Density Rule

Do not dump key information as exposition. Embed facts into:

- Current character action.
- Object state.
- Dialogue.
- On-screen text.
- Broadcast, intercom, phone, or radio.
- Environment residue.
- Sound cues.

Example:

```text
Δ 秦宝宝从手包里抽出五张百元钞票，放在桌上。
秦宝宝：省着点花。我新工作基本工资只有三千。
```

Because this is dialogue, first-person "我" is correct. Do not change it to "秦宝宝" inside dialogue unless the source character speaks that way.

## Sound Storytelling Rule

When danger, pressure, relationship change, secrecy, or surprise can be expressed through sound, use sound as narrative information.

Sound should not be decorative. It should have:

- Source: what creates the sound.
- Change: how it grows, stops, repeats, or shifts.
- Function: what it reveals or pressures the scene to do.

Examples:

```text
【音效】门外钥匙插进锁孔，停了两秒，又拔出去。
【音效】手机震动三次，屏幕亮起。
【音效】楼道脚步声从远到近，在门口停下。
```

## Change Progression Rule

Do not require every genre to have "crisis escalation". Mature scenes need a perceivable change progression, which varies by genre:

- War/action: danger escalation.
- Romance: relationship shift.
- Comedy: misunderstanding escalation.
- Mystery: clue progression.
- Short-drama "爽点": humiliation, reveal, reversal, or face-slap escalation.
- Family drama: pressure or conflict escalation.

Each scene should leave the situation different from how it began.

## Driving Force Rule

Every scene should clarify:

- Who wants what.
- What blocks the character.
- What failure costs.
- What changes by the end.

This is more universal than "pressure" or "crisis". Pressure is only one kind of driving force.

## Synopsis Rules

The synopsis is not a literary summary. It is a concrete scene blueprint.

Each item should include:

- Time.
- Location.
- Named characters.
- Visible actions.
- Audible information when important.
- End-state change.

Avoid "熟悉、撒娇、抢食、关系很好、经济压力变大" as standalone summaries. Convert them into action and dialogue.

## Review Mode

When comparing two scripts or reviewing a user-provided script, judge it by:

- Fidelity to source material.
- Concrete, shootable action.
- Clear scene and episode structure.
- Correct VO/OS and action/image labeling.
- Information density embedded into action, objects, dialogue, screens, broadcasts, intercoms, environment residue, or sound.
- Scene-level driving force: character goal, obstacle, cost of failure, and end-state change.
- Whether sound is used narratively with a source, change, and dramatic function.

## Final Self-Check

Before delivery, scan for:

- Unsupported invented objects or details.
- `Δ` used on subjectless environment or sound.
- Missing scene time/location.
- Non-dialogue pronouns where a name is clearer.
- System incorrectly marked as VO.
- Dialogue unnaturally rewritten to avoid pronouns.
- Abstract emotions that should be visible action or sound.