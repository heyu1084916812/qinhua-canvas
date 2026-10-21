---

## name: continuous-long-take-director description: Use when planning or generating an AI video that should feel like one continuous long take, especially when character identity, props, movement, spatial relations, or camera direction must persist across a long timeline or generation boundaries.

# 连续长镜头导演

把长视频规划成一条统一时间轴，使用少量关键帧、连续运动路径和状态传递，优先通过原生长视频生成或对同一视频持续续写，形成同一个连续世界中的完整长镜头。

最终目标是让普通观众相信人物、空间、道具和事件一直存在于同一个连续世界。技术上是否由一次生成完成，不作为成功标准。

## 适用范围

在用户要求连续长镜头、统一长视频、角色或道具跨时间轴一致、动作接续或视频续写时使用本 Skill。

V0 只负责连续性规划、统一时间轴生成、必要的视频续写、状态更新和错误判断。不要自行增加配音、自动剪辑、资产管理、发布或其他产品能力。

## INPUT INTERPRETATION

用户不需要提供标准视频 Prompt。默认假设用户提供的是自然语言描述、故事梗概、小说片段、剧情创意、简单需求、剧本或已有视频 Prompt。

首先判断输入类型。如果输入是已经结构化的视频 Prompt，保留其中明确设定并进入状态提取。如果输入属于 RAW STORY / IDEA，不要要求用户重新写成视频 Prompt，先提取以下内容。

### NARRATIVE FACTS

记录用户明确规定、不能擅自改变的剧情事实。

### CHARACTERS

识别所有重要人物及其在故事中的身份。

### EVENT CHAIN

按因果顺序整理故事实际发生的事件。

### LOCATIONS

识别涉及的空间、空间之间的关系以及人物如何移动。

### KEY PROPS

识别会影响后续剧情或连续性的物体。

### STATE CHANGES

识别人物、道具和环境在故事中发生的状态变化。

### VISUAL MOMENTS

识别必须通过画面表现的内容。

### NON-VISUAL CONTENT

识别心理活动、背景说明和抽象描述等不能直接拍摄的内容，并把它们转换成可见、可表演的动作或环境反应。

例如，“她开始感到不安”不能直接作为视频动作。可以转换为以下可见表现。

- 她盯着不断下降的楼层数字。
- 呼吸逐渐急促。
- 手指反复按开门按钮。
- 身体向电梯角落退去。

转换时允许补充视觉动作，禁止改变原故事的核心事实、人物关系、事件顺序和因果关系。

## DIRECTORIAL AUTOFILL

对于用户没有规定、但视频生成必须确定的信息，由 Skill 自主补齐。

- 人物具体视觉形象
- 服装
- 基础场景设计
- 光线
- 摄影机位置
- 景别
- 运镜
- Clip 长度
- 环境细节

所有补充优先服务用户指定的题材、情绪和故事。不要为了增强电影感而增加重要人物、改变结局、增加重大剧情事件或改变故事因果。

导演补全的内容应明确标记为 Skill 补充。用户可以在规划确认阶段修改这些内容。

## USER INTENT PRIORITY

发生冲突时，按照以下顺序决定采用哪项信息，越靠前优先级越高。

1. 用户明确要求
2. 用户上传的参考素材
3. 原始故事中的事实
4. Skill 的导演判断
5. 默认视觉方案

低优先级内容不得覆盖高优先级内容。导演补全只处理尚未被高优先级信息确定的空白。

## MULTI-SHOT REPRESENTATION

在建立 Master State 前，先把输入整理成全局信息和逐镜头信息。两者职责不同，不要把全部角色外观和历史剧情重复写进每个镜头。

### GLOBAL STORY CAPTION

用一个简洁段落描述整段视频长期稳定的信息。

- 主要主体及稳定外观
- 故事涉及的总体环境
- 长期视觉风格
- 用户明确锁定的叙事事实

GLOBAL STORY CAPTION 不描述某个 Clip 的临时动作、表情或机位。它是全片共同基线，不是剧情摘要的重复副本。

### SUBJECT REGISTRY

为重要人物、动物、车辆和会独立行动的核心物体分配稳定 Subject ID。

```text
SUBJECT REGISTRY
- Subject 1 / 唯一名称 / 稳定身份描述 / 参考素材
- Subject 2 / 唯一名称 / 稳定身份描述 / 参考素材
```

- 同一主体跨镜头始终使用同一 Subject ID。
- 一个 Subject ID 只表示一个实体。
- 不因角度、服装损伤、情绪或动作变化创建新 ID。
- 普通背景物件不进入 SUBJECT REGISTRY。影响剧情且需要唯一状态的物体同时进入 PROP DEFINITIONS。
- 逐镜头规划不能创建未在故事或导演补全阶段建立的新主体。

### VISIBLE SUBJECT SET

每个 Shot 或 Clip 明确列出当前画面实际出现的 Subject ID 和核心 Prop ID。

- 逐镜头描述只引用当前可见的主体。
- 不把未出镜角色的完整描述塞入当前生成提示。
- 远处、模糊且不影响当前事件的主体可以不列入。
- 下一规划单元会直接使用的主体或道具，应根据 HANDOFF 需要在当前 END STATE 中进入画面。

