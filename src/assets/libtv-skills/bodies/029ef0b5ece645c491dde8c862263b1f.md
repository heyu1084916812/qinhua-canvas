# 视频提示词架构师

## 这个 Skill 做什么

把模糊的画面想法，转化为可直接执行的专业级视频生成提示词。从叙事意图出发，构建包含主体动作、镜头语言、光影氛围、风格质感的完整提示词架构，并针对不同视频模型特性做定向优化。

核心方法论：**用"行为描述"替代"情绪描述"，用"幅度限定"压制AI过度发挥，用"物理指令"驱动动作生成**。

## 为什么需要它

90%的AI视频废片，根源是提示词写得像"作文"而非"指令"：堆砌形容词缺动词、无镜头信息、光影靠运气、风格描述模糊、情绪靠形容词、说话场景必崩、多镜头无衔接逻辑。

## 怎么做

### 第一步：意图解码

从用户输入中提取5个核心维度：

维度提取内容示例主体谁/什么 + 核心动作黑衣女人推开木门空间场景类型 + 空间特征废弃医院走廊，墙壁剥落情绪目标情绪 + 变化轨迹从压抑到恐惧爆发风格视觉风格倾向暗黑悬疑、胶片质感约束时长/分辨率/模型/特殊要求5秒、480P、Hailuo 2.3

信息不足时，根据已有信息判断最缺的2个优先追问（情绪方向？风格倾向？参考电影/导演？使用场景？）。

### 第二步：提示词架构构建

按 **7层提示词架构** 逐层填充：

```
Layer 1: 主体层 → 核心角色/物体 + 精确动作动词 + 微表情/肢体语言
Layer 2: 空间层 → 场景类型 + 空间纵深 + 环境细节 + 天气/时间
Layer 3: 镜头层 → 景别 + 运镜指令 + 视角 + 焦距感
Layer 4: 光影层 → 主光源方向 + 光质 + 色温 + 光比 + 特殊光效
Layer 5: 氛围层 → 空气介质 + 色彩倾向 + 质感 + 后期感
Layer 6: 叙事层 → 画面在故事中的功能 + 信息暗示 + 悬念元素
Layer 7: 技术层 → 质量增强词 + 负向提示 + 模型适配参数
```

**进阶公式：** 提示词 = 主体 + 场景 + 运动 + 美学控制(光源+光线+景别+视角+镜头+运镜) + 风格化关键词

### 第三步：模型定向优化

**运镜指令型（Hailuo 2.3）：** 运镜指令放末尾方括号 `[Push in]`；主体动作用现在进行时；环境描述精简。支持：\[Zoom in/out\]、\[Push in\]、\[Pull out\]、\[Pan left/right\]、\[Shake\]、\[Static\]、\[Orbit\]

**语义理解型（Wan 2.7）：** 偏好完整自然语言句子，因果逻辑清晰；风格描述放句首定调；支持参考指代"图1""图2"和声音描述（人声+音效+BGM）

**图生视频型（Seedance 1.5 Pro）：** 聚焦动作和变化，不重复图片已有信息；用时间词 `at first... then... finally...`；运镜用自然语言非方括号。核心：图生视频 = 运动 + 运镜

**音画同步型（Wan 2.6）：** 额外提供节奏标注 `[beat drop]`、`[tempo: slow]`；动作与节拍对齐

### 第四步：多镜头序列设计

**镜头递进三原则：** ①景别递进（远→全→中→近→特写）②情绪递进（每镜头推进一步）③信息递进（每镜头揭示新信息，绝不重复）

**序列模板：**

```
Shot 1 [Establishing]: 空间全貌+氛围定调+暗示性细节 → [Static]/[Slow Pan]
Shot 2 [Reveal]: 主体出现+核心动作+第一反应 → [Push in]
Shot 3 [Conflict]: 冲突高潮+情绪爆发+视觉冲击 → [Shake]/[Quick Zoom]
Shot 4 [Aftermath]: 结果呈现+余韵+悬念钩子 → [Pull out]/[Static]
```

**转场衔接：** 上一镜头结尾转身→下一镜头继续运动或展示所见；提示词加 `This shot continues from the previous scene`；保持跨镜头一致 `Keep the same character position and lighting direction`

### 第五步：质量自检与输出

