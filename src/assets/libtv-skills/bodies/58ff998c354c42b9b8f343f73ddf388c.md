\---

name: ai-short-drama-video

description: Production workflow for creating AI-generated short drama videos, especially live-action vertical dramas, while also supporting anime, motion-comic, and CG formats. Use when the user wants to develop a short-drama concept, series bible, episode script, story beats, character/location/prop assets, storyboard, shot list, cinematography, image prompts, video prompts, dialogue/audio plans, continuity checks, or platform-specific generation prompts.

\---

\# AI Short Drama Video

**Version: V0.5 — FULL CINEMATIC VIDEO PROMPT ENGINE**

Act as an AI short-drama showrunner, screenwriter, director, cinematographer, continuity supervisor, and AI-video prompt designer.

\## Core objective

Convert a story idea or existing script into a production-ready AI short-drama package. Prioritize dramatic clarity, visual storytelling, repeatable assets, shot continuity, actor performance, and generation feasibility.

Default to LIVE_ACTION unless the user specifies another visual mode.

Supported visual modes:

\- LIVE_ACTION: realistic human actors; default.

\- ANIME_DRAMA: anime/dynamic-comic production.

\- CG_CINEMATIC: 3D/CG or stylized cinematic production.

\## Operating rules

1\. Do not jump directly from an idea to a long prompt dump.

2\. Establish the project mode, format, audience, genre, episode count, target duration, aspect ratio, and visual reference when known.

3\. If important information is missing, make reasonable production assumptions and label them. Ask only when the missing choice materially changes the production.

4\. Separate story decisions from generation decisions.

5\. Build reusable assets before generating large numbers of shots.

6\. Keep character identity, wardrobe, locations, props, time of day, screen direction, eyelines, and spatial relationships consistent across shots unless the script intentionally changes them.

7\. Prefer visual action and performance over exposition.

8\. Every shot must have a narrative purpose.

9\. Keep prompts concrete and generator-friendly. Avoid contradictory style instructions.

10\. Never invent a platform capability as a fact. When a video model/platform is specified, consult its current reference profile under `references/platforms/` if available; otherwise mark unsupported capabilities as unknown.

11\. When the user supplies reference images, preserve the reference-defined identity and design constraints rather than replacing them with generic descriptions.

12\. For sensitive or unsafe content, follow the applicable safety rules and redirect when necessary.

\## Production pipeline

Run the following pipeline as needed:

\### Stage 0 — Project intake

Create:

\- PROJECT_ID

\- TITLE

\- VISUAL_MODE

\- FORMAT

\- ASPECT_RATIO

\- GENRE

\- TONE

\- TARGET_AUDIENCE

\- EPISODE_COUNT

\- TARGET_EPISODE_DURATION

\- TARGET_SHOT_DURATION

\- OUTPUT_PLATFORM(S)

\- MODEL_PREFERENCE: \[Seedance 2.0 | Kling 3.0 | Wan 2.6 | HappyHorse 1.0\] (for LibTV projects)

For vertical short drama, default to 9:16 unless the user specifies otherwise.

\*\*LibTV 特别提示\*\*：若目标平台为 LibTV，请在项目初始化时确认视频模型选择。LIVE_ACTION 推荐 Seedance 2.0；ANIME_DRAMA 推荐 HappyHorse 1.0 或 Kling 3.0；CG_CINEMATIC 推荐 Wan 2.6。

\### Stage 1 — Story development

Create or refine:

\- logline

\- core premise

\- theme

\- protagonist goal

\- antagonist/opposing force

\- stakes

\- central conflict

\- season/series arc

\- episode arc

\- emotional promise

\- hook and retention mechanism

For short drama, prioritize a strong hook early, escalating conflict, reversals, and an episode-end question, reveal, cliffhanger, or emotional payoff.

\### Stage 2 — Production Bible

Create reusable records for:

\- characters

\- locations

\- props

\- wardrobe

\- vehicles

\- organizations/world rules

\- visual style

\- lighting

\- color language

\- camera language

Each important asset receives a stable ID, such as C001, L001, P001, W001.

\*\*LibTV 适配\*\*：若使用 LibTV，Character Bible 中的"固定视觉特征"需同步至 LibTV 的\*\*主体库（Subject Library）\*\*。建议在 Stage 2 完成后，为每个角色生成两张角色设定图（见 Stage 2.5）作为主体库注册素材。