### CURRENT SHOT CAPTION

每个镜头使用一个局部描述，内容只覆盖当前可见主体、动作、表情、场景状态、构图和摄影机运动。

```text
CURRENT SHOT CAPTION
- VISIBLE SUBJECT SET
- 当前动作与表情
- 当前场景和状态变化
- 摄影机位置、景别和运动
- 与前后镜头有关的方向和交接信息
```

CURRENT SHOT CAPTION 使用 Subject ID 引用全局身份，不重新改写主体外观。角色外观只有发生剧情允许的可见变化时才更新 Continuity Ledger。

### VARIABLE SHOT DURATION

根据当前事件负载、动作复杂度和模型能力分配镜头时长。不同 Clip 可以使用不同长度。

- 简单反应、视线或建立镜头可以较短。
- 穿越空间、道具交接和完整动作需要足够时间展示因果过程。
- 一个 Clip 无法稳定完成全部动作时，拆成多个连续阶段。
- 总时长由用户要求控制。不要为了平均分配而强迫所有 Clip 等长。

以上结构借鉴多镜头生成研究中的全局描述与逐镜头描述分工。它只能改善 Skill 层的信息组织，不能替代底层模型的联合多镜头生成、参考注入或跨镜头位置编码能力。

## UNIFIED VIDEO TIMELINE

把整部视频视为一个持续发展的时间轴。Shot 或 Clip 是规划动作、状态和风险的内部单元，默认不等于要分别生成并在最后拼接的独立视频文件。

```text
UNIFIED VIDEO TIMELINE
- Total Duration
- Continuous Spatial Route
- Event and Action Timeline
- Camera Trajectory
- Temporal and Environment Progression
- Narrative Keyframes
- Generation Mode
```

- `Continuous Spatial Route` 说明人物和摄影机如何在已建立的三维空间中连续移动。
- `Event and Action Timeline` 按时间安排事件、动作阶段和因果，不把动作重置在规划单元边界。
- `Camera Trajectory` 是全片连续路径。机位变化必须在画面中发生。
- `Temporal and Environment Progression` 继承已锁定的时间、光线、天气和环境状态。
- 先完成全片时间轴，再决定底层模型如何生成。不能因为模型单次时长较短，就先把故事设计成互相独立的镜头。

### NARRATIVE KEYFRAME PLAN

关键帧是统一时间轴上必须到达的叙事和空间状态，不是默认要分别生成的静态首帧。

```text
NARRATIVE KEYFRAME [ID]
- Timeline Position / 时间点或时间范围
- Narrative Purpose / 当前必须成立的剧情事实
- Character and Prop State
- Spatial Position and Screen Direction
- Camera Position and Trajectory
- Environment and Time Condition
- Incoming Motion
- Outgoing Motion
- Transition Path from Previous Keyframe
```

- 只为身份建立、空间转折、关键动作结果、道具状态变化或剧情拐点设置关键帧。
- 相邻关键帧必须能由一个连续可见的 `Transition Path` 连接，说明人物、摄影机和环境如何从前一状态到达后一状态。
- 不按固定秒数机械增加关键帧。过密关键帧会压缩自然动作并诱发摆拍、瞬移或画面变形。
- 相邻关键帧的姿势、位置和机位差异超过当前模型能够自然完成的范围时，调整动作路径或增加必要的中间里程碑。
- 若模型支持多个关键帧输入，才把规划关键帧绑定到对应控制槽位；否则关键帧只用于时间轴和提示词规划，不能虚构平台不存在的控制能力。

## VISUAL ASSET BIBLE

在写视频生成提示前，先规划整部作品需要的视觉参考资产。参考资产用于锁定角色身份、服装版本、场景空间、核心道具和视觉风格。

只规划故事和镜头实际需要的参考。不要为短暂出现的角色或从未被摄影机看到的角度机械生成完整资产集。

### MEDIA ROLE CONTRACT

每个参考资产必须只有一个明确的媒体角色。生成节点和素材输入槽位必须按角色绑定，不得因为画面看起来相似而互相替代。

Media Role用途禁止用途`style_reference`色彩、光线、材质、写实程度首帧、场景、人物或道具参考`character_reference`角色身份、脸部、体型和服装版本场景或首帧替代`location_reference`建筑、空间布局、场景角度和环境状态风格锚点或连续边界替代`prop_reference`核心道具外观和状态版本人物、场景或首帧替代`transition_reference`两个场景之间的出入口和空间连接普通风格参考

- 素材名称、说明和 REFERENCE MANIFEST 都必须写出 Media Role。
- `style_reference` 只能进入风格参考槽位。
- `location_reference` 只能进入场景或环境参考槽位。
- 当前模型没有对应槽位时，不得把素材塞进含义不同的槽位。应采用明确降级方案或停止生成。

### CHARACTER REFERENCE PACK

为每个会跨多个镜头出现的重要角色建立参考包。

```text
CHARACTER REFERENCE PACK
- Subject ID
- Primary Identity / 全身正面、中性姿势、干净背景
- Face 3/4 / 头肩三分之四角度
- Story-required Side or Back Views
- Wardrobe Variants / 每套剧情服装独立版本
- Expression Set / 仅故事实际需要的关键表情
- Action Poses / 仅身份容易在动作中漂移时使用
- Source / 用户上传或 Skill 生成
```

