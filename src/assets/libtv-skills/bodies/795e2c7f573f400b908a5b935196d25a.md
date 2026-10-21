---

## name: ai-visual-storyboard-compiler description: | LibTV 专用媒体创作工作流。将故事、剧本、场景、动作、角色互动、参考素材意图或已有视频提示词，编译为可审核、可引用、可生成的分镜到成片流程。用于多镜头、剧情、参考资产、连续性或需调用 LibTV 图片、音频、视频工具的任务；在视频生成前强制执行创作确认、资产审核、正式分镜审核、深度故事板审核、连续性和节点闭合。不得绕过门禁直接生成媒体。 trigger-words: \[分镜编译, 制作清单, 创作确认清单, 视觉控制包, 生成分镜视频, Seedance提示词, 视频提示词, 图生视频提示词, 多镜头拆解, 逐镜调试, storyboard prompt, shot prompt\]

# AI 视觉分镜编译器

`SKILL.md` 仅定义 LibTV Agent 的执行入口、全局门禁、流程状态和文件路由；深度故事板与视频 Promote 的唯一规范位于 `references/prompt-assembly.md`，视觉资产、特效与去噪的唯一规范位于 `references/reference-visual-assets.md`。本 Skill 不依赖外置 yml 入口文件。

## 1. P0 强制加载

每次触发后，必须逐个调用 `skill_file` 完整读取以下 19 个 Markdown 文件；只读取摘要、文件为空或任一读取失败均视为未完成。P0 未完成时，禁止创作、资产生成、分镜、审核、深度故事板、视频生成和 Promote。

 1. `SKILL.md`
 2. `references/full-system.md`
 3. `references/core-rules.md`
 4. `references/production-list.md`
 5. `references/reference-visual-assets.md`
 6. `references/reference-audio-processing.md`
 7. `references/continuity-bridge.md`
 8. `references/style-rules.md`
 9. `references/templates.md`
10. `references/writing-rules.md`
11. `references/prompt-assembly.md`
12. `references/checks-state.md`
13. `references/library-visual.md`
14. `references/library-motion.md`
15. `references/library-blocking.md`
16. `references/library-angle-focus-edit.md`
17. `references/library-audio-emotion.md`
18. `references/examples-maintenance.md`
19. `references/test-cases.md`

P0 后输出读取确认表：文件路径、已读取/失败、失败原因。任一项不通过时，立即输出：

```text
Skill 启动阻断：
- 已读取文件数：X / 19
- 缺失文件：...
- 阻断原因：未完整加载 Skill 运行上下文
- 下一步：继续调用 skill_file 读取缺失文件，不得进入创作或生成。
```

## 2. 边界

触发：故事、剧本、场景、动作、角色互动、参考素材、多镜头视频、已有分镜或视频提示词的编译、审核、修改和生成。

不触发：单张图、无剧情的单段图生视频、纯剪辑/字幕/配乐、纯歌曲、纯剧本写作。

只按本 Skill 和其 references 执行。用户只要文本时停在文本阶段；用户要求资产或视频时仍必须通过所有已到达的硬门禁。

## 3. 全局流程

 1. `P0_forced_file_load`
 2. `intake`
 3. `creation_checklist`
 4. `asset_plan`
 5. `timeline_reorganization`
 6. `asset_list_partition`
 7. `P0_palette`
 8. `P1_character_scene_audio`
 9. `P2_props_variants`
10. `P3_states_expressions`
11. `P4_keyframes`
12. `formal_storyboard_batches`
13. `formal_storyboard_scope_review`
14. `continuity_planning`
15. `derived_reference_asset_check`
16. `derived_reference_asset_generation_review`
17. `reference_completion_review`
18. `continuity_protocol`
19. `pre_promote_split`
20. `depth_storyboard_compile`
21. `depth_storyboard_structure_review`
22. `depth_storyboard_semantic_review`
23. `video_promote_and_generation`
24. `regeneration_update`

除 P0 外，每个阶段前都必须确认 P0 已完整通过。`本次生产范围`指用户本轮要求完成并进入生成的全部正式分镜；用户明确只调试或只生成一个镜头时，该镜才可构成完整范围。范围内任一正式分镜未生成、未通过或待修改时，禁止进入深度故事板和视频阶段。阶段细则、输入输出、字段模板和失败处理以对应 references 为准。

## 4. 深度故事板与视频 Promote 硬门禁