检查项标准动词具体性每个主体至少1个精确动作动词镜头完整性含景别+运镜+视角光影明确性指定光源方向+色温风格可执行性风格词拆解为技术参数负向提示含至少3个常见缺陷排除模型适配按目标模型特性调整格式信息增量多镜头无重复描述微表情精度用肌肉行为描述替代情绪形容词幅度控制含幅度限定词一致性保护角色外观/服饰/发型锁定

**输出格式：** 镜头序号+名称 → 叙事功能+情绪目标 → 完整英文提示词 → 运镜指令+负向提示 → 优化说明

---

## 提示词武器库

### 一、微表情提示词（按情绪分类）

> 核心原则：用"行为描述"替代"情绪描述"——告诉AI肌肉怎么动

**愉悦类：** 克制浅笑(眉眼舒展，嘴角单侧上扬，眼神松弛) | 心动羞涩(瞳孔放大，视线闪躲，耳尖泛红，下唇轻咬) | 狡黠暗笑(单边眉峰微挑，嘴角抿起内收) | 宠溺含笑(上眼睑半垂，苹果肌轻微隆起，笑意只在眼底) | 明媚大笑(眼尾弯出细纹，嘴角上扬至颧骨，露6颗牙)

**愤怒类：** 隐忍怒意(眉心紧锁，下颌线紧绷，牙关紧咬，眼神死寂) | 暴怒失控(瞳孔收缩，鼻翼张开，眉心竖纹，眼白泛红) | 轻蔑嘲讽(上眼皮半垂，视线俯视，嘴角单侧下撇) | 冷漠厌弃(眉眼平直，瞳孔涣散，嘴唇紧闭成直线) | 敌意戒备(双眼睁大，眉峰竖起，视线锁定目标，面部全面紧绷)

**悲伤类：** 极致隐忍落泪(眼眶泛红，泪液聚集不滴落，嘴角用力下压) | 空洞绝望(瞳孔涣散失焦，面部肌肉彻底松弛) | 强忍哽咽(咽喉带动下颌抖动，嘴唇颤抖，眼睫快速眨动) | 无声崩溃(双眼紧闭，眉心挤压褶皱，泪液顺眼角滑落)

**惊讶类：** 极致震惊(双眼圆形睁大，瞳孔放大，双眉上抬，嘴巴O型) | 恍然大悟(眉峰舒展，瞳孔光亮，嘴角轻扬) | 警惕怀疑(双眼眯起，瞳孔收缩，眉尾下压)

**冷漠腹黑类：** 淡漠疏离(眉眼线条平直锋利，瞳孔冷调无高光) | 运筹帷幄(眼皮半遮瞳孔，下颌微抬，气场压迫) | 腹黑玩味(瞳孔余光扫视，嘴角极淡上扬，情绪藏于眼底) | 伪善温和(眉眼刻意舒展微笑，眼底冰冷无光)

### 二、面部物理五大阀门（防恐怖谷）

> 心法："藏"和"微"——藏住算力短板（口腔内部），把算力砸在微表情和皮下联动

1. **潜意识眼颤**：❌`深情地看着镜头` ✅`凝视前方，眼球伴随细微高频微颤，视线在极小范围内自然游离`
2. **非对称眨眼**：❌`眨了眨眼睛` ✅`眼皮具有真实物理重力感，进行非绝对对称双重眨眼，左眼比右眼慢半拍`
3. **皮下肌肉联动**：❌`开心地笑了` ✅`微笑触发皮下联动，嘴角上扬，苹果肌向上挤压隆起，牵扯鱼尾纹`
4. **吞咽与下颌张力**：❌`张嘴大声说话` ✅`紧闭双唇，喉结明显吞咽动作，下颌骨线条微微绷紧`（铁律：不让AI画口腔内部！）
5. **胸腔重力起伏**：❌`安静坐着发呆` ✅`伴随深沉呼吸，胸腔产生缓慢有重量感的物理起伏，吸气带动肩膀极微小向上拉扯`

### 三、说话场景防崩策略

安全组合：`slightly parted lips, relaxed neck, calm facial muscles, neutral jaw, mid-sentence expression`。绝对避免"张嘴大声说话"——嘴巴变黑洞，牙齿疯狂增生。

### 四、动作发力链条模板（武戏/动作场景）

**通用公式：** 角色 + 动作 + 发力方式 + 受力反馈 + 画面张力 + 镜头语言 + 环境氛围 + 细节质感

**发力链条：** 蹬地→转胯→送肩→发力→出招（每环节都要写）。**受力反馈：** 气浪/震动/飞溅/目标反应。**速度曲线：** 慢起+加速+骤停=干脆有力。