- Primary Identity 是该角色的身份主参考。
- Face 3/4、侧面、背面、服装和动作版本都应从 Primary Identity 派生，不能相互独立生成。
- 所有派生图保持同一脸部、发型、体型和身份标记。
- 服装版本使用稳定版本 ID。衣物淋湿、污损、破裂和血迹作为连续状态版本，不创建新角色。
- 主要角色通常需要 Primary Identity 和 Face 3/4。只有镜头实际会看到时才增加侧面或背面。
- 功能性配角可只使用一张主参考。背景群众不要求独立身份包。
- 用户上传的角色参考优先于 Skill 生成的参考。

### LOCATION REFERENCE MATRIX

为重复出现、发生空间移动或会改变状态的重要地点建立参考矩阵。

```text
LOCATION REFERENCE MATRIX
- Location ID
- Location Condition ID
- Primary Establishing View
- Story-required Angles
- Entry and Exit Views
- Lighting / Weather Variants
- Narrative State Variants
- Non-negotiable Spatial Anchors
- Temporal Environment Lock
- Environment Element Inventory
- Source / 用户上传或 Skill 生成
```

- Primary Establishing View 锁定建筑、材质、尺度和主要布局。
- 其他角度从主参考派生，并保持门窗、家具、走廊和出入口关系。
- 只建立镜头计划真正访问的角度、光线、天气和剧情状态组合。
- 损坏、火灾、积水、物件移动等变化建立状态版本，并明确哪些变化不可逆。
- Environment Map 记录空间拓扑，LOCATION REFERENCE MATRIX 负责提供对应的视觉依据。

LOCATION CONDITION ID

每组场景参考使用唯一条件版本，包含 Location ID、故事时间、昼夜、天气、季节、剧情状态和版本号。例如 `FOREST_SUNSET_CLEAR_INTACT_V1` 表示同一片夕阳、晴朗、尚未受损的树林。

所有属于同一 LOCATION CONDITION ID 的全景、入口、出口和路线视图必须继承相同条件。只有剧情明确发生时间、天气、季节或环境状态变化时，才能建立新版本。不得为了生成新角度而静默创建夜景、不同季节或另一套环境。

TEMPORAL ENVIRONMENT LOCK

同一 LOCATION CONDITION ID 锁定以下信息。

```text
TEMPORAL ENVIRONMENT LOCK
- Story Time
- Time of Day
- Sun Position
- Sky State
- Shadow Direction and Length
- Colour Temperature
- Exposure Level
- Weather and Atmosphere
- Season
```

- “夕阳”要求所有派生参考保持相近太阳高度、天空颜色、阴影方向和暖色温。
- 摄影机换角度可以改变太阳在画面中的位置，不能把夕阳改成正午、蓝调时刻或夜景。
- 未经剧情授权的昼夜、天气和季节变化属于阻断错误。
- 剧情确实跨越时间时，为每个时间状态建立命名版本，并说明变化发生在哪个 Clip。

ENVIRONMENT ELEMENT INVENTORY

记录观众会在不同视角中辨认的自然元素、固定物件和可移动布景。

```text
ENVIRONMENT ELEMENT INVENTORY
- Vegetation State / 植物种类、密度、颜色、季节和健康状态
- Terrain State / 地面材质、坡度、积水、泥土、落叶和雪
- Fixed Natural Anchors / 主要树木、岩石、河流和山体
- Fixed Built Anchors / 门、路牌、围栏、建筑和固定家具
- Movable Dressing State / 箱子、椅子、工具、散落物和其他可移动物件
- Damage and Depletion State / 燃烧、破损、消耗和清理状态
```

- 同一场景不同角度保持植物种类、季节、整体密度和颜色一致。
- 显眼树木、岩石、路牌、门和其他空间标志保持位置关系。
- 风可以让枝叶运动，不能无理由改变树种、树木数量或季节颜色。
- 可移动物件只有在画面中被移动后才能改变位置。
- 物件、植被或环境发生剧情变化时，更新 Environment State，并建立对应状态版本。

LOCATION MASTER

同一场景先建立一张无人全景或广角主参考，锁定建筑、地形、门窗、固定家具、材质、尺度和主要空间比例。

- LOCATION MASTER 必须是空场景，不得出现可识别人物。
- 不得出现只属于某个 Clip 的临时动作、手持道具或临时特效。
- 固定建筑和永久布景可以出现。
- 同一场景的其他视角与状态必须从 LOCATION MASTER 派生，不能分别独立重新设计。
- LOCATION MASTER 必须绑定一个 LOCATION CONDITION ID。所有派生视图继承其 TEMPORAL ENVIRONMENT LOCK 和 ENVIRONMENT ELEMENT INVENTORY。

LOCATION VIEW SET

从 LOCATION MASTER 派生镜头实际需要的角度。

- 全景建立视图
- 角色入口视图
- 角色出口视图
- 正向路线视图
- 反向路线视图
- 剧情需要的细节视图

派生视图必须保持相同门窗位置、路径方向、建筑结构、固定家具和尺度关系。不同视图可以改变摄影机位置，不能改变场景结构。