- 每个 `generate_video_v3` 视频单元必须先生成一张状态为 `passed` 的 `@深度故事板_镜号_九宫格`；`passed` 同时要求原文保真、结构/深度审核和正式分镜语义合规审核通过。无当前有效 nodeKey、任一审核未通过、已失效或缺少审核记录时，阻断视频生成。
- 深度故事板编译的全局前置：本次生产范围内全部正式分镜已审核闭合；必须先逐镜、逐相邻制作镜完成“全范围视觉参考完整性复查（静态阶段）”，补齐并审核通过所需角色/场景变体/道具/表情/特效/关键状态/连续性参考图，运行时依赖已写入制作顺序；不得在任一分镜批次结束后直接进入故事板或视频。
- 深度故事板生成包与视频 Promote 的提示词、参数、允许引用和审核标准，以 `references/prompt-assembly.md` 为唯一准则；不得自由改写，也不得由其他流程覆盖。
- 深度故事板生成前必须从当前有效正式分镜建立“深度字段原文副本”；保留字段标题、顺序、行/表结构和字段值，禁止压缩、转述、合并或重排。字段完整性比对未通过时，阻断故事板生成。
- 视频必须引用审核通过的深度故事板和本镜色板。视频 Prompt 先写一句话总结；人物、道具、场景等实际引用资产必须在 Prompt 内写明各自定义、空间位置和朝向。除连续延长镜的前 2 秒外，深度故事板是时间线、相机、过程和镜头的最高优先级视觉依据；视频 Prompt 不得重设计其动作，也不得把灰度九宫格渲染为成片画面。
- 有台词时，实际发声角色的 3–4 秒音色节点必须进入视频 `reference_nodes`，并紧邻其台词行前插入 `{{音色nodeKey}}`。
- 连续延长镜中，尾部 2 秒视频仅允许进入本次视频层的 `reference_nodes`：前 2 秒完整继承该视频；深度故事板只编译第 2 秒后的控制段，并从 P1 到 P9 严格主控该段。若故事板需承接画面，必须先抽取尾帧并作为图像参考；不得依赖未在本次调用传入的其他镜头或系统状态。
- 连续性先判定“是否必须承接”，再决定媒体执行方式。同场景且时间连续的多点位镜头不得独立生成，必须使用场景连续参考；共同运动/状态、明确出入画方向或前镜结果决定后镜起幅时，分别升级为尾部延长、首尾帧、派生起幅或方向连续参考。既有已通过场景/状态图能充分承接时可直接复用，否则在静态复查中补生成；不得以建立镜头、景别/机位变化、静止摄影机、节奏对比或“独立展示单元”为由降级。
- 任何正式分镜、参考资产、空间方位/朝向或连续性方案更新，都会使依赖的深度故事板变为 `needs revision`；按旧故事板生成的视频必须标记 `deprecated`。
- 色板和深度故事板只审核、不去噪。普通参考图必须先初审，再按已确认的去噪选项决定是否去噪并终审；连续性关键图（截取尾帧、生成的关键帧、派生起幅图）初审通过后必须去噪并终审。具体资产规则以 `references/reference-visual-assets.md` 与 `references/continuity-bridge.md` 为准。
- 全自动审核不豁免硬校验。节点必须在 LibTV 文档层和 Agent 工具层正确闭合。

## 5. 路由与文件契约

路由必读文件启动、制作清单、调度`core-rules.md`、`production-list.md`资产、色板、深度故事板`reference-visual-assets.md`、`style-rules.md`、`library-visual.md`台词、音色、声音`reference-audio-processing.md`、`library-audio-emotion.md`正式分镜与复杂调度`templates.md`、`writing-rules.md`、`checks-state.md`、相关资料库连续性`continuity-bridge.md`、`production-list.md`视频 Promote`prompt-assembly.md`、`production-list.md`、`continuity-bridge.md`、`reference-audio-processing.md`维护与回归`examples-maintenance.md`、`test-cases.md`

`full-system.md` 只作索引；`checks-state.md` 定义错误和状态；库文件只提供词典与技法，不得将模块名、模板名、评级或降级方案写入最终 Prompt。

## 6. 全局边界

不得跳过：P0、制作清单、创作确认、素材确认、适用的去噪审核、分镜审核、逻辑断裂修正、参考完整性复查、连续性判定、深度故事板生成与审核、视频 Promote 预检。

正式分镜正文只写可生成内容；警告、时长核算、评级和管理状态置于外部审核区。未确认素材不得伪造 `@图_`、`@音_`、`@视频_` 或 nodeKey。声音默认开启；无 BGM、无后期字幕。默认视频模型为 `Seedance 2.0`，默认 `resolution: 720p`。

## 7. 维护

修改流程、路由或文件契约时同步更新本文件和对应 references；随后审计 P0 数量、深度故事板/视频 Prompt、色板隔离、音色节点、连续性、节点闭合、测试用例和文件大小，并同步运行时与备份副本。