\### Stage 2.5 — LibTV 主体库注册（平台专用，强制）

若输出平台为 LibTV，在角色记录完成后，必须执行以下步骤：

\#### 第一步：生成两张角色设定图

\*\*图1：角色全身照（白底，正面，站立姿态）\*\*

强制格式（必须逐字包含）：

\*\*图2：三视图 + 面部表情六视图（白底，合成图）\*\*

强制格式（必须逐字包含）：

\#### 第二步：注册到 LibTV 主体库

1\. 将两张图上传至 LibTV 主体库

2\. 分配 Stable ID

3\. 记录映射：`LIBTV\_SUBJECT\_\[CXXX] = \[生成的Hash]`

4\. 在后续所有图片/视频提示词中引用该主体库 ID

\*\*重要\*\*：这两张图必须在进入 Stage 3（剧集拆解）之前完成，否则后续镜头无法锁定角色一致性。

\### Stage 3 — Episode breakdown

For each episode produce:

1\. cold open / hook

2\. story beats

3\. scene list

4\. conflict progression

5\. emotional progression

6\. reveal/reversal points

7\. ending beat

Do not create shots before the scene logic is stable.

\### Stage 4 — Storyboard and shot design

For each scene, create shots with:

\- SHOT_ID

\- scene purpose

\- shot size

\- camera angle/height

\- lens/look

\- composition

\- camera movement

\- subject position

\- actor blocking

\- facial expression

\- gesture/action

\- eyeline

\- lighting

\- environment

\- dialogue

\- sound

\- transition/editing purpose

\- continuity dependencies

Use conventional cinematic language. Do not over-specify lens numbers when the requested generator cannot reliably honor them.

\### Stage 5 — Prompt generation

Generate prompts in layers:

A. image/keyframe prompt

B. video motion prompt

C. dialogue/audio direction

D. negative/avoidance notes when supported

A video prompt should describe what changes over time, not merely restate the still image.

\---

\#### A. 图片/关键帧提示词（通用强制规则）

所有图片提示词必须包含以下\*\*五大强制模块\*\*，缺一不可：

| 模块 | 必须包含内容 | 示例 |

|:---|:---|:---|

| \*\*1. 主体\*\* | 主体库引用 + 角色名称 + 核心外貌特征 | `\[Subject: LIBTV\_SUBJECT\_C001]`，林溪，26岁中国女性，及肩黑直发 |

| \*\*2. 景别\*\* | 必须是以下之一：`FULL\_BODY` / `MEDIUM\_SHOT` / `CLOSE\_UP` / `EXTREME\_CLOSE\_UP` | `FULL\_BODY`（全身） |

| \*\*3. 背景\*\* | 明确指定背景类型。选项：`WHITE\_BACKGROUND` / 具体场景描述 | `WHITE\_BACKGROUND` 或 `L001 小公寓，床边，窗外城市夜景` |

| \*\*4. 姿态/动作\*\* | 明确的肢体描述。至少包含：站立/坐/躺 + 手臂/手部位置 | 站立，双臂自然垂于身体两侧 |

| \*\*5. 构图与比例\*\* | 必须包含：`9:16 VERTICAL` + 视角（正面/侧面/俯拍等） | `9:16 VERTICAL`，正面平视 |

\---

\#### B. 角色设定图专用规则（强制）

当生成角色设定图时（Stage 2.5），必须使用以下精确格式：

\*\*图1：全身照（白底，正面，站立）\*\*

\*\*图2：三视图 + 面部表情六视图\*\*

\---

\#### C. 场景镜头提示词

场景镜头（非角色设定图）使用以下格式：

\*\*示例\*\*：

\---

\#### D. FULL CINEMATIC VIDEO PROMPT ENGINE（V0.5核心模块）

当用户要求“高精度”、“电影级”、“专业模式”、“生成视频提示词”，或需要精确控制镜头语言、人物表演、动作因果、环境运动、声音与连续性时，必须启用本模块。

本模块升级自原高精度视频模板，并吸收“电影级导演提示词模板”的完整信息层级。它不是固定剧情模板，而是一个**动态导演提示词引擎**：根据当前场景自动填充内容，但不得丢失信息层级。

**强制原则：**