派生视图还必须保持同一时间、天气、季节、植被和物件状态。换角度不能触发环境重新设计。

LOCATION GRAPH

把所有场景视为具有方向的空间节点和连接边。

```text
LOCATION GRAPH
- Location A
- Connection / 门、走廊、楼梯、道路、边缘或其他通道
- Location B
- Travel Direction
- Exit View in A
- Entry View in B
- Persistent Weather / Light / Time State
```

- 同一场景内移动使用 LOCATION MASTER 和 LOCATION VIEW SET 保持结构一致。
- 不同场景之间必须说明人物通过什么连接、沿哪个方向离开和进入。
- 门的 A 面与 B 面、楼梯底部与顶部、走廊两端等连接必须能在三维空间中互相解释。
- 场景切换不能凭空改变时间、天气、光线方向或人物运动趋势。

TRANSITION ANCHOR

跨场景移动时，为连接边建立成对参考。

```text
TRANSITION ANCHOR
- From Location / Exit View
- Connection Object or Route
- To Location / Entry View
- Character Travel Direction
- Camera Direction
- Shared Light / Weather / Time State
```

出口和入口参考必须共享同一连接物、方向和环境状态。TRANSITION ANCHOR 只负责证明空间连接，不能替代角色、场景或风格参考。

### PROP REFERENCE PACK

为核心道具和观众会反复辨认的视觉元素建立参考包。

```text
PROP REFERENCE PACK
- Prop ID
- Primary View / 三分之四角度、干净背景
- Detail View / 镜头会特写的结构
- In-context View / 需要确认环境内比例时使用
- State Variants / 完整、损坏、打开、耗尽等
- Source / 用户上传或 Skill 生成
```

- 故事关键且跨镜头出现的道具需要主参考。
- 派生视图和状态版本从主参考生成。
- 道具参考锁定外观，Prop State 继续负责持有者、左右手、位置和当前状态。
- 反复出现且观众会注意其变化的家具、设备、标志或布景，也可以建立唯一参考 ID。

### STYLE ANCHOR

使用一至两张能够代表全片色彩、光线、材质和写实程度的参考图作为 STYLE ANCHOR。

- STYLE ANCHOR 不得出现人物、角色服装、剧情道具、文字或可识别的具体故事地点。
- STYLE ANCHOR 应使用中性的材质、色板、光线或非剧情环境表达视觉风格。
- STYLE ANCHOR 应在角色、场景和道具派生图之前确定。
- 后续参考和镜头画面使用同一风格依据。
- 剧情需要另一种明确视觉状态时，建立有名称的风格版本，不能在镜头之间静默漂移。
- STYLE ANCHOR 只能标记为 `style_reference`，不得放入首帧或场景槽位。

### REFERENCE MANIFEST

每个时间轴规划单元都要列出实际需要的参考资产及其职责。

```text
REFERENCE MANIFEST FOR PLANNING UNIT [N]
- `character_reference` / 对应 Subject ID 与服装版本
- `location_reference` / 对应 LOCATION MASTER、角度、光线、天气和剧情状态
- `location_condition_id` / 当前时间、天气、季节和环境状态版本
- `prop_reference` / 当前可见的核心 Prop ID
- `style_reference` / 只进入风格槽位
- `transition_reference` / 跨场景边界使用
- Missing critical references
```

- 只附加当前生成范围真正需要的参考。
- 用户提供的参考素材按 USER INTENT PRIORITY 处理。
- 参考数量超过当前模型可用上限时，按当前主体、核心道具、当前场景和风格的顺序保留，并向用户说明被省略的约束。

### REFERENCE PREFLIGHT

生成完整视频、初始视频或执行续写前检查当前范围的 REFERENCE MANIFEST。

1. 当前角色是否使用正确 Subject ID、身份主参考和服装版本。
2. 场景参考是否匹配当前角度、光线、天气和剧情状态。
   - 当前场景是否使用正确 LOCATION CONDITION ID。
   - 时间、太阳、天空、阴影、色温和曝光是否与 TEMPORAL ENVIRONMENT LOCK 一致。
   - 植物、地形、固定物件和可移动布景是否与 ENVIRONMENT ELEMENT INVENTORY 一致。
3. 当前可见核心道具是否使用正确 Prop ID 和状态版本。
4. STYLE ANCHOR 是否一致。
5. 当前模型是否能接收所需参考类型和数量。
6. 每张素材是否进入与 Media Role 相同的槽位。

缺少会导致角色身份、空间或核心道具不可控的参考时，停止当前生成范围。先补齐参考、调整镜头方案或向用户说明能力限制，不能静默放弃关键约束。

参考图生成后，先比较角色身份、服装、场景布局、道具外观和风格。明显不一致的参考不能进入视频生成。

## 开始前收集信息

从用户输入和当前可用素材中确认以下信息。已经明确的内容不要重复追问。

- 创意与剧情目标
- 总时长和期望节奏
- 画幅、风格和类型
- 主要角色及角色参考
- 核心道具
- 关键空间及其连接关系
- 当前可用的视频模型能力
- 是否支持角色参考、目标时长、多关键帧控制和视频续写

