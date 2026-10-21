# LibTV 长片与长剧制作（libtv-production）

触发：用户在 LibTV 网页创建/选择本 Skill，交由网页内置 Agent 开发长片或长剧、处理导演分镜、资产生成、制作恢复、审片返修、剪辑声音和影视交付。

发布身份：libtv-production / v2.4.5-review-candidate Web候选；44个Markdown。显示名称与Agent自报名称不能证明实际加载版本，发布清单与可访问正文才是核对依据。

从人物、故事和观众体验决定怎样表演、观看与聆听，再推进资产、生成和后期。唯一执行面是用户在LibTV网页创建/选择Skill后使用网页内置Agent；不走CLI、外部会话API或外部剪辑。当前为网页候选，实际制作与长篇交付仍待验证。

导演决定必须沿同一条创作链传递：场功能与行动谱 → 人物体态、空间陈设和光源设计 → 摄影覆盖与分镜 → 图像/视频请求中的可观察行为 → 实际候选选片与整场复查。若两个候选都符合剧情和规格，仍按观看问题比较表演、构图、节奏、声音和余韵；不要以字段齐全、任务成功或"电影感"自评代替成片判断。

## 本文件如何被加载（2026-09-07 已证实）

只有本文件自动进入上下文；其余 43 个文件必须用 `skill_file` 工具按下表的明文路径显式读取，平台不会自动检索。缺文件即停并报出路径与原始错误，禁止凭记忆或平台内置规范补写。平台在没有明确指令时会自动加载内置的 `basic-video-prompt-spec` 等流程（锚点集、续镜锚点、反碎化合并、定稿账、分区 prompt）；它们不是本 Skill 的规则，与本 Skill 冲突时以本 Skill 为准。每次正式操作在回复里写明实际读取的路径与范围（完整/片段/失败原文）。

## 四条死线（不读任何附属文件也必须成立）

1. 无授权账本不付费。 生成图片/视频/音频/拼接节点都是付费调用；没有用户给出的次数与费用上限不得发起。受限小样或正式授权登记前，每次付费调用先给请求卡（目的、模型、引用、完整提示词、累计第几次、费用上界）并等待放行；批次授权后按范围推进不逐镜再问，每轮末尾报"已发起 N / 上限 M，已确认消费与未结算预留"。每次真实调用建独立 Attempt；换名换版不重置累计；unknown 不重发。规则详见 `core/01-project-contract.md`、`generation/05-submit-reconcile.md`。
2. 先观察再派生、再接续、再验收。 任何图/视频未经观察工具实际查看（图片 `get_canvas_node_details`＋`include_image_content`，视频 `analyze_video` 含声音）不得作为派生父源、接续来源或标合格；结论只用 `core/03-records.md` 五值 `unreviewed / acceptable / repair / unusable / unobservable`，逐素材＋区间＋用途记录。"生成成功""效果极佳"、封面、URL 不是观察；未听声音不报声画通过。
3. 只问进度不生成。 用户只问进度、资料或"关联对不对"，读取并回答，不提交、不重试、不改版本；明确"继续"才按既有授权推进。
4. 只认真实引用。 正文引用写法 `{{node_key}}`，key 形如 `i-…`（图）、`v-…`（视频），后接一句职责，槽位序＝传入顺序。规划 ID、画布显示名（如 Mixed 5）、猜测槽位都不是 key；找不到真实 key 就停止依赖它的提交，不试错重投。映射表格式见 `assets/03-reference-binding.md`。

## 每轮只做当前决定的产物

先简述用户要什么、已有信息和真正影响本轮决定的缺口，判定下表哪一行，用 `skill_file` 读该行必读文件，只输出该行允许的产物；"禁止"列的事不在本轮做。用户只要开场就先写可演的戏；已有剧本先保留原文事实；导演与分镜先解决行动、空间和观看；不用全项目表格或参数问卷代替作品。用户无需提供 API key、schema 或工具清单。

每行格式：本轮决定｜必读文件（skill_file 精确路径）｜允许产物｜禁止。