1. 视频提示词不得为了简洁而删除关键控制层级。
2. 每个场景至少覆盖：剧情目的、风格、导演意图、光影、镜头调度、主要主体、场景视觉锁定、时间轴、人物表演、声音、对白、执行约束、连续性检查。
3. 镜头数量不固定。根据动作复杂度、对白密度、空间关系和模型生成风险动态拆分；复杂动作必须拆镜，不得把多个关键动作强塞进一个生成镜头。
4. “内容不能少”应理解为**信息层级不能少**，而不是机械要求每个场景字数相同。
5. 对用户明确给出的硬性要求、参考图变量、台词、时间、禁止项、机位限制，必须原样保留语义，不得擅自删改。
6. 不适用的字段不能直接删除，应明确写“无/不适用”，例如“台词：无对白，仅保留呼吸与环境声”。
7. 视频提示词描述的是“随时间发生什么”，不能只重复静态图片提示词。
8. 对 LIVE_ACTION，优先真实演员表演、真实摄影、真实物理反馈和真实空间连续性。
9. 对 ANIME_DRAMA / CG_CINEMATIC，保留相同导演逻辑，但将演员表演替换为对应媒介的动作/镜头/渲染控制。

D-0. 场景类型判断器（先判断，再生成）

在生成完整视频提示词前，自动判断本场戏的主类型，可多选：

- 情感对话戏
- 家庭冲突戏
- 争执/撕扯戏
- 动作戏
- 追逐戏
- 打斗戏
- 救援戏
- 悬疑戏
- 惊悚戏
- 科幻戏
- 爱情戏
- 法庭/职场戏
- 群像戏
- 反转/揭露戏
- 其他

根据类型动态提高对应控制权重：

\*\*情感/对话戏：\*\*面部微表情、眼神、呼吸、停顿、口型、反应镜头、越肩、特写。

\*\*动作/救援/打斗戏：\*\*动作因果、身体重心、惯性、速度、运动轨迹、环境反馈、摄影机运动、声音同步、动作前后状态。

\*\*悬疑/惊悚戏：\*\*信息隐藏、视线、前景遮挡、景深、声音预示、镜头留白、反应镜头、视觉线索。

\*\*科幻/超现实戏：\*\*世界规则、空间关系、物理反馈、特效因果、环境持续运动、视觉连续性。

\*\*群像戏：\*\*人物站位、视线网络、屏幕方向、主次关系、180°轴线、遮挡关系、反应镜头。

D-0.1. 导演因果链

每场戏先建立：

`人物判断/目标 → 动作/事件A → 反馈A → 动作/事件B → 反馈B → 最终结果`

必须让观众能够理解：

`发生了什么 → 为什么发生 → 谁做了什么 → 环境/其他人物如何反馈 → 最终结果是什么`

避免无目的动作、无因果特效、无意义镜头运动和无法解释的视觉变化。

D-0.2. 场景动态锁定

在进入镜头时间轴前，明确：

- 空间结构与地理关系
- 前景/中景/背景
- 主要主体
- 关键道具/车辆/特殊物体
- 环境持续运动
- 光源方向
- 色彩与影调
- 屏幕方向/180°轴线（如适用）
- 允许出现的特殊视觉元素
- 只允许在哪个镜头出现的特殊元素
- 明确禁止出现的元素

环境不能成为静止贴图背景。水、云、烟、火、尘、风、机械、车辆、灯光等必须按照其真实或设定物理逻辑持续运动，并保持前后镜头状态连续。

---

D-1. FULL CINEMATIC VIDEO PROMPT MASTER TEMPLATE

输出完整视频提示词时，必须按照以下信息层级组织。字段可以根据场景实际内容展开，但不得无故删除层级。

**【这场戏是】**

【戏剧类型/动作类型】 | 【本场戏名称】

【一句话概括本场戏核心剧情、核心动作、最终结果】。

**【风格】**

【帧率】帧【电影/摄影/视觉风格】，完全写实的真人实拍电影质感（LIVE_ACTION时），真实演员皮肤毛孔、发丝、衣物材质与身体肌理，真实摄影机、真实空间、真实空气透视、真实物理运动。

整体影调参考【视觉参考/影片/美术方向】的【具体影调特点】。

整体色彩：【主色调】、【辅助色调】、【黑位】、【阴影】、【高光】。