缺少一般细节时，采用最保守且容易保持连续的设定继续规划。缺少会改变角色身份、核心道具或空间关系的信息时，先向用户确认。

## GENERATION MODE SELECTION

先核实当前 LibTV 工作流和所选模型实际提供的时长、关键帧输入与视频续写能力，不根据模型名称或宣传文案猜测节点能力。

按以下优先级选择执行模式。

### MODE A / NATIVE LONG VIDEO

当模型单次生成能够覆盖目标时长，并能接受统一时间轴所需的控制信息时，优先一次生成完整长视频。

- 输入完整 `UNIFIED VIDEO TIMELINE`、Master State、必要参考和适量关键帧约束。
- Shot 或规划单元只用于规划和检查，不创建独立视频节点。
- 生成后按关键帧位置和全片连续性检查真实结果。

### MODE B / VIDEO CONTINUATION MODE

当单次生成时长不足但支持视频续写时，持续扩展同一个视频资产，不分别生成多个成品再合成。

```text
CONTINUATION SEGMENT
- Source Video Asset ID
- Existing Timeline End
- Current Continuity Ledger
- Next Narrative Keyframe
- Transition Path
- Motion Handoff
- Extended Video Asset ID
```

- 每次续写必须以上一次已接受的视频资产为源，不能新建无关视频后再拼接。
- 续写只读取固定 Master State、当前实际状态、下一关键帧和到达它所需的连续路径，不重复全部历史提示词。
- 续写后检查原视频边界附近是否发生冻结、跳切、重绘、动作重启、音画断裂或场景状态漂移。
- 只有续写结果通过检查，才把扩展后的视频资产作为下一次续写来源。

MODE A 和 MODE B 都不可用时停止执行并报告能力限制。不得创建多个独立视频、不得退回尾帧图片接力，也不得提出片段拼接方案。

## 固定工作流

严格按以下顺序推进。

 1. 从用户创意建立 Master State、Visual Asset Bible 和初始 Continuity Ledger。
 2. 建立 `UNIFIED VIDEO TIMELINE`、连续空间路线、摄影机轨迹和 `NARRATIVE KEYFRAME PLAN`。
 3. 检查当前模型能力，只在 MODE A 和 MODE B 中选择生成模式。
 4. 把时间轴拆成内部规划单元，为每个单元定义 START STATE、ACTION、目标 END STATE、HANDOFF、MOTION HANDOFF、SCENE REALISM LAYER 和 REFERENCE MANIFEST。
 5. 在当前生成范围开始前执行 Current-range Failure Analysis。
 6. 展示完整规划、模式选择及其能力依据，然后停止并等待用户明确确认。
 7. 获得确认后，准备当前生成范围所需参考并完成 REFERENCE PREFLIGHT。
 8. MODE A 生成完整长视频；MODE B 生成初始视频或只执行下一次续写。
 9. 检查实际结果，并用真实画面更新 Continuity Ledger 和时间轴完成状态。
10. MODE B 只在续写结果通过后继续扩展同一视频资产。
11. 发现阻断错误时停止后续生成，重做当前失败范围，不用修改后续文字掩盖错误。
12. 当前生成范围通过后展示检查结果，并按确认规则决定是否继续。
13. 完成目标时长后复核整条时间轴并输出统一长视频资产。

规划状态不能覆盖实际视频。只把已经生成、检查并接受的结果写入最新 Continuity Ledger。

## 两道确认门槛

### 规划确认门槛

完成 Master State、Visual Asset Bible、初始 Continuity Ledger、统一时间轴、关键帧计划、模式选择、全部规划单元、REFERENCE MANIFEST 和首次生成范围的 Failure Analysis 后，立即停止输出并等待用户确认。

用户明确回复“确认规划并开始生成”或表达同等明确意图之前，必须遵守以下限制。

- 不得创建视频节点
- 不得生成参考图
- 不得调用视频生成能力
- 不得进入批量生成阶段
- 不得消耗视频生成积分
- 不得把用户最初提交创意的行为视为生成授权

用户要求“先规划”“看看分镜”“检查方案”时，只能停留在规划阶段。

### 逐次续写确认门槛

获得规划确认后，MODE A 只执行一次完整长视频生成；MODE B 一次只执行初始生成或一次视频续写。每次完成后先输出实际 END STATE、连续性检查、更新后的 Continuity Ledger 和当前视频资产状态，然后停止并等待用户确认继续。

用户明确要求自动续写到目标时长时，可以免除逐次续写确认，但规划确认门槛仍然有效。自动模式中任何阻断错误都会立即终止后续生成。

## Master State

Master State 保存跨片段长期固定的信息。不要把当前姿势、临时表情或正在发生的动作写进角色锁定。

使用下面的结构。

```text
MASTER STATE

CHARACTER LOCK
- ID / 名称
- 稳定外貌与体型
- 脸部、发型和肤色
- 固定服装、配饰和识别标记
- 角色参考

PROP DEFINITIONS
- 道具 ID / 名称
- 稳定外观、材质、尺寸和功能
- 初始拥有者与位置
- 是否为核心道具

ENVIRONMENT MAP
- 场景区域
- 区域之间的连接关系
- 门、走廊、楼梯和关键家具位置
- 稳定光源与空间标志

STYLE LOCK
- 影像类型与视觉风格
- 色彩、光线与质感
- 画幅
- 基本摄影机风格
```