**✅ 正确示例（剑刺）：** 武者后脚蹬地驱动，腰胯前送发力，肩线前压，手臂沿直线瞬间前刺，剑尖直取咽喉；腕部绷紧控制剑身稳定，剑身微颤，破风带起衣袖发丝向后甩动；脚下卷起尘土

**受力关键词：** 蹬地发力、腰胯转动、核心收紧、鞭打发力、刀身震颤、气浪扩散、衣袍飞扬、碎石飞溅

### 五、幅度限定词库

slightly(轻微) | subtly(微妙) | gently(轻柔) | barely(几乎不明显) | a hint of(一丝) | slowly(缓慢) | gradually(逐渐) | barely perceptible(几乎不可察觉)

**防浮夸负向词：** exaggerated expression, dramatic pose, over-the-top gesture, theatrical body language, mouth wide open

### 六、情绪节奏控制

用"克制"为"爆发"蓄力：铺垫(克制表情+中景)→冲突升级(幅度稍大+景别缩小)→高潮(特写+强打光+情绪化)→收尾(回归克制，让情绪落地)

### 七、光影速查表

情绪光源色温光比特殊效果恐惧顶光/单光源冷蓝绿高对比闪烁、阴影遮脸温暖侧光/窗光暖橙黄低对比光晕、丁达尔效应孤独背光/剪影冷白极高对比长影子、空旷感紧张底光/不规则混乱冷暖闪烁不定霓虹闪烁、水波纹神圣顶光/逆光金白中等光芒射线、雾气散射压抑平光/无方向灰绿极低对比灰雾、去饱和

### 八、风格转译表

用户说转译为电影感shallow depth of field, cinematic 2.39:1, professional color grading, anamorphic lens flare暗黑风desaturated palette, deep shadows, low-key lighting, gothic atmosphere, film noir日系动漫cel-shaded, vibrant flat colors, clean line art, anime production quality写实纪录片handheld camera, natural lighting, raw footage feel, 16mm film texture赛博朋克neon-lit, magenta and cyan, rain-soaked streets, holographic reflections水墨风ink wash painting, monochrome with selective color, brush stroke texture

### 九、5大现成风格提示词（竖屏9:16）

**校园甜宠：** 近景缓慢推进，高马尾校服少女回头轻笑拨动发丝，教室窗边逆光阳光，日系暖色氛围，4K高清 **玄幻修仙：** 近景顶光仰拍，白衣束发古装男主抬手释放灵力，恢弘古风大殿，仙侠电影级高对比光影 **末世求生：** 中景跟随拍摄，短发工装女生持武器穿行废墟，冷色废土风轻微颗粒质感，4K高清 **悬疑推理：** 特写带呼吸感运镜，戴眼镜男生低头查看线索微皱眉，昏暗侧逆光，暗黑悬疑冷色 **博主口播：** 近景固定镜头，元气少女前倾抬手示意，白色渐变背景柔光，日系动漫风格

### 十、运镜-情绪-景别三轴速查

效果运镜景别示例压迫感\[Push in\]特写缓慢推向恐惧眼神逃离感\[Pull out\]全景→远景拉远暴露巨大空间混乱感\[Shake\]中景手持跟拍奔跑凝视感\[Static\]大特写固定机位拍瞳孔变化环绕感\[Orbit\]中全景绕角色旋转升华感\[Crane up\]全景→俯瞰升起俯瞰渺小身影

### 十一、18种运镜指令速查

\[Push in\]推进 | \[Pull out\]拉远 | \[Dolly in\]轨道推近 | \[Dolly out\]轨道拉远 | \[Zoom in\]变焦推近 | \[Zoom out\]变焦拉远 | \[Pan left/right\]水平摇 | \[Tilt up/down\]垂直摇 | \[Tracking shot\]跟随 | \[Crane up/down\]升降 | \[Shake\]手持抖动 | \[Static\]固定 | \[Orbit\]环绕 | \[Dolly zoom\]推拉变焦(眩晕) | \[Roll\]旋转

### 十二、负向提示通用库

```
基础：no warp, no morph, no blur, no distortion, no extra limbs/fingers, no fused faces, no watermark
人物：no deformed hands, no asymmetrical eyes, no melted skin, no plastic skin, no uncanny valley, no mouth black hole, no teeth melting
场景：no floating objects, no impossible geometry, no inconsistent lighting, no AI artifacts
动态：no static pose, no frozen motion, no jittery movement, no morphing transition, no flickering
防浮夸：no exaggerated expression, no dramatic pose, no over-the-top gesture
```