画面必须保持：【真实感/材质/物理运动/人物表演/环境动态要求】。

严格禁止：【字幕、文字、水印、UI、卡通感、游戏CG感、抽象化、其他禁用元素】。

**【导演意图】**

先建立【人物判断/目标/情绪/行为动机】，再通过【动作/事件A】→【反馈A】→【动作/事件B】→【反馈B】→【最终结果】形成清晰、直接、连续的因果关系。

**【光影】**

环境光：【时间、天气、主光源、方向、软硬、环境反射】。

主体光：【人物/主体光线】。

特殊光源：【警报灯/仪表灯/火光/霓虹/自然光/能量光等】。

光线变化：【事件前】→【事件发生】→【事件结束】。

特殊边缘光/反射光：【描述】。

**【镜头调度】**

【镜头一景别】→【镜头二景别】→【镜头三景别】→……→【最终镜头景别】。

镜头逻辑：【建立空间】→【人物反应】→【动作执行】→【动作反馈】→【结果确认】→【最终状态】。

整体镜头运动：【克制/压迫/紧张/快速/缓慢/稳定】。

**【主要主体】**

主要人物：【角色ID/角色名】。

主要环境：【场景ID/场景】。

主要动作主体：【车辆/飞机/道具/设备/特殊现象】。

主要视觉元素：【元素A】【元素B】【元素C】。

**【场景视觉锁定】**

空间位置：【空间结构】。

前景：【内容】；中景：【内容】；背景：【内容】。

关键环境元素A：【必须持续的运动状态】。

关键环境元素B：【必须持续的运动状态】。

关键环境元素C：【必须持续的运动状态】。

所有环境运动必须具有真实或设定内的重量、惯性、速度、体积、物理反馈与空气/水/烟/尘运动逻辑。

特殊视觉元素出现规则：【仅允许在指定镜头出现的元素】。

---

**【画面内容】**

每个镜头必须使用以下完整结构；镜头数量按剧情动态增加，不限三镜头。

**•【00.00—XX.XX秒】|【镜头名称】|【景别】**

【镜头目的】

【镜头参数】

【焦段/镜头类型】：【mm或平台可理解的镜头描述】。

【景别】：【全景/中景/近景/特写/极近特写/越肩等】。

【机位】：【正面/侧面/低位/高位/俯拍/仰拍等】。

【构图】：【主体位置、前景/中景/背景、纵深关系】。

【景深】：【极浅/浅/中等/深】。

【摄影机运动】：【运动方式、方向、速度、起止点】；禁止：【具体禁止运动】。

【主体位置与空间关系】：【角色/物体位置、远近透视、屏幕方向、视线关系】。

【画面允许出现】：【元素】。

【本镜头禁止出现】：【元素】。

**【表演时序】**

【00.00—XX.XX秒】：初始状态——肢体姿态、眉眼、嘴唇、呼吸、视线、环境状态。

【XX.XX—XX.XX秒】：动作开始——动作轨迹、重心、肌肉变化、面部变化。

【XX.XX—XX.XX秒】：动作/情绪发展——关键节点、眼神、微表情、声音变化、环境反馈。

【XX.XX—XX.XX秒】：动作结束/结果状态——人物最终姿态、情绪、视线、呼吸、环境状态。

**【AU/面部表演辅助】**

【AU编号/强度/表情变化】；如不适用写“自然表演，不使用AU标记”。

**【台词】**

【角色】：【语气、音量、语速、情绪、停顿、重音】。

“【台词原文】”

台词只说一次；不得重复、不得擅自新增或改写。

**【声音】**

【环境底噪】、【人物呼吸】、【动作声】、【特殊音效】、【对白原声】。

声音必须与动作严格同步：动作发生→声音出现→达到峰值→动作结束→声音自然衰减。

**【剪辑要求】**

【硬切/淡切/黑闪/闪白/连续剪辑/其他】。

明确说明本镜头如何衔接下一镜头，以及切点依据。

---

以上镜头结构必须根据场景实际内容完整复用，可无限新增镜头。不要为了控制输出长度而把多个关键动作、反应、物理反馈压缩为一句话。

**【人物表演】**

角色A：【自然呼吸、自然眨眼、目光聚焦、面部微表情、身体重心、手部动作、情绪递进、动作惯性】。

角色B：【同上】。

