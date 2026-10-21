---

## name: papercraft-animation-guide description: 引导用户创作 15–30 秒“分层纸艺”动画的skill。适用于用户想把主题、故事、产品、角色或场景做成平整卡纸/剪纸叠层、微缩剧场、定格动画质感短片时；第一步先生成主体资产包：角色三视图、场景三方向参考、道具参考，经确认后再设计 15/30 秒分镜、提示词、视频生成与合成。明确避免波楞纸/瓦楞纸外观。

# Papercraft Animation Guide

## Overview

该 skill 用于把用户的主题或故事引导成 15–30 秒**分层纸艺动画**。新版流程先生成主体资产包，锁定角色、场景、道具的一致性；用户确认资产后，再进入分镜节奏、镜头提示词、视频生成和合成。风格应是平整剪纸/卡纸叠层，不是波楞纸、瓦楞纸或纸箱粗糙纹理。

## Trigger and Scope

使用场景：

- 用户想做“纸艺风格动画”“剪纸动画”“分层卡纸动画”“立体书风格视频”“微缩纸艺剧场”短片。
- 用户提供主题、角色、产品、故事、参考视频/图片，想做 15–30 秒纸艺动画。
- 用户希望先建立角色/场景/道具资产，再保持主体一致性生成动画。

不适用：

- 纯写实视频、真人口播剪辑、普通产品广告剪辑、非纸艺风格动画。
- 只想生成单张图且不需要动画分镜时，可改为单图资产设计任务。

## Style Source

执行时先读取 `references/style_guide.md`，严格围绕“平整分层纸艺、手工剪纸、薄卡纸厚度、层间投影、微缩剧场、微距视差、定格动画质感”设计。

重点风格边界：

- 使用 smooth flat cardstock / layered paper cutout / matte paper sheets。
- 避免 corrugated cardboard / ribbed cardboard / wavy cardboard / shipping box texture。
- 不要把画面做成粗糙纸箱、瓦楞纸截面或条纹波纹纸。

## Workflow

### 1. Clarify brief and asset needs

用最少问题补齐：

- 动画主题/故事/产品/角色是什么？
- 目标时长：默认 15 秒，可扩展到 30 秒。
- 画幅比例：默认 16:9；可选 9:16、1:1。
- 是否需要旁白、字幕、音乐或音效？默认只做画面方案，不自动加旁白。
- 是否有参考图/视频/品牌素材；如有先分析参考素材。

如果用户只给一个主题，直接按默认 15 秒五镜头结构生成首版资产需求和方案，不要过度追问。

### 2. Asset pack first

在设计最终动画镜头前，先生成或规划主体资产包。资产包包含：

1. **角色资产**：角色三视图。
   - 正面视图；
   - 侧面视图；
   - 背面视图。
2. **场景资产**：场景三方向参考。
   - 正面场景；
   - 正面基础上调转 90° 的侧向场景；
   - 正面基础上调转 180° 的背向场景。
3. **道具资产**：关键道具参考图。
   - 单独展示形状、颜色、材质、纸艺层次；
   - 如有多个道具，做成清晰的道具参考组。

资产提示词应强调：平整分层纸片、薄卡纸、剪纸边缘、哑光纸面、层间阴影；禁止波楞纸/瓦楞纸纹理。

先向用户展示资产设计方案或资产预览，并确认后再进入动画分镜。

### 3. Build the papercraft creative plan

资产确认后，输出可确认的动画方案，包含：

- 一句话创意核心。
- 已锁定的角色/场景/道具资产说明。
- 核心纸艺风格关键词。
- 15 秒或 30 秒镜头分镜节奏。
- 每个镜头的画面内容、动作、镜头运动、纸艺材质重点、时长。
- 每个镜头的生成提示词，明确引用已确认资产。
- 全片负面提示词。
- 需要用户确认的风险点：品牌/IP、人物肖像、文字内容、产品准确性等。

### 4. 15-second storyboard rhythm

默认 15 秒结构为 5 镜头：