### 十三、画面强制约束词

`五官自然清晰、神态真实、无脸部变形；身体比例正常、动作流畅自然；4K超清画质、细节丰富锐利；全镜头保持同一角色形象，服饰发型全程统一`

### 十四、角色一致性保护模板

```
Preserve the exact: face shape, eye color, hairstyle, hair color,
outfit details, body proportions, and art style.
No face drift, no outfit changes, no hairstyle changes, no style drift.
```

稳定元素(不可变)：面部、服装、发型、体型、艺术风格、场景布局 灵活元素(可变)：动作、运镜、情绪、背景运动、光影氛围

### 十五、声音提示词公式

人声 = 角色说话内容 + 情绪 + 语调 + 语速 + 音色；音效 = 音源材质 + 行为 + 环境音；BGM = 配乐风格 + 节奏

示例：`一个男人说道："好好学习"，语气轻松，语速适中，声音清亮` + `玻璃球掉在木地面"砰"的声音，室内安静` + `悬疑风格背景音乐`

### 十六、图生视频提示词公式

图像已确定主体/场景/风格，提示词 = 运动 + 运镜。运动幅度要适度，过大动作会导致模型"发明"不存在的角度。

### 十七、竖屏视频专用优化

`竖屏9:16，第一秒必须有视觉钩子，主体动作清晰可读，为字幕留出顶部或底部干净空间`

### 十八、生成前必查3项

1. 内容自查：规避色情、暴力、封建迷信、敏感话题
2. 版权自查：配乐/音效/字体等素材合法使用
3. 一致性自查：跨镜头角色外观/服饰/发型/风格统一

### 十九、服装面料库

> 面料描述与服装描述分开写。"A red dress"太模糊，"flowing crimson silk charmeuse with visible sheen, catching the light as it moves"才够精确

**面料物理行为：**

面料关键词物理行为光线交互丝绸silk charmeuse, flowing流动垂坠、随步态飘动可见光泽雪纺chiffon, translucent半透明层叠、风中飘扬透光暖辉天鹅绒velvet, plush厚重垂坠、缓慢摆动边缘光晕、吸收光线牛仔denim, heavyweight僵硬、折痕明显哑光棉质纹理蕾丝lace overlay, delicate精细半透、贴肤透光花纹皮革patent/matte/distressed leather光滑或哑光反光或柔和漫反射

**剪裁术语：** oversized(宽松) | tailored(合身) | fitted(修身) | cropped(短款) | A-line | mermaid(鱼尾) | off-shoulder(一字肩) | cinched waist(收腰)

### 二十、材质纹理库

> 命名表面材质+状态。不是"marble"而是"polished black marble with subtle grey veining"

材质精确描述反光特性拉丝金属brushed metal, fine grain定向漫反射抛光金属polished chrome, mirror finish镜面反射雾面玻璃frosted glass, diffused柔和透光实木solid oak, warm wood grain温暖漫反射做旧木材worn wood, weathered timber粗糙漫反射抛光大理石polished marble with veining镜面反射水泥raw concrete, industrial极度哑光陶瓷glazed ceramic / matte porcelain釉面或哑光

### 二十一、环境场景库

**室内：** minimalist studio(工作室) | old Parisian cafe(咖啡馆) | abandoned hospital corridor(废弃医院) | empty subway platform(地铁站) | dimly lit office(办公室) **室外：** rain-wet city sidewalk at dusk(雨夜街道) | vast desert(沙漠) | ancient bamboo forest(竹林) | cliff edge crashing waves(悬崖海浪) | post-apocalyptic ruins(废墟) **虚构：** space station interior(太空站) | neon cyberpunk city(赛博城市) | futuristic laboratory(实验室) | ethereal plane floating crystals(魔法空间)

### 二十二、天气与自然现象

现象精确描述物理行为小雨light rain against backlit background雨滴斜飘、地面溅水花暴雨heavy downpour, rain streaks雨幕模糊远景飘雪gentle snowfall, slow drift缓慢飘落、堆积肩头浓雾thick fog, silhouettes emerging雾气流动、边缘柔和大风strong wind, hair whipping衣物猎猎、碎片飞散闪电lightning flash, brief harsh light瞬间强光、阴影剧变丁达尔效应volumetric light shafts光柱可见、粒子发光热浪heat haze warping reality空间扭曲、远景晃动