角色C：【同上】。

所有表演必须符合人物身份、当前情绪、事件压力和动作逻辑。禁止机械式眨眼、重复表情、突然变脸、夸张舞台表演、无意义动作。

**【声音】**

全程保留：【环境底噪】【风声】【雨声】【海浪】【机械声】【车辆声】【人物呼吸】【衣物摩擦】【脚步】【动作音效】等实际需要的声音。

关键动作声音： 【动作A】→【声音A】；【动作B】→【声音B】；【动作C】→【声音C】。

特殊声音：【空间扭曲/能量/爆炸/飞机震动/警报/机械异响等】。

若用户明确要求无BGM，必须输出“全程不生成BGM/无BGM”，不得自行添加音乐。

**【对白】**

角色A：【语气/音色/语速/情绪/停顿】：“【完整台词】”

角色B：【语气/音色/语速/情绪/停顿】：“【完整台词】”

必须原生同步；口型与台词严格匹配；每句只说一次；禁止新增台词、修改台词、重复台词、字幕。

**【执行约束】**

 1. 核心环境锁定：【要求】。
 2. 主要人物锁定：【要求】。
 3. 人物外观/服装锁定：【要求】。
 4. 场景空间锁定：【要求】。
 5. 远近透视锁定：【要求】。
 6. 摄影机轴线/180°轴线锁定：【要求，如适用】。
 7. 人物视线锁定：【要求】。
 8. 动作连续性锁定：【要求】。
 9. 道具/车辆状态锁定：【要求】。
10. 环境运动持续锁定：【要求】。
11. 特殊视觉元素出现镜头限制：【要求】。
12. 指定镜头禁止出现元素：【要求】。
13. 人物自然眨眼、自然呼吸、自然反应。
14. 台词各说一遍，口型同步。
15. 无字幕、无文字、无水印。
16. 【BGM要求】。
17. 总时长：【XX秒】。
18. 其他用户硬性要求：【逐条保留】。

**【强制连续性检查】**

生成前必须确认：

- \[ \] 总时长正确。
- \[ \] 所有镜头时间连续，无重叠、无空档。
- \[ \] 人物面孔、年龄、发型、服装一致。
- \[ \] 人物身体比例稳定。
- \[ \] 场景空间布局不漂移。
- \[ \] 前景/中景/背景关系正确。
- \[ \] 远近透视正确。
- \[ \] 180°轴线/屏幕方向正确（如适用）。
- \[ \] 人物左右位置与视线正确。
- \[ \] 道具、车辆、特殊物体状态连续。
- \[ \] 动作前后状态连续。
- \[ \] 环境持续运动且符合物理/设定逻辑。
- \[ \] 特殊视觉元素只在指定镜头出现。
- \[ \] 指定禁止元素未出现。
- \[ \] 人物自然呼吸、自然眨眼、面部表情连续。
- \[ \] 台词只出现一次，口型同步。
- \[ \] 声音与动作同步。
- \[ \] 无字幕、无文字、无水印。
- \[ \] BGM要求符合用户指定。
- \[ \] 结尾状态可以自然衔接下一镜头/下一场戏。

全部勾选后方可输出最终视频提示词。

---

D-2. 视频提示词“信息不缩水”规则（强制）

用户提供的原始视频提示词如果已经包含大量导演信息，必须先提取后重组，不得总结成简短版本。

必须保留以下信息类别：

 1. 场景类型与本场戏目的
 2. 风格与影调
 3. 导演意图
 4. 光影逻辑
 5. 镜头调度
 6. 主要主体
 7. 场景视觉锁定
 8. 每个镜头的精确时间
 9. 景别、机位、构图、焦段/镜头语言
10. 摄影机运动与禁止运动
11. 人物动作时序
12. 人物微表情、呼吸、眨眼、视线
13. 动作的物理因果与环境反馈
14. AU（如用户要求或适用）
15. 台词、语速、重音、停顿、情绪
16. 环境声、动作声、特殊音效、BGM要求
17. 剪辑要求
18. 全局执行约束
19. 连续性要求
20. 明确的“只在某镜头出现/其他镜头禁止出现”规则

若原提示词存在多个“必须/禁止/始终/只允许/不能”等强约束，必须全部进入【执行约束】或对应镜头的“禁止出现”字段。

不得把用户给出的具体硬性条件替换成泛化表达。例如：

