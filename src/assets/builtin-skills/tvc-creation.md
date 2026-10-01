---
name: "TVC 商业广告视频创作流程"
inputMode: any
tags: [即梦, 视频, TVC]
description: "TVC（商业广告视频）创作流程。当用户想创建、规划或推进 TVC / 广告片 / 商业视频创作，需要从 Brief 到成片的分阶段产出脚本、分镜、镜头、成片时使用；不用于单张图 / 单段视频的一次性生成，也不用于与广告视频创作无关的任务。"
---

# TVC 创作流程

本 skill 帮助创作者把 TVC（商业广告视频）创作拆解为可执行、可追溯的分阶段流程，从 Brief 一路推进到可合成的成片。

## 何时用 / 何时不用

**用**：创作者想创建 / 规划 / 推进 TVC、广告片、商业视频创作；想按流程一步步产出脚本、分镜、镜头、成片。

**不用**：单次生成一张图 / 一段视频（直接用对应生成能力）；与广告视频创作无关的操作。

## 前置与依赖

- **运行环境须提供创作能力**：产出与修改文本；生成图片 / 视频（视频自带声音：对白、音效、环境音、音乐），并可基于已生成成功的图片建立可复用的一致性主体；把多段素材合成为一条成片；查询已产出内容与生成状态；发起生成。具体如何承载这些产物（对话直出、可视化编排等）、以及接口、字段、数量与时长上限，均以运行环境为准。
- 各阶段详细操作：见 `references/*.md`，执行到该阶段时再读取。
- **prompt 说明书 + 词库**（生成画面/视频时查阅）：写图片 prompt 看 [references/prompt-guide-image.md](references/prompt-guide-image.md)，写视频 prompt 看 [references/prompt-guide-video.md](references/prompt-guide-video.md)；两者引用同在 `references/` 下的 `prompt-*` 词库（shot / lens / light / material / camera-move / scenes / style）。

## 工作流（阶段总览）

按顺序推进，每阶段达到验收门槛才进入下一阶段。创作者仅需某一阶段时，聚焦该阶段。

1. **Brief 需求对齐** → 产出文本。详见 [references/stage-brief.md](references/stage-brief.md)。
2. **Concept 创意策划** → 文本 + moodboard 概念主视觉（一张宫格图；写法见 prompt-guide-image）。详见 [references/stage-concept.md](references/stage-concept.md)。
3. **Script 分镜脚本** → 文本，一步到位出分镜脚本表。详见 [references/stage-script.md](references/stage-script.md)。
4. **Subject 主体资产** → 一致性主体，为跨镜头对象保持一致。详见 [references/stage-subject.md](references/stage-subject.md)。
5. **Storyboard 分镜关键帧** → 图片故事板，把分镜脚本可视化供创作者审阅（可按组拼成宫格图省成本；**仅供审阅，不参与视频生成**）。详见 [references/stage-storyboard.md](references/stage-storyboard.md)。
6. **Production 镜头生成** → 视频（多模态参考生成，**以主体资产为参考**、配 prompt 描述；画面/运镜依据分镜脚本；写法见 prompt-guide-video）。声音（对白、音效、环境音、音乐）随视频生成时直出，写进视频 prompt。生成前按分镜脚本「与前镜关系」把镜头打包成**生成单元**（一次生成，4–15s，可含多镜头）逐单元生成。详见 [references/stage-production.md](references/stage-production.md)。
7. **Assembly 合成编排** → 把生成单元视频按顺序合成为一条完整成片（声音随视频自带）。成片即为最终交付物。详见 [references/stage-assembly.md](references/stage-assembly.md)。

> 各阶段 L2 级操作（字段模板、验收门槛、操作要点）逐步补充到 `references/*.md`，避免本文件膨胀。

## 规则与约束

- **对话选择，再定稿**：候选、方案、待选项先在对话中呈现供创作者选择，选定/确认后才作为定稿产出；定稿只承载确定的产物，不堆放草稿。客观事实（如原始信息）可直接产出。
- **创建与生成分离**：图片/视频准备好后不自动生成，须显式发起生成；彼此独立、又都已就绪的生成一次性并行发起，成功即告知，不主动轮询。
- **引用关系显式化**：镜头引用主体（角色/产品）时，把对应主体资产作为该次生成的参考输入一起提供，并在 prompt 里用自然语言点名到具体对象（如「主角」「核心产品」），让模型对上谁是谁，确保形象一致。参考输入只放已成功产出的真实素材；自建主体与用户提供的参考主体都据实提供。
- **改文本用读回覆写**：若无行级修改能力，改文本先读回全文，再整段覆盖重写，改动处以外正文逐字保持原样。
- **状态可追溯**：批量生成后查询汇总进度，对失败项查因再处理；不对同一批连续轮询。
- **可追溯依据**：记住每次产出（供后续阶段引用），保持各阶段产物可回溯。
- **善用外部输入**：创作者上传的附件（图片/视频/文档如 PDF/DOCX）可直接被 Agent 读取，用于归纳需求或作创作参考。

## 产出规范

- 面向创作者，表述清晰、专业；创作内容（文案、脚本）契合 Brief 的调性要求。
- 每阶段交付物明确，含目标 / 关键动作 / 交付物 / 验收标准。
- 最终产出为一套可复现、可追溯的创作流程与可合成的成片。