1. 0–3 秒：建立纸艺世界。展示已确认场景正面与主体，轻微推近或平移制造视差。
2. 3–6 秒：主体动作。角色/物体开始运动，引用角色三视图保持一致。
3. 6–9 秒：视差推进。镜头穿过前景纸片或横向平移，展示场景 90°/多方向资产带来的空间层次。
4. 9–12 秒：情绪/转折特写。给主体或关键道具特写，强化纸张纹理、剪纸边缘和层间阴影。
5. 12–15 秒：收束定格。回到完整构图或标志性画面，形成可截图的定格结尾。

### 5. 30-second expansion rhythm

30 秒版本建议扩展为 8–10 镜头：

- 0–4 秒：开场世界观；
- 4–8 秒：主体登场；
- 8–12 秒：第一次动作推进；
- 12–16 秒：空间视差展示；
- 16–20 秒：冲突/变化；
- 20–24 秒：情绪/产品/主题特写；
- 24–28 秒：结果或转场收束；
- 28–30 秒：定格结尾。

### 6. Prompt writing rules

每个镜头提示词都应包含：

- 风格核心：3D layered papercraft, handcrafted paper cut art, smooth flat cardstock layers, pop-up book, miniature diorama theater。
- 主体与动作。
- 已确认资产引用：same character as the front/side/back reference sheet, same scene as the front/90-degree/180-degree environment reference。
- 前景/中景/背景层次。
- 材质：visible matte paper texture, hand-cut edges, thin cardstock thickness, flat paper sheets。
- 光影：strong drop shadows between layers, studio soft lighting。
- 镜头：macro photography, subtle push-in/pan, parallax depth effect。
- 动画：stop-motion animation, low frame rate, slightly jumpy handmade movement。

负面提示词必须包含：corrugated cardboard, ribbed cardboard, wavy cardboard, cardboard box texture, rough shipping box, exposed corrugated edge, photorealistic, smooth plastic 3D, metallic, cluttered background, high frame rate smooth animation。

### 7. Confirmation points

必须确认两次：

1. **资产确认**：角色三视图、场景三方向、道具参考确认后，才能继续。
2. **分镜确认**：完整动画方案确认后，才能生成视频。

确认卡建议选项：

- “确认资产，继续分镜”
- “修改角色资产”
- “修改场景资产”
- “修改道具资产”
- “确认生成动画”
- “修改分镜节奏”
- “改为 30 秒”
- “修改画幅比例”

### 8. Production after confirmation

用户确认后：

1. 先批量生成资产图或资产预览。
2. 资产确认后，批量生成关键画面或视频片段。
3. 保持所有镜头的角色、场景、道具一致，避免每镜头主体漂移。
4. 如需合成多段视频，加载 `capcut-render` skill 并按当前渲染能力合成。
5. 默认不添加字幕、旁白或音乐，除非用户明确要求。
6. 渲染后检查：时长、画幅、资产一致性、是否保持分层纸艺、是否出现波楞纸/瓦楞纸。
7. 只交付最终视频，除非用户要求同时交付资产包、分镜方案或提示词包。

## Failure Handling

- 主体不一致：回到资产阶段，生成或修正角色三视图/道具参考，再继续镜头生成。
- 画面像波楞纸/瓦楞纸：加入负面提示 corrugated cardboard, ribbed cardboard, wavy cardboard, cardboard box texture，并强调 smooth flat cardstock layers。
- 风格漂移成普通 3D：加强 matte paper texture、hand-cut edges、thin cardstock thickness、drop shadows、stop-motion low frame rate。
- 画面太扁平：强调多层前中后景和层间投影。
- 动画太丝滑：增加 low frame rate、slightly jumpy handmade movement、stop-motion。
- 生成涉及品牌、名人、IP：提醒用户改成原创角色/泛化主题或提供授权素材。

## Acceptance Criteria

成功结果应满足：

- 第一阶段先产出角色、场景、道具资产设计或资产预览。
- 角色包含正面、侧面、背面三视图。
- 场景包含正面、90°、180° 三方向参考。
- 道具参考清晰，能支撑后续镜头一致性。
- 方案清楚说明 15 秒或 30 秒镜头节奏。
- 每个镜头都有纸艺专属提示词，并引用已确认资产。
- 风格是平整分层纸艺，不是波楞纸/瓦楞纸。
- 视频生成前已让用户确认资产和分镜。
- 成片不应像写实摄影、塑料 3D、普通卡通或粗糙纸箱材质。