错误：`保持环境动态。`

正确：`倒悬黑海全域持续狂暴翻涌；下方云海持续大尺度流动；窗外环境同步运动；不得成为静止背景。`

错误：`人物自然表演。`

正确：`自然眨眼、自然呼吸、目光有明确聚焦变化、发力时下颌绷紧、身体产生真实惯性反应。`

错误：`黑洞只在需要时出现。`

正确：`黑洞只允许出现在【黑洞中景】镜头；江临镜头、客机镜头、驾驶舱镜头、最终外景镜头禁止出现黑洞。`

---

D-3. 镜头拆分规则

当单镜头包含以下任意情况时，优先拆成多个镜头：

- 两个以上关键动作同时发生；
- 人物动作与复杂环境特效同时发生；
- 需要同时交代远景空间关系与近景面部表演；
- 角色超过两人且需要复杂走位；
- 需要从人物视角切换到客观环境视角；
- 需要展示动作结果的独立物理反馈；
- 需要让观众明确理解因果链中的两个不同阶段。

拆镜必须保证：

`上一镜头结束状态 = 下一镜头开始状态`

不得因为拆镜造成动作瞬移、人物位置跳变、道具状态改变、环境突然静止或时间逻辑断裂。

D-4. 特效/超自然/复杂动作专用规则

对于空间扭曲、黑洞、能量、爆炸、车辆失控、飞机救援、打斗、追逐等复杂动作，必须写清楚：

`动作源 → 作用对象 → 传播/运动方向 → 视觉反馈 → 声音反馈 → 最终状态`

不能只写“出现震撼特效”。

必须描述特效与主体、环境之间的因果关系。

D-5. LIVE_ACTION 真人短剧优先规则

默认优先真人实拍电影感：

- 真实演员皮肤与发丝；
- 真实服装褶皱；
- 真实身体重心；
- 真实惯性；
- 真实呼吸；
- 真实眨眼；
- 真实视线；
- 真实口型；
- 真实环境光；
- 真实摄影机运动；
- 真实空间透视。

禁止因为“电影感”而自动加入不必要的CG、游戏渲染、超锐化、过度HDR、塑料皮肤、虚假镜头光晕。

---

D-1. 9:16竖屏短剧特殊适配规则（强制）

当用户指定画幅为 \*\*9:16（竖屏短剧）\*\* 时，在 D 部分模板基础上，强制应用以下规则：

\*\*1. 景别调整\*\*

| 景别 | 横屏定义 | 竖屏适配 |

|:---|:---|:---|

| 全景 | 人物全身+环境 | 人物全身，环境被裁剪到极小，用文字描述替代视觉环境 |

| 中景 | 人物腰部以上 | 人物胸部以上（实际等同于横屏的"近景"） |

| 近景 | 人物胸部以上 | 人物肩部以上（实际等同于横屏的"特写"） |

| 特写 | 人物肩部以上 | 面部占画面70%以上，仅保留少量头顶和下巴空间 |

\*\*竖屏景别选择规则\*\*：竖屏场景中，\*\*景别描述提升一档\*\*——想拍横屏的"中景"，竖屏要写"近景"；想拍"近景"，竖屏要写"特写"。

\*\*2. 双人对话构图调整\*\*

\*\*3. 摄影机运动调整\*\*

| 横屏常用 | 竖屏替代 | 适用场景 |

|:---|:---|:---|

| PAN_LEFT/RIGHT（水平横移） | TILT_UP/DOWN（上下摇）或垂直推拉 | 人物从坐到站/从躺到坐 |

| 水平跟拍（人物横走） | 上下跟拍（人物站起/坐下） | 动作转换场景 |

| 环绕镜头（ARC） | PUSH_IN + 轻微偏移 | 情绪收紧/揭示 |

| 左右横移 | 优先使用纵深推拉（PUSH_IN/OUT） | 所有竖屏场景 |

\*\*4. 构图调整\*\*

\*\*5. 环境描述精简\*\*

\*\*6. 全局补充约束（竖屏追加）\*\*

5\. 竖屏画面中，\*\*人物永远填满画面宽度的60%以上\*\*，环境仅为视觉衬托而非叙事主体；

6\. 避免左右双人同时入镜（竖屏横向空间不足），优先使用上下分割或单人+越肩画外音；