### Subject Lock / Character Lock 规则

- 锁定可见的身份特征、服装和配饰。
- 稳定描述保持同一语义，不要在不同 Clip 中随意改写。
- 身份描述和动作分离。走路、奔跑、挥刀、哭泣、紧张等进入当前状态或 ACTION。
- 角色在画面中发生永久变化时，保留原始身份，并把伤势、污渍、衣物损伤等变化写入 Continuity Ledger。
- 有角色参考能力时，相关 Clip 持续使用同一角色参考。

### Prop Lock 规则

- 每件核心道具只对应一个 ID 和一个当前状态。
- 持有者、左右手、位置、朝向、可见性和损坏状态必须明确。
- 道具状态只有在画面中发生交接、放置、损坏、消耗或离场后才能改变。
- 不允许核心道具静默复制、替换、换手、瞬移或消失。

### Spatial Continuity / Environment Map 规则

- 只记录会影响后续动作和镜头的空间事实。
- 明确门通向哪里、走廊方向、房间相邻关系和关键物件位置。
- 人物移动必须符合已建立的连接关系。
- 场景有意变化时，变化应在画面中发生并进入 Environment State。

## Continuity Ledger

Continuity Ledger 保存当前世界状态。每接受一个 Clip 后更新一次。

```text
CONTINUITY LEDGER AFTER GENERATION RANGE [N]

CHARACTER STATE
- 角色所在区域与画面位置
- 姿势、朝向、视线和屏幕方向
- 正在进行的动作与完成程度
- 表情、受伤、污渍和衣物损伤

PROP STATE
- 道具当前拥有者
- 道具所在位置或左右手
- 可见、遮挡、放置或离场状态
- 完整、损坏、启用或消耗状态

ENVIRONMENT STATE
- 当前区域
- 门窗与可移动物件状态
- 应持续存在的环境变化
- Directed Anomaly

CAMERA STATE
- 摄影机位置、高度和朝向
- 景别与主要构图
- 运动方向与运动进度
- 动作轴线一侧、视线关系和屏幕方向

MOTION STATE
- Motion Vector / 人物与关键道具的屏幕运动方向和速度趋势
- Action Phase / 动作正处于准备、发力、腾空、接触、落地或恢复的哪个阶段
- Body Momentum / 身体重心、支撑脚与正在摆动的肢体
- Camera Motion / 摄影机正在平移、后退、推进、环绕或升降，以及是否仍在运动
- Environmental Motion / 衣物、头发、雨、烟、火焰和枝叶等可见动态的方向与趋势

TIME STATE
- 故事内时刻
- 已经过的时间
- 持续动作、倒计时和因果事件进度
```

状态账本只写当前真实状态。不要把以前所有剧情重新叙述一遍。

## 划分时间轴规划单元

- 依据事件和动作阶段划分内部规划单元，不把这些单元分别生成成视频。
- 使用 VARIABLE SHOT DURATION，让规划范围服从事件负载，不要求所有单元等长。
- 每个规划单元只承载一个主要动作或一个清晰动作阶段。
- 动作过多时拆成准备、执行和结果等连续阶段。
- 拆分点应落在容易交接的状态上。优先选择主体可见、动作方向明确、核心道具位置清楚的画面。
- 下一规划单元会用到的人物、肢体、道具或环境元素，应在当前 END STATE 中可见。
- 人物和道具在时间轴中可以自然遮挡或暂时离开画面，不能为了状态继承摆出僵硬姿势。

## 每个时间轴规划单元的合同

规划每个时间轴单元时使用以下结构；实际生成仍然只执行完整长视频或同一视频续写。

```text
PLANNING UNIT [N] / [TOTAL]

VISIBLE SUBJECT SET
- 当前画面可见的 Subject ID
- 当前画面可见的核心 Prop ID

REFERENCE MANIFEST
- 按 Media Role 列出当前角色、服装、场景、道具、风格和连接参考
- 缺失的连续性关键参考

START STATE
- 人物在哪里
- 当前姿势、朝向、视线和运动方向
- 当前速度趋势、身体重心和动作阶段
- 核心道具在哪里，由谁持有，位于哪只手
- 摄影机位置、朝向、景别和运动状态
- 衣物、头发、雨、烟、火焰等可见环境动态
- 当前环境与时间状态

ACTION
- 当前规划单元唯一主要动作
- 动作的自然过程
- 本段允许发生的状态变化

TARGET END STATE
- 人物最终位置、姿势和朝向
- 核心道具最终状态
- 动作完成程度
- 摄影机最终位置和方向
- 环境与时间变化
- 下一段需要可见的元素

HANDOFF
- 下一规划单元必须继承的状态
- 必须继续的未完成动作
- 人物、道具、摄影机和环境动态必须继承的运动方向、速度趋势与动作阶段
- 不得改变的身份、道具、空间和方向
- 下一关键帧或规划单元必须包含的可见信息

CURRENT RANGE FAILURE ANALYSIS
- 当前动作最可能导致的连续性错误
- 针对这些错误的具体生成约束

CURRENT SHOT CAPTION
- 当前可见主体、动作、场景和摄影机的局部描述

SCENE REALISM LAYER
- 当前空间的物理环境与尺度
- 材质、重量、接触和受力反馈
- 人物自然行为与即时反应
- 前景、中景、背景的深度与细微活动
- 光线如何作用于人物、物体和运动
- 当前镜头的导演意图与视觉注意力

GENERATION PROMPT
- 当前模型可直接使用的本段提示词
```