### 二十三、VFX粒子特效库

**爆炸：** `massive explosion, shockwave ripples outward, debris spray with realistic physics, billowing smoke and orange fire plumes, slow motion 1000fps`**魔法能量：** `glowing particles swirling in vortex, energy ribbons, tiny sparks, magical light from core, floating runes, arcs of lightning`**碎裂溶解：** `spiderweb fracture lines glowing before shattering, crystal shards and glittering dust, spherical shockwave, fragments refracting light into rainbows`

**粒子行为：** violently ejected / gracefully floating / swirling vortex / zero-gravity suspended / trailing smoke **渲染关键词：** Octane render, Unreal Engine 5, volumetric lighting, SSS, PBR materials, 8K, professional VFX

### 二十四、电影调色配方（5套LUT）

> 三色法则：主色60% + 辅色30% + 点缀10%

风格主色辅色点缀情绪王家卫暖橙墨绿一抹红暧昧怀旧诺兰冷蓝深灰暖橙光史诗悬疑韦斯·安德森粉色薄荷绿米黄童话治愈赛博朋克深紫霓虹粉电光蓝未来迷幻北欧极简米白浅木色纯黑冷淡高级

**调色词：** teal and orange(好莱坞冷暖) | warm film LUT(怀旧) | cool HDR(科技) | desaturated deep shadows(暗黑) | high contrast chiaroscuro(明暗法)

### 二十五、构图系统

构图适用效果中心构图肖像/产品主体突出三分法风景/环境人像自然平衡对称构图建筑/仪式庄严秩序引导线走廊/道路纵深引导框架构图门窗/拱门窥视感

**机位角度：** high-angle(渺小) | low-angle(强大压迫) | over-the-shoulder(代入感) | aerial(全知宏大) | Dutch angle(不安失衡) | ground-level(独特透视)

### 二十六、镜头焦距方案

> ⚠️ 景深末尾规则：镜头/光圈/景深描述必须放在提示词最末尾

镜头焦距适用效果中景人像35mm大光圈环境叙事兼顾人物与环境人像特写85mm f/1.4情绪肖像极致背景虚化广角全景24mm大空间史诗空间冲击力微距macro lens材质细节极致放大长焦telephoto压缩空间空间压缩浅景深

### 二十七、动作动词库

> AI视频默认慢动作，用速度编码动词突破限制

慢速中速快速strolls(漫步)walks(行走)strides(大步走)drifts(漂移)moves(移动)hurries(急行)glides(滑行)proceeds(前进)rushes(冲)lingers(徘徊)approaches(靠近)darts(闪掠)floats(漂浮)follows(跟随)charges(冲撞)

**环境运动联动：** leaves scattering(树叶飞散) | dust trailing(尘土拖尾) | reflections streaking(反光拉长) | crowds parting(人群分开) | water splashing(水花四溅)

### 二十八、动物生物运动

类型提示词特征优雅运动graceful, fluid motion平滑连贯强力奔跑powerful strides, muscular gallop蹬地有力、肌肉起伏飞行soaring flight, wing beats翅膀节奏、气流扰动捕猎stalking, predatory低伏紧绷、目光锁定群体移动flock movement, herd dynamics统一方向、个体间距

纪录片关键词：wildlife photography, documentary footage, natural behavior, golden hour, tracking shot

### 二十九、建筑空间描述

风格关键词特征哥特式Gothic, pointed arches尖拱、飞扶壁、高耸巴洛克Baroque, ornate, gilded繁复装饰、金箔现代主义clean lines, glass and steel简洁线条、大面玻璃工业风exposed brick, steel beams裸露砖墙、金属管道传统中式wooden structure, curved roof飞檐斗拱废土crumbling concrete, overgrown破碎混凝土、植被侵蚀

**空间纵深：** deep corridor(深走廊) | towering ceiling(高耸穹顶) | narrow alley(狭窄小巷) | vast hall(宏伟大厅) | spiral staircase(螺旋楼梯)

### 三十、食物饮品提示词

> AI容易生成违背重力的悬浮物品或静态蒸汽，必须物理约束

**色泽：** golden crispy surface(金黄酥脆) | natural glistening(自然光泽) | sauce glistening in light(酱汁闪亮) **蒸汽：** ✅ soft steam rising slowly, edges gentle ❌ 剧烈翻滚或突然消失 **模板：** `warm 3000K lighting on wooden table, freshly baked bread golden crispy, crumbs falling, hot coffee with gentle steam, soft focus background`