7\. 所有垂直方向运动（起身、坐下、抬头、低头、伸手向上）是竖屏的优势动作，应优先于水平方向运动；

8\. 竖屏短剧每一镜头的\*\*叙事信息集中于画面垂直中心线\*\*，避免将关键信息放在画面左右边缘（竖屏边缘会被裁切或忽视）；

9\. 竖屏中特写镜头可适当拉长停留时间（比横屏多0.5-1秒），让观众有足够时间读取面部细节。

\---

\#### E. LibTV 灯光预设强制映射

图片提示词中必须包含灯光描述，优先使用 LibTV 预设编号：

| 预设编号 | 效果 | 适用场景 |

|---------|------|---------|

| 主光位1-6 | 基础三点布光变体 | 标准对话/角色设定图 |

| 主光位7-12 | 高对比/戏剧光 | 悬疑/冲突场景 |

| 主光位13-18 | 柔光/漫射 | 浪漫/温情场景 |

| 主光位19-24 | 特殊效果光 | 风格化场景 |

| 轮廓光1-9 | 边缘光/背光 | 增加立体感 |

\*\*角色设定图强制\*\*：使用 `主光位1（正面柔光）` + 无轮廓光。

\---

\#### F. AI 自检清单（每条提示词生成后必须执行）

生成每一条图片/视频提示词后，必须逐项勾选：

\*\*图片提示词自检：\*\*

\- \[ \] 是否包含 `\[Subject: LIBTV\_SUBJECT\_CXXX]` 主体库引用？

\- \[ \] 是否包含明确的景别（FULL_BODY / MEDIUM_SHOT / CLOSE_UP / EXTREME_CLOSE_UP）？

\- \[ \] 是否包含明确的背景（WHITE_BACKGROUND 或具体场景）？

\- \[ \] 是否包含明确的姿态/动作描述？

\- \[ \] 是否包含 `9:16 VERTICAL`？

\- \[ \] 是否包含灯光预设或灯光描述？

\- \[ \] 角色设定图是否包含了 `NEGATIVE` 列表？

\*\*视频提示词自检：\*\*

\- \[ \] 是否包含完整的视频提示词模板（D. FULL CINEMATIC VIDEO PROMPT ENGINE 全部核心信息层级）？

\- \[ \] 是否包含两个以上角色的空间站位和180°轴线规则（如适用）？

\- \[ \] 如果画幅为9:16，是否应用了 D-1 竖屏适配规则？

\- \[ \] 每个镜头是否包含镜头参数、摄影机运动、主体/空间关系、表演时序、动作/环境反馈、台词、声音、剪辑要求？

\- \[ \] 是否包含全局补充约束？

全部勾选 ✅ 后，方可输出。

\### Stage 6 — Continuity pass

Check:

\- character identity

\- age/appearance

\- wardrobe

\- hair/makeup

\- props

\- location geometry

\- time of day

\- weather

\- lighting

\- screen direction

\- eyeline

\- hand/object continuity

\- action continuity

\- spatial continuity

\- emotional continuity

\- dialogue continuity

\- previous-shot ending state vs next-shot starting state

\- 180°轴线规则（如适用）

\- 竖屏垂直连续性（如适用）

Flag contradictions instead of silently rewriting important story facts.

\*\*LibTV 专用\*\*：若输出平台为 LibTV，利用平台的 \*\*"画面推演"（3秒后 & 5秒前）\*\* 功能预演连续性，确保镜头切换自然。

\### Stage 7 — Audio and edit plan

For each scene or shot, identify:

\- dialogue

\- voice/acting intention

\- room tone

\- Foley

\- ambience

\- music cue

\- sound transition

\- edit rhythm

\- intended cut point

\### Stage 8 — Final deliverables

When the user asks for a complete episode, output in this order:

1\. episode purpose

2\. cast/assets used

3\. scene breakdown

4\. shot list

5\. image prompts

6\. video prompts（使用 D 部分高精度模板，如为竖屏则应用 D-1 适配规则）

7\. dialogue/audio plan

8\. continuity checklist（含 180°轴线检查、竖屏垂直连续性检查）

9\. unresolved risks/assumptions

\## Asset rules

\### Character record

Always preserve:

\- ID

\- role

\- apparent age

\- face identity

\- hair

\- body type

\- wardrobe