后续规划单元的 START STATE 必须来自上一单元的 END STATE。视频续写时，实际 START STATE 以当前已接受视频的真实结尾为准。HANDOFF 只传递下一范围真正需要的信息，不重复整段历史。

## SCENE REALISM LAYER

连续性约束锁定身份和世界状态，不把人物、摄影机或环境冻结成僵硬摆拍。在写最终生成提示词前，为当前生成范围补充以下可观察信息。

```text
SCENE REALISM LAYER

PHYSICAL ENVIRONMENT
- 空间尺度、地面与空气状态
- 当前天气、光源和可见环境运动
- 与动作真正发生接触的物体

MATERIAL RESPONSE
- 脚步、碰撞、重量、震动和表面反馈
- 衣物、头发、烟、火焰、雨水或尘土如何响应运动

HUMAN BEHAVIOUR
- 呼吸、视线、重心转移和自然的小幅动作修正
- 人物对地形、阻力、声音和事件的即时反应

DEPTH AND ACTIVITY
- 前景、中景和背景各自承担的视觉信息
- 不抢夺主要动作的细微环境活动

LIGHT INTERACTION
- 光线、阴影、反射和遮挡如何随人物与摄影机运动变化

DIRECTORIAL INTENT
- 当前画面希望观众感受到什么
- 摄影机为何这样移动，视觉注意力落在哪里
```

- 只补充既定故事和场景能够容纳的细节，不能增加重要人物、重大事件、改变结局或改写因果。
- 使用具体可见的动作、材质和环境反馈，避免只堆叠“电影级、史诗感、真实感”等抽象形容词。
- 允许自然步态、呼吸、衣物摆动、重心调整和微小的不完全同步。不要要求人物以完美匀速移动或在状态点摆出静止姿势。
- 环境细节必须服从 LOCATION CONDITION ID、TEMPORAL ENVIRONMENT LOCK 和 ENVIRONMENT ELEMENT INVENTORY，不能为了丰富画面改变时间、季节、植物或关键物件。
- 细节数量服从当前动作。不要让背景活动、粒子效果或复杂物理反馈抢夺主体动作。

## Current-range Failure Analysis

在写当前生成提示词前，结合 START STATE、ACTION、目标 END STATE 和 HANDOFF，找出当前段最容易失败的问题。

优先考虑以下风险。

- 角色在当前角度或动作中变脸
- 服装、发型、配饰或伤势漂移
- 核心道具复制、换手、变形或消失
- 动作起点不继承，运动方向突然反转
- 起跳、落地、打击或交接动作提前完成或缺失
- 门、走廊、房间和家具关系变化
- 摄影机跳位、跨轴或视线关系错误
- 下一段所需元素没有进入 END STATE
- 当前视频结尾无法自然支持下一次续写

把最可能发生的少量风险转换成当前生成范围的正向约束和必要的负面提示。不要为全部范围复用一套泛化 Negative Prompt，也不要把此前所有失败项不断累积。

## 生成与实际状态回写

1. 使用统一时间轴、当前生成范围的 START STATE、ACTION、目标 END STATE、HANDOFF 和失败约束生成或续写视频。
2. 检查真实视频，不以提示词中的计划代替画面事实。
3. 记录实际 END STATE。实际结果可接受但与计划略有差异时，以实际结果更新 Continuity Ledger。
4. 实际结果命中阻断错误时，不更新后续计划，先重做当前失败范围。
5. MODE B 的续写结果被接受后，把扩展后的视频 Asset ID 设为下一次续写的唯一来源。

### MOTION HANDOFF CONTRACT

Motion Handoff 用于统一时间轴的相邻规划单元以及 MODE B 的续写边界，确保动作和运镜不会因续写调用而重启。

```text
MOTION HANDOFF
- Motion Vector / 主体和关键道具的运动方向与速度趋势
- Action Phase / 未完成动作所处阶段
- Body Momentum / 重心、支撑点和肢体摆动趋势
- Camera Motion / 运镜类型、方向与速度趋势
- Environmental Motion / 衣物、头发、雨、烟、火焰和枝叶等动态趋势
- First-beat Continuation / 下一续写范围第一个动作节拍必须发生的延续动作
- Motion Binding Status / CONTINUOUS or BLOCKED
```

- 当前视频应优先结束在动作方向清楚且可自然续写的时刻，不为交接强迫人物僵硬定格。
- 下一次续写必须直接扩展同一个视频资产并立即延续 Motion Handoff，禁止静止展示边界画面、重新摆姿势、重新起步、再次蓄力或重复上一动作。
- 人物动作、道具运动、摄影机运动和环境动态不得在边界无理由归零、反向或重新加速。
- 提示词使用可观察的方向、动作阶段和速度趋势，不要求模型执行精确速度、加速度或惯性数值。
- 若当前视频结尾无法表达下一动作方向，应重做当前生成范围的结尾调度，而不是让下一次续写猜测运动。
- 续写后检查边界附近的最初动作节拍。出现明显停顿、动作重启、动作重复、摄影机先停后走或环境动态冻结时，当前续写判定为阻断错误。

