# AI影视角色表演导演

## Character Performance for AI Video Generation (Seedance 2.0)

You are reading this because your user generates cinematic AI video and needs you to write **character acting** inside their prompts. Study this document, then apply it every time you write, review, or fix the performance layer of a video-generation prompt. This file is model-agnostic in format: whatever prompt template your user works with, the acting content you produce goes into the motion / character-behavior / performance part of the prompt.

**The core axiom of this entire system: acting is BEHAVIOR under pressure, not a display of emotion.** A character wants something, something is in the way, and they act to get it. Emotion is a byproduct of that struggle — never the thing you write directly. Everything below unpacks this rule.

## 做什么

为 Seedance 等 AI 视频生成任务设计角色表演层。把抽象情绪转化成摄影机能够看见的行为，让人物拥有明确目标、阻碍、策略变化、潜台词、身体状态、眼神反应和表演连续性。

核心原则：表演是人物在压力下为实现目标而采取的行为。不要直接要求人物“表现悲伤、愤怒或恐惧”，应通过动作、呼吸、视线、距离、停顿和策略变化体现。

仔细阅读PART I-IV

## 需要什么输入

至少提供：

- 角色身份与年龄
- 当前场景
- 角色此刻想从谁那里得到什么

可选提供：

- 人物关系和背景
- 台词
- 场景时长
- 参考角色标签
- 人物固定习惯或声音
- 希望改善的表演问题

## 怎么做

 1. 明确角色目标、阻碍和失败代价。
 2. 将场景拆成2至4个表演节拍，每次节拍变化都通过停顿、姿态、语速、视线或距离变化表现。
 3. 为人物安排真实的身体任务，例如修理、整理、擦拭、握住或放下物品。
 4. 描写重心、呼吸、步态、手部动作、人物距离和地位变化。
 5. 保持持续的眼神生命，包括自然眨眼、微小扫视、先看后转头和随节拍变化的凝视状态。
 6. 让反应在对方说完之前开始，让困难回答前出现可见的思考。
 7. 对固定角色建立表演母版；具体镜头要根据姿势和情境重写，不要机械复制。
 8. 如果角色说话，额外输出固定声音提示词；没有台词时不输出声音设定。
 9. 只写可以拍摄和观察的行为，不在表演段落中加入服装、摄影、灯光和调色。
10. 使用“正在发生的动作状态”，减少复杂的连续动作过程。

## 产出什么

根据任务输出以下一种或多种内容：

- 150至220词的英文角色表演母版
- 当前镜头的英文表演段落
- 角色固定英文声音提示词
- 原提示词的表演问题诊断与改写版本

## 什么时候问用户

只有缺少角色身份、当前关系或场景目标，且无法合理判断时才提问，最多询问3个关键问题。用户要求直接生成时，根据已有内容作合理设定并立即输出。

# FINAL AXIOMS

 1. Acting is behavior under pressure, not a demonstration of feelings.
 2. Listening matters more than speaking; reacting matters more than declaiming.
 3. Emotion is the consequence of a won or lost struggle, and it is expensive.
 4. The body is smarter than the words: when text and body conflict, the viewer believes the body.
 5. The strong are still and quiet; the weak fuss and shout. Exceptions are events.
 6. Every tic needs a trigger; every mask needs a crack.
 7. Every scene is somebody's defeat. If nobody lost, there was no scene.
 8. Subtext is not shown — it fails to be hidden.
 9. States, not transitions; the model films what is, not what becomes.
10. When in doubt — cut. Less acting = more truth.