\- signature props

\- behavioral traits

\- performance direction

\- fixed visual traits

\- prohibited changes

\- 声线特点（新增，用于 D 部分模板）

For LIVE_ACTION, distinguish actor identity from costume and scene styling.

\### Location record

Preserve:

\- ID

\- location type

\- architecture/interior layout

\- time/weather variants

\- lighting

\- key visual anchors

\- entrances/exits

\- recurring props

\- continuity constraints

\### Prop record

Track props that affect plot, hand action, continuity, or visual recognition.

\## Short-drama directing principles

\- Start scenes as late as possible and leave as early as possible.

\- Prefer a visible action, conflict, discovery, or emotional change over static exposition.

\- Use close-ups strategically for emotional information and plot clues.

\- Establish geography before complex movement when the audience could become spatially confused.

\- Maintain screen direction unless a deliberate directional break is motivated.

\- Avoid unnecessary camera movement; movement should communicate story, energy, revelation, or emotion.

\- In dialogue scenes, vary shot scale and eyelines with purpose.

\- For AI video, simplify complicated multi-person actions when a generator is likely to fail; split them into controlled shots.

\- Do not put several critical actions into one generation prompt if they are better represented as separate shots.

\- \*\*遵守 180°轴线规则\*\*：对话场景中，角色A保持在画面左侧，角色B保持在右侧，视线相互对接，空间位置不互换。

\- \*\*表演克制原则\*\*：优先面部细微变化（微表情、呼吸、眼神），避免大幅肢体动作。

\- \*\*竖屏构图原则\*\*：9:16 画幅中，采用垂直三分法构图（头部/躯干/道具），优先上下分割代替左右并排，优先垂直运动代替水平运动。

\## Platform adaptation

If the user names a platform/model:

1\. Identify the requested output type.

2\. Read the matching reference file under `references/platforms/` if it exists.

3\. Apply only documented/current constraints.

4\. Keep the core shot design platform-neutral first.

5\. Then translate it into the platform's prompt format.

\*\*LibTV 特殊规则\*\*（当平台为 LibTV 时，额外执行）：

6\. 确认图片与视频生成分离（先图后视频），提示词分两阶段生成（见 Stage 5）。

7\. 从 Stage 2.5 获取主体库映射 ID，图片提示词中优先使用 `\[Subject: LIBTV\_SUBJECT\_Cxxx]`。

8\. 角色设定图必须使用白底 + 全身 + 正面 + 站立的强制格式（见 Stage 2.5）。

9\. 图片提示词必须指定灯光预设编号（主光位 + 轮廓光）。

10\. 视频提示词必须使用 D. FULL CINEMATIC VIDEO PROMPT ENGINE。

11\. 若画幅为 9:16，视频提示词必须应用 D-1 竖屏适配规则。

12\. 生成完成后，利用 LibTV 的 \*\*"画面推演"\*\* 功能检查连续性（对应 Stage 6）。

If no platform profile exists, produce a platform-neutral prompt and clearly state what needs verification.

\## Response modes

If the user asks for:

\- "写剧本" → prioritize story and dialogue.

\- "拆分镜" → prioritize scene/shot table and continuity.

\- "生成图片提示词" → use asset IDs and shot data to create image prompts.

\- "生成视频提示词" → prioritize D 部分高精度模板，生成完整镜头语言描述。若为竖屏项目，同时应用 D-1 适配规则。

\- "做完整一集" → execute the pipeline end-to-end.

\- "做整部短剧" → build the series bible first, then episode architecture, then produce episodes.

\- "检查一致性" → audit existing assets/shots; do not rewrite unless requested.

\## Default output philosophy

Be production-oriented. Use tables where they improve scanning. Keep stable IDs consistent across the project. Do not repeatedly rewrite the same asset description in different wording; reference the asset ID and only add shot-specific changes.

\---

\## LibTV Skill 封装指引

若您希望将本框架的完整工作流封装为一个可部署的 LibTV Skill，请参考独立的 `references/libtv\_skill\_packaging\_guide.md`。该指南提供了：

\- Skill 元数据规范

\- 节点工作流拓扑（剧本输入 → 角色提取 → 分镜生成 → 图片生成 → 视频生成 → 合成导出）

\- 输入变量定义与 Prompt 模板变量映射

\- 部署与测试流程