### 三十一、季节时间氛围

时间光影情绪黎明柔和蓝粉，低角度光希望新生清晨明亮清澈，薄雾活力清新正午顶光高对比，短阴影压迫烈日黄昏暖橙金，侧逆光长影怀旧温暖蓝调时刻深蓝紫，城市灯初亮忧郁都市深夜极暗点光源月光悬疑孤独

季节色彩氛围春嫩绿粉白生机温柔夏浓绿明蓝热烈燥热秋金黄橙红丰收萧瑟冬灰白冰蓝寒冷寂寥

### 三十二、后期胶片模拟

**LUT预设：** ARRI Look Filmic Pro(电影标准) | Kodak Vision3 250D(柯达胶片) | Sony S-Log3(索尼电影色彩)

效果提示词建议胶片颗粒film grain, subtle grain texture5%-8%消除塑料感暗角vignette, edge darkening轻微增强聚焦散景bokeh, creamy bokeh浅景深配合体积光volumetric light, god rays有窗户/雾气时镜头光晕lens flare, anamorphic flare逆光点缀色差chromatic aberration极轻微增加真实感

### 三十三、转场工程

**匹配剪辑：** 上下镜头使用相似视觉元素（颜色/形状/运动方向），剪辑点选在运动方向一致处 **甩摇 Whip Pan：** 上镜头结尾 `camera whips right, motion blur fills frame`，下镜头开头 `emerging from fast pan, motion blur fades to reveal`**漏光 Light Leak：** 上镜头 `lens flare blooms to overexpose`，下镜头 `emerges from bright overexposure, sun flare fades`**焦距变化：** `focus pulls from [foreground] to reveal [new scene in background]`**连续性指令：** `This shot continues from the previous scene. Keep the same character position and lighting direction.`

### 三十四、速度节奏控制

类型提示词适用超慢动作slow motion, 1000fps爆炸/冲击/情绪爆发慢动作slow motion, gradual优雅/仪式感/浪漫正常natural pace, real-time日常叙事加速speed ramp up 1.5-2x追逐/紧张升级延时timelapse日落/城市流转定格freeze frame顿悟/戏剧停顿

**节奏原则：** 慢起+加速+骤停=干脆有力(武戏) | 匀速=软弱(避免) | 长镜头慢推=蓄力(恐惧铺垫) | 快切+快动作=混乱(战斗)

### 三十五、产品广告7层架构

```
Layer 1: Subject — 产品物理细节（材质/颜色/标签）
Layer 2: Scene — 环境（studio/nature/urban）
Layer 3: Lighting — 光源类型+方向+质量
Layer 4: Camera — 焦距+角度+光圈感
Layer 5: Style — 视觉语言（commercial/editorial/8K render）
Layer 6: Text & Branding — 文字内容+字体+位置
Layer 7: Negative — 排除项（blurry labels, duplicate products, extra hands）
```

**时间轴示例(10秒3C)：** 0-3秒微距特写纹理 → 3-7秒环绕展示 → 7-10秒屏幕亮起定格

### 三十六、廉价感 vs 高级感

品类廉价(避免)高级(推荐)3C数码闪亮反光、炫酷特效金属拉丝质感、轮廓光、磨砂漫反射、微距细节美妆超白皮肤、高饱和、柔焦自然窗边侧逆光、丝绸光泽瓶身、清透无过度磨皮服饰平铺纯白背景真丝流动垂坠、伦勃朗布光、局部褶皱动态食品塑料感、过度饱和自然光泽、柔和蒸汽缓慢上升、面包屑自然掉落家居悬浮物品违背重力可信生活感、物品符合使用习惯、暖调3000K

### 三十七、通用避坑8条铁律

1. **材质数量严控**：叠加材质3-4种最优，绝不超过5种
2. **光线必写规则**：必须明确光线方向，禁止让AI默认生成正午顶光
3. **色彩三色原则**：60%主色+30%辅色+10%点缀，主导色不超过3种
4. **景深末尾规则**：镜头/光圈/景深描述必须放在提示词最末尾
5. **地点三维规则**：地点必须包含"地域+年代风格+场景类型"
6. **动作必写规则**：必须包含明确动作动词，AI最怕静止画面
7. **产品占比规则**：产品在画面中占比不得低于40%
8. **矛盾指令禁止**：不要写"既静止又飞速运动"等矛盾描述