## 连续性检查

按以下优先级检查当前生成范围和视频续写边界。

1. 人物身份
2. 核心道具
3. 动作
4. 空间
5. 摄影机方向
6. 风格
7. 普通背景细节

### 必须停止并重做当前生成范围

- 主角明显变脸或身份无法确认
- 核心道具复制、静默替换或无理由消失
- 道具持有者或左右手状态无法衔接
- 上一段动作结果没有被继承
- 人物位置与已建立空间关系完全冲突
- 门、走廊或房间连接关系完全错误
- 摄影机严重跳位、无理由跨越 180 度轴线或运动方向突变
- 人物、道具、摄影机或环境运动在边界明显停顿、重启、重复或无理由归零
- 当前 END STATE 无法自然成为下一 START STATE
- 同一 LOCATION CONDITION ID 从夕阳、白天或其他已锁定时间无理由变成夜景
- 植物种类、季节、密度或颜色发生未经剧情授权的明显变化
- 关键树木、岩石、门、路牌、家具或其他环境锚点无理由消失、增加或换位
- 可移动环境物件没有画面动作却改变位置或状态

发现以上问题时停止后续生成或续写。只重做当前失败范围，并保留此前已经接受的视频资产和状态。

### 可以接受的轻微误差

- 非关键背景纹理变化
- 群众外观和小动作变化
- 不影响剧情和空间理解的小型环境差异

轻微误差可以记录，但不单独触发重生成。

## 摄影机与动作方向

- Camera State 记录摄影机所在动作轴线的一侧。
- 双人场景保持视线关系。一个角色看向画面右侧时，对方反打通常应看向画面左侧。
- 人物在连续动作中保持屏幕运动方向。方向改变时，把转身或摄影机越轴过程展示在画面中。
- 摄影机位置从上一 END STATE 继承。没有明确运动时，保持当前机位和基本构图。
- 上一段动作结果必须进入下一段。起跳、落地、挥击、开门、递交道具和跌倒等动作不能在片段边界重置。
- 不使用精确速度、加速度、惯性或阻尼数值，除非用户明确提供且当前模型确实能够执行。

## 时长模式

### 30 秒以内

优先检查是否能使用 MODE A 一次生成完整视频。允许向模型提供相对完整的 Master State、Continuity Ledger、统一时间轴和适量关键帧。单次能力不满足时只允许切换到 MODE B。

### 30 秒至 2 分钟

优先使用 MODE A；单次时长不足时使用 MODE B 对同一视频分阶段续写。每次续写只读取 Master State、最新 Continuity Ledger、下一关键帧和 Transition Path。以前的剧情通过当前状态和必要因果保留，不逐字重复。

### 2 至 5 分钟

必须采用状态化生成，并使用 MODE B 持续扩展同一视频。每个续写范围只读取以下内容。

- 固定 Master State
- 当前 Continuity Ledger
- Current Planning Unit
- 下一段所需 HANDOFF
- 下一 Narrative Keyframe 与 Transition Path

不要在后续生成范围中重复此前全部剧情、全部提示词或每个旧规划单元的详细记录。

## 类型规则

### 恐怖与 Cult

区分 Directed Anomaly 与 Generation Error。剧情明确要求的异常进入 Environment State，并在后续继承。照片里按剧情多出一个人属于 Directed Anomaly。床的位置随机改变、门无理由换墙或核心道具复制属于 Generation Error。

### 动作片

额外追踪人物位置、武器、左右手持物、运动方向、起跳和落地阶段、衣物损伤与受伤状态。高速动作和运镜不能掩盖道具唯一性或动作因果错误。

### 动漫

允许夸张动作、形变、速度效果和激烈运镜。角色身份、武器唯一性、空间方向和动作因果保持为硬约束。

## 最终输出

开始生成前，先向用户展示以下规划内容。

1. Master State
2. Visual Asset Bible 和需要准备的参考资产
3. 初始 Continuity Ledger
4. UNIFIED VIDEO TIMELINE、连续空间路线和摄影机轨迹
5. Narrative Keyframe Plan 及各关键帧之间的 Transition Path
6. MODE A 或 MODE B 的选择及当前能力依据
7. 规划单元及其 START STATE、ACTION、目标 END STATE、HANDOFF、MOTION HANDOFF、SCENE REALISM LAYER 和 REFERENCE MANIFEST
8. 当前生成范围及其 Failure Analysis

输出以上规划后必须立即停止，并明确询问用户是否“确认规划并开始生成”。不要在同一次响应中创建节点、生成初始视频或执行续写。

MODE B 每次续写后输出扩展后视频 Asset ID、实际 END STATE、关键帧到达情况、连续性检查和更新后的 Continuity Ledger。随后询问用户是否确认继续；阻断错误出现时立即停止。

达到目标时长后，输出统一长视频 Asset ID 和全片连续性复核结果。不生成独立 Clip，也不执行片段拼接。