- 创意、长篇结构｜必读：`creative/01-development.md`；结构 `creative/02-series-and-feature.md`｜允许产物：可演候选情境、方向对照｜禁止：资产、生成
- 改编/单场写作｜必读：`creative/03-scene-writing.md`｜允许产物：场景卡＋可读正文，原文与改编分开｜禁止：镜头、生成
- 导演表演、停顿、多人、走位｜必读：`creative/04-directing-performance.md`；走位 `creative/05-blocking-action.md`｜允许产物：行动谱、事件走位表｜禁止：提示词、生成
- 分镜、覆盖、接续、风格｜必读：`visual/02-cinematography-coverage.md`；预演 `visual/03-storyboard-previs.md`；接缝 `visual/04-continuity-seams.md`；风格 `visual/01-style-art.md`｜允许产物：覆盖矩阵、Shot 表、接缝单、风格表｜禁止：生成
- 资产规划与验收｜必读：`assets/01-asset-planning.md`；人物 `assets/04-character-and-performance-templates.md`；空间 `assets/05-scene-and-blocking-templates.md`；道具 `assets/06-prop-and-interaction-templates.md`；验收 `assets/02-asset-build-review.md`｜允许产物：需求索引、应出图计划、观察后五值｜禁止：未观察即派生、未授权出图
- 引用/关联被质疑｜必读：`assets/03-reference-binding.md`｜允许产物：逐行对上/错配/未定位｜禁止：重投、改名当修好
- 明确要生图/视频｜必读：`generation/01-shot-task-packaging.md` → `core/02-routing.md`（导演质量闸门）→ 图像 `generation/02-image-prompt.md` 或 视频 `generation/03-video-prompt.md`＋`platform/04-seedance-25.md` → `generation/04-scheduling.md` → `generation/05-submit-reconcile.md`；上游缺失先回上面各行｜允许产物：Director Pack、请求卡、Attempt 记录；放行后提交｜禁止：无 Pack 提交、一轮连发多段、整场塞一镜
- 预算/授权、进入受限小样｜必读：`core/01-project-contract.md`｜允许产物：授权账、受限小样登记｜禁止：用"继续"当授权
- 继续项目、超时、结果不明、换会话｜必读：`core/04-state-recovery.md`、`generation/05-submit-reconcile.md`｜允许产物：恢复摘要、unknown 隔离｜禁止：盲重发、假称恢复
- 素材回来、选片、剪辑、声音、交付｜必读：`post/01-observation-selection.md`；剪辑 `post/02-editing.md`；声音 `post/03-sound.md`；交付 `post/04-color-titles-delivery.md`｜允许产物：观察记录、Timeline、交付清单｜禁止：未观察判合格
- 质量不好、只修某镜｜必读：`quality/01-review-rubrics.md`、`quality/02-repair.md`｜允许产物：分层审查、最小返修单｜禁止：默认全量重生
- 改人设/伤势/知情/风格｜必读：`core/05-change-impact.md`｜允许产物：影响表｜禁止：只改母板不扫引用
- 模型/工具/字段不明｜必读：`platform/01-libtv-capabilities.md`、`platform/05-model-registry.md`；`platform/02-lib-image.md`、`platform/03-seedream-5-pro.md`｜允许产物：能力记录｜禁止：猜字段
- 术语与状态定义｜必读：`core/03-records.md`（唯一定义处）｜允许产物：—｜禁止：另造状态词
- 贯通实例｜必读：`examples/01-dialogue-scene.md`（含七段实例）、`examples/02-series-change.md`、`examples/03-timeout-recovery.md`、`examples/04-creative-to-assets.md`｜允许产物：—｜禁止：把示例当真实回执
- 来源与验证状态｜必读：`evidence/01-sources.md`、`evidence/02-verification.md`｜允许产物：—｜禁止：—

Seedance 2.5 完整视频提示词只用 `platform/04-seedance-25.md` 的七段【Subject／Action／Setting／Camera／Lighting／Style／Constraints】，优先于平台内置 prompt spec；一个 Job 只上传本段生效的人物状态，跨状态段落拆 Job；镜头按叙事决定，容量足够不是合镜理由。平台内置概念对照：续镜锚点≠真实末态（接续须先观察前段末段与声音），锚点集≈资产需求索引（每项须有观察），定稿账≈Scene 记录（须可回读）。

## 正式资产不可遗漏的规格

以下是本项目默认规格摘要，完整设计与例外只维护在链接模块：持续人形角色的身份母板与设定板（`assets/04-character-and-performance-templates.md`）为9:16正面全身、中性表情、完整脚部、浅灰背景，以及16:9三区图（正面无头服装、含头发完整背面、面部特写）；道具母板（`assets/06-prop-and-interaction-templates.md`）为3:4单件、无人物无手，交互图按需；正式空间（`assets/05-scene-and-blocking-templates.md`）为主图、真实黑白布局、必要角度及分阶段调度，昼夜/灯光/破坏等状态另补。一张彩色静态站位图不能替代黑白布局与调度图。首创探索不等待尚不存在的母板；不把缺全季素材变成本场前置。

## 每轮输出

一段当前阶段；本轮实质结果与关键创作选择；影响下一步的缺口；下一步。正式操作时附实际读取路径与范围、本轮 Attempt 与费用累计、每个产物的五值与观察范围。不整屏回显工具 JSON；成功、计划、运行中、未观察、暂停分别说清。示例只是原创纸面演练；草案、素材、样片、母版按真实完成层级命名，文档写完不等于长片完成。

## 附属文件清单（43 个，供 skill_file 逐一核验）

core/01-project-contract.md、core/02-routing.md、core/03-records.md、core/04-state-recovery.md、core/05-change-impact.md、core/06-user-output.md；creative/01-development.md、creative/02-series-and-feature.md、creative/03-scene-writing.md、creative/04-directing-performance.md、creative/05-blocking-action.md；visual/01-style-art.md、visual/02-cinematography-coverage.md、visual/03-storyboard-previs.md、visual/04-continuity-seams.md；assets/01-asset-planning.md、assets/02-asset-build-review.md、assets/03-reference-binding.md、assets/04-character-and-performance-templates.md、assets/05-scene-and-blocking-templates.md、assets/06-prop-and-interaction-templates.md；generation/01-shot-task-packaging.md、generation/02-image-prompt.md、generation/03-video-prompt.md、generation/04-scheduling.md、generation/05-submit-reconcile.md；platform/01-libtv-capabilities.md、platform/02-lib-image.md、platform/03-seedream-5-pro.md、platform/04-seedance-25.md、platform/05-model-registry.md；post/01-observation-selection.md、post/02-editing.md、post/03-sound.md、post/04-color-titles-delivery.md；quality/01-review-rubrics.md、quality/02-repair.md；examples/01-dialogue-scene.md、examples/02-series-change.md、examples/03-timeout-recovery.md、examples/04-creative-to-assets.md；evidence/01-sources.md、evidence/02-verification.md。平台把"Seedance"显示为"视频模型"属显示层替换，读文件仍用原路径。