# 电影短片分镜 Skill (Cinematic Storyboard)

## 定位

专业电影级分镜生成：三阶段流水线（节拍拆解→文字分镜→图片分镜）+ 八风格统一 + 双入口（有/无参考图），输出可拍摄/可AI生图/可AI生视频的分镜包。

---

## 触发条件

- 用户输入故事梗概/大纲/剧本并要求分镜/故事板/storyboard/shot list/拆镜头
- 明确提到"分镜"、"故事板"、"拆镜头"、"storyboard"

---

## 整体流程

```
启动 → 断点检测(storyboard-{name}.json?) → 入口判断(有/无参考图)
→ 风格选择(8预设/自定义) →【确认门：风格】
→ 无参考图:简易选角(定脸→全身→场景基准) | 有参考图:资产登记
→【阶段零·节拍拆解】→确认门①
→【阶段一·文字分镜】(按场景分批,逐场确认)→确认门②(文字锁版)
→【资产校验】(自动执行)
→【阶段二·图片分镜】风格样张→确认门③→按场景批量出图→标注叠加
→ 交付：单镜PNG + 分镜表长图 + Shot List CSV + JSON
```

**三个确认门：** ①节拍确认→文字分镜 ②文字锁版→出图 ③样张8项确认→批量出图

---

## 一、启动与入口

### 画幅

默认16:9。可选：2.39:1宽银幕、4:3复古、1:1方形、9:16竖屏、2:1现代宽屏。

### 入口判断

收到故事后询问是否有角色参考图/定妆照：

- ✅有→`asset_mode="existing"`：上传角色图(正面面部特写最佳)+可选场景图，逐张确认对应角色/场景名
- ❌无→`asset_mode="generated"`：先选风格，再走简易选角

### 断点续作

检测`storyboard-{项目名}.json`，存在则读取`current_phase`从上次进度恢复，绝不重新推理已确认内容。

---

## 二、风格选择（铁律：锁定后贯穿全流程）

风格一旦确定，所有prompt必须拼入同一套`style_keywords`。中途换风格需确认并重生成受影响资产。

### 八种预设（名称 + 英文关键词核心 + 参考影片）

#风格核心英文关键词参考影片1写实电影感cinematic realism, natural lighting, 35mm film grain, natural color temperature, anamorphic lens, subtle lens flare, organic tones《海边曼彻斯特》《罗马》《小偷家族》2赛博朋克霓虹cyberpunk aesthetic, neon-drenched, rain-slicked streets, volumetric neon light, magenta and electric blue palette, high contrast, holographic reflections, chromatic aberration《银翼杀手2049》《攻壳机动队》《爱死机·证人》3黑白黑色电影film noir, black and white, high contrast chiaroscuro, hard shadows, venetian blind patterns, dramatic low-key lighting, smoky atmosphere, monochrome, deep blacks, silver halide grain《第三人》《马耳他之鹰》《罪恶之城》4日系清新Japanese naturalism, soft diffused natural light, muted pastel tones, airy atmosphere, slight overexposure highlights, shallow DOF, natural skin tones, subtle green and beige是枝裕和《海街日记》、岩井俊二《情书》5暗调悬疑dark thriller aesthetic, low-key lighting, desaturated cool palette, teal and burnt orange muted contrast, deep shadows, minimal practical lighting, David Fincher inspired, desaturated greens芬奇《七宗罪》《消失的爱人》、维伦纽瓦《囚徒》6暖调复古warm vintage cinema, golden amber tones, Kodachrome-inspired, warm orange and sepia palette, heavy film grain, lens flare warm, nostalgic atmosphere, 1970s look, faded film stock《花样年华》《请以你的名字呼唤我》《月光男孩》7冷调科幻cold sci-fi, sterile futuristic palette, steel blue and cool gray, harsh geometric lighting, clinical white light, Denis Villeneuve inspired, atmospheric haze, volumetric light beams, anamorphic widescreen维伦纽瓦《降临》《沙丘》、《机械姬》8梦幻超现实dreamlike surreal, ethereal atmosphere, soft focus, colored gel lighting, romantic bokeh, Wong Kar-wai inspired saturated tones, impressionistic color, hazy luminous quality, anamorphic bokeh王家卫《重庆森林》、《穆赫兰道》、《生命之树》

自定义风格：从用户描述提取导演/色调/光影/质感/时代词，映射为英文keywords，生成确认卡。

### 风格锁定写入JSON

`style.mode`, `style.name`, `style.keywords`(数组), `style.description`, `style_confirmed=true`

---

## 三、简易选角（generated模式，风格锁定后）

流程：识别角色→描述确认→逐角色定脸图→逐角色全身图→逐场景基准图→写入JSON

**与纯白底选角的核心区别**：背景用电影风格化虚化背景（非纯白），打光按风格匹配，产出定脸+全身（不产六视图/九宫格），所有资产拼入style_keywords。

### 定脸图Prompt结构

```
[CHARACTER]年龄+Chinese+气质+脸型+五官+皮肤
[OUTFIT]角色造型
[STYLE]{style.keywords}
[PORTRAIT LIGHTING]按风格映射(见附录D)
[COMPOSITION]cinematic portrait close-up, tight head and shoulders, slight 3/4 turn, shallow DOF(85mm),
  blurred stylized background matching film style (NOT pure white), proper headroom
[NEGATIVE]pure white background, studio backdrop, ID photo, flat lighting, cartoon, anime, deformed, blurry, extra fingers
```

确认后提炼FACE LOCK英文段落写入`character_assets[].face_lock`。

### 全身图Prompt结构

```
[身份引用]以定脸资产为身份参考，同人物，保持脸型五官一致，从头生成
[BODY]正常头身比+身材量感+姿态气场
[OUTFIT]与定脸一致的完整服装
[POSE]电影自然姿态(非证件站姿)
[STYLE]{style.keywords}
[ENV]stylized cinematic background, softly blurred, NOT pure white
[LIGHTING]同定脸
[COMPOSITION]full body cinematic shot, head to toe feet visible, shallow DOF
[NEGATIVE]pure white background, T-pose, stiff ID pose, cartoon, deformed, blurry face
```

### 场景基准图Prompt

```
[SCENE]地点+时间+氛围+关键视觉元素
[STYLE]{style.keywords}
[CINEMATIC]establishing shot, wide shot, empty location or distant silhouette only, spatial layout, clear lighting direction
[LIGHT DIRECTION]明确主光方向
[COLOR TEMPERATURE]明确主色温
[COMPOSITION]cinematic wide establishing shot, rule of thirds, {aspect_ratio}
[NEGATIVE]people in clear focus, foreground characters, text, watermark
```

记录：scene_id、base_ref_path、scene_keywords、light_direction、color_temperature

---

## 四、节拍拆解（阶段零）

### 输入自动判断粒度

1. 一句话梗概(≤50字)→完整节拍拆解；2. 大纲(50-300字)→参考大纲；3. 集纲(300-1000字)→直接提取场景；4. 剧本片段→提取场景/人物/台词+情绪标注

### 内部推理步骤

1. **节拍密度**：快节奏(动作/惊悚)8-15镜/场，单镜1.5-3s；中节奏(剧情)5-10镜/场，3-5s；慢节奏(文艺)3-6镜/场，5-10s+
2. **叙事结构**：三幕式/非线性(标注跳跃点)/POV(全片≤15%)/一镜到底(标注隐藏剪辑点)
3. **情绪曲线(0-10)**：每场标入场→出场情绪值；差值≥4=情绪爆发场(需节点镜)；全局须有起点钩子(≥6)、中段峰值(≥9)、结尾落点
4. **开场钩子(前3镜必完成，禁纯环境开场)**：视觉冲击/悬念异常/情绪爆破/动作切入/信息炸弹 — 五选一
5. **场景划分+转场预设**：场景名/内外景/时间/情绪/镜数/时长；转场大类：硬切(默认70%+)/匹配剪辑/叠化/J-L-Cut/特殊转场(全片≤2-3个)
6. **Beat分配硬约束**：每beat最少1镜≤该场40%；情绪峰值beat≥3镜(建压→峰值→释放)；过场≤2镜
7. **风格对齐**：摄影基调关键词必须与style_keywords一致

### 输出格式(每场)

```
【场N】{场景名}·{日/夜}|{内/外}景
  情绪：{入}→{出}(差值X)|约Xs/X镜
  Beat1：{事件}(情绪功能：建立/建压/悬念/反转/释放/情感/信息揭示/节点高潮/过场)
  出场角色/关键道具/摄影基调关键词
  → 转场至场N+1：{类型}，匹配点：{具体描述}
```

情绪功能标签：建立/建压/悬念/反转/释放/情感/信息揭示/节点高潮/过场

确认门①：用户确认/修改后进入文字分镜。

---

## 五、文字分镜（阶段一·核心）

按场景分批输出(每次1个场景)，逐场确认后继续。全局镜号S{场号}-{镜号}。

### A. 镜头运动体系

**速度三档**：极慢Slow(心理压迫/呼吸节奏)、常规Normal(叙事默认)、快速Fast(动作/惊吓)

**组合规则**：单镜最多2种运动("+"连接)，禁止三运动组合。固定镜头可加"微晃"(手持呼吸感)。

**运动功能速查**：

运动英文戏剧功能推dolly/push in注意引导/逼近真相/情绪聚焦：慢推=不安积累,快推=惊吓拉dolly/pull out揭示环境/孤独/反讽：慢拉=沉思孤独,快拉=惊吓揭示摇pan/tilt展示空间/跟随视线/揭示画外：**终点必有信息落点,不做空摇**移tracking/trucking平行叙事/旁观者/空间漫游：与步速匹配跟follow shot沉浸跟随/紧张：前跟=对峙亲密,后跟=探索未知升降crane/jib权力变化/上帝视角/宏大揭示：上升=超脱,下降=压迫陷落手持handheld纪实/不安/临场：晃动幅度∝情绪强度;**前后必有固定镜头对比**斯坦尼康steadicam流畅优雅/梦境/仪式感：比手持稳定,长镜常用航拍drone/aerial宏大开场/孤独：**全片≤2-3个**长镜头long take沉浸真实/时间完整：**内部须有调度变化;全片≤2个;&gt;15s才算**固定locked off观察感/冷静/休止符：**占全片60%以上**

字段格式：`运动：极慢推(Slow Push In)` 或 `运动：手持跟拍(Normal)+缓升(Slow Crane Up)` 或 `运动：固定(Locked Off)，微呼吸晃`

### A1. 构图语言

**基础构图8法**(按需选用，标注在画面描述中)：

构图英文戏剧功能典型场景三分法rule of thirds叙事默认，主体放交叉点，视线朝引导方向留空日常对话/行走/常规叙事镜对称构图symmetrical composition, centered framing权力/仪式/压迫/完美/荒诞(韦斯·安德森感)仪式/对峙/权力高位/精神异常/餐厅对坐框架构图frame within frame, shot through {window/doorway/mirror/foreground bars}隔离/窥视/画中画/被围困/观察门外偷听/镜中反打/窗内看雨/监狱/监视引导线leading lines, {corridor/road/railing/path} converging to subject强制视线聚焦主体，纵深感，运动势走廊追人/道路独行/铁轨/楼梯纵深前景深度foreground element out of focus, layered depth fg-mg-bg增加空间层次/窥视感/主观视角肩后过前景/树叶虚化/门缝/玻璃雨滴留白negative space, subject on {left/right} third facing open space孤独/沉思/自由/未完成/开放结局人物望海/独坐空房间/背影远景/结局镜荷兰角dutch angle, tilted frame, canted composition不安/失衡/疯狂/世界颠倒，**限节点用≤3-5个/片**惊悚发现/醉酒/眩晕/世界崩塌瞬间俯/仰权力extreme high angle(looking down)/low angle(looking up)俯=渺小无助被俯视;仰=权力压迫英雄感俯拍尸体/崩溃蹲下;仰拍反派/英雄觉醒

**基本空间规则**：

- 头顶空间(headroom)：人物头顶留画面10-15%，忌顶天立地或头顶空太多
- 鼻前空间(noseroom/looking room)：人物视线方向留画面1/3空白，运动方向前方同样留空
- 运动入画/出画：主体从画外进入→前一镜运动方向留足空白;出画后留0.5-1s空镜给观众消化
- 三层纵深：中景以上(MS→EWS)尽量安排前景虚化+中景主体+背景环境，避免"贴纸片"感
- 均衡vs失衡：日常/安全/温情用视觉均衡(主体居中或对称);不安/转折/失控用失衡(主体压边/重量偏一侧/荷兰角)

**景别构图要点**：

- ECU：只拍眼睛/嘴/手/物件细节，完全省略环境，焦点=唯一信息
- CU/MCU：人物头部/胸部填满画面，眼睛放上方1/3线，背景虚化为色块
- MS/MCU双人：两人分占左右1/3，中间留有呼吸空间;正反打OTS时过肩人物占前景1/4虚焦
- FS/WS：人物全身占画面60-80%，脚不切帧(留地面空间)，用环境交代人物处境
- EWS/WS建立镜：三分法地平线(天2地1=开阔/天1地2=压抑)，人物占比≤30%传递渺小/自由
- POV：严格模拟人眼视野，轻微前景遮挡(窗框/自己的肩/头盔边缘)增加主观沉浸感

### B. 转场体系

**12种转场**：硬切(70%+)、叠化(时间/梦境,禁对话衔接,≤1-2连叠)、淡入淡出(开头结尾/大跳)、J-Cut(声音提前1-2s)、L-Cut(声音延后1-3s)、匹配剪辑(须标注匹配点：形状/动作/颜色/声音)、动作衔接(前30-50%切,后70-100%续)、跳切(传统叙事禁用,全片≤3-4)、甩镜、黑白屏闪、定格、分屏

**5条硬规则**：

1. 80%+用硬切+J/L-Cut
2. 叠化间至少隔3个硬切
3. 非硬切必须有叙事/情绪理由
4. 第1镜淡入,最后一镜淡出
5. 匹配剪辑必须写匹配点

字段格式(必填)：`转场：硬切` 或 `转场：J-Cut|说明：下一场电视声提前1.5s`

### C. 12条节奏硬规则（核心）

 1. **开场钩子**：第1镜是钩子本身,3镜内完成"为什么继续看"。禁"先建环境再出故事"
 2. **景别呼吸**：禁连续3镜以上同景别。对话正反打每4-5组插反应镜/空镜/特写
 3. **180度轴线**：对话正反打严禁越轴。合法越轴：刻意制造混乱(须标注)/人物移动/骑轴镜头过渡
 4. **节点高潮**：峰值镜三条件同时满足——①时长≥前后均值2倍 ②景别为该场极端值 ③前后有建压+释放镜。禁止剪碎
 5. **动静对立**：连续3运动镜后≥1固定镜;连续5固定镜插1运动镜;手持段落结束后必须稳定镜头"落地"
 6. **剪辑节奏**：建压加速(时长逐镜递减20-30%,景别收紧)→峰值骤停(5-8s)→释放缓冲(4s+长镜)。喜剧：快-快-快-停
 7. **POV规则**：必须"谁在看→看到什么→反应"三段式;全片≤15%
 8. **静默镜头**：每15-20镜安排1个无台词空镜/背影/道具特写,3-6s,必须有机融入
 9. **一镜一信息**：每镜只承载1个核心信息点/情绪功能
10. **视线引导**：每镜标注视线落点;连续镜次视线方向合理衔接
11. **声音先行**：每5-8镜≥1个J-Cut/L-Cut
12. **呼吸点**：每3-5分钟短片有1个呼吸段落(3-5个4s+长镜,无强冲突)

### D. 字段结构

**必填字段**：镜号|场景标签|景别(大远景/远景/全景/中全景/中景/中近景/近景/特写/大特写)|角度(平视/俯拍/大俯拍/仰拍/大仰拍/过肩/POV/荷兰角/顶拍)|镜头运动|焦距景深(广角&lt;35mm/标准50mm/中长焦85mm/长焦&gt;100mm)|画面描述(构图+人物+光线+道具+环境)|台词/旁白|情绪/戏剧功能|时长建议(0.5s精度)|视线落点(v3必填)|转场方式(v3必填)

**选填字段**：摄影备注(慢动作/长镜调度)|光线设计(来源/色温/质感)|色彩基调|声音设计|关键道具|演员调度|特效提示|匹配点(匹配剪辑时必填)|video_prompt_en

### E. 单镜输出格式示例

```
━━━ S01-03 ━━━
场景：内景·苏晚公寓玄关·夜
景别：大特写 | 角度：俯拍(轻微)
运动：极慢推(Slow Push In)
焦距/景深：中长焦85mm,浅景深,焦点从门把手移至门缝鞋尖
画面描述：苏晚的手悬在黄铜门把手上,指节泛白。玄关灯未开,门缝下漏出暖橙光线打在指缝间,隐约可见红色高跟鞋鞋尖——不是苏晚的尺码。
视线落点：门把手→门缝鞋尖(焦点转移)
光线：门缝暖光(≈2700K)为主,周围极暗,低调照明
色彩：冷蓝暗调,门缝暖橙为唯一暖色源
台词：苏晚(VO,低语)："他说今晚加班……"
声音：极远电视声(预示J-Cut),金属微响,加重呼吸
情绪/功能：悬念→建压
时长：4s
关键道具：黄铜门把手/门缝光线/红色高跟鞋鞋尖
转场：J-Cut|下一场电视声提前1.5s进入
演员调度：手微微颤抖后停住,不推门,屏住呼吸
video_prompt_en: "Slow push in, extreme close-up, slight high angle, 85mm shallow DOF, woman's pale hand hovering over brass doorknob, knuckles white, warm orange light leaking from under door, red high heel tip visible through gap, low-key lighting, cold blue darkness surrounding warm accent, 35mm film grain, 4 seconds, 16:9. Transition: J-cut distant TV bleeds 1.5s."
```

### F. 情绪→镜头语言映射速查

情绪景别倾向运动时长转场建立大远景→全景→中景(由远及近)缓推/缓摇/固定3-5s从容硬切/开头淡入建压逐镜收紧向特写递进手持微→强/慢推递减4→3→2→1.5s硬切加速/Jump Cut悬念特写/POV/过肩/局部细节极慢推/固定/微晃2-4s延迟揭示硬切/L-Cut暗示威胁反转极端跳变(最小↔最大)突然运动→骤停骤停3-5s匹配剪辑误导→硬切揭示释放全景/远景开放构图慢拉/上升/固定长镜5-8s较长叠化/硬切开阔情感近景/特写面部/双人构图固定/极缓推/斯坦尼康4-6s硬切/慢动作+长停信息揭示特写(信息载体)/焦点转移rack focus/固定/极慢推2-3s干净硬切/匹配剪辑节点高潮极端景别(大特写或大远景)慢动作/完全静止/剧烈手持5-10s峰值停顿前:快切加速 高潮:骤停 后:硬切释放/叠化余韵过场空镜/中景简洁带过固定/横移/叠化压缩1-2s快带**叠化最常用**/硬切/淡入淡出

### 确认门②规则

- 逐场确认：通过→下一场;修改→改后重输该场;支持插镜/删镜/调序/改运动
- 全部场景确认后输出完整分镜清单(镜号+概括+时长+功能)+总时长统计
- "文字锁版"→`text_locked=true`，进入资产校验

---

## 六、资产校验（文字锁版后自动执行）

1. 扫描全镜出场角色名单
2. existing模式：检查用户资产覆盖+文件可读；generated模式：检查character_assets(face/fullbody/face_lock非空)+scene_refs覆盖
3. 风格一致性：所有资产style_keywords包含全局核心词；用户白底图vs电影风格→提示风险(可重生成电影版/继续用原图)
4. 输出校验报告→`assets_verified=true`后进入图片分镜

---

## 七、图片分镜（阶段二）

### Step1：风格样张(8项确认清单)

只出第1镜作为样张,确认前绝不批量出图。逐项确认： □色调/色温 □对比度 □胶片质感 □景深 □角色还原度 □光线逻辑 □构图 □画幅 不确认→调对应prompt维度重出;确认后`style_sample_confirmed=true`。

### Step2：Prompt拼接铁律(顺序固定)

```
[1] CHARACTER LOCK: face_lock原封+参考图(每入镜角色)
[2] LOCATION CONSISTENCY: same location/lighting/color/layout(非该场景首镜时)
[3] SCENE: visual_description英文翻译
[4] CINEMATOGRAPHY: 景别/角度/焦距/运动英文词
[5] LIGHTING + COLOR TONE
[6] STYLE: style.keywords全量+cinematic color grading(每镜必带)
[7] ASPECT RATIO
[8] NEGATIVE: blurry, deformed hands, extra fingers, low quality, overexposed, cartoon, anime, pure white background, ID photo, studio backdrop
```

**style_keywords注入铁律**：任何生图prompt(定脸/全身/场景/分镜)必须拼入keywords。 **角色一致性**：每镜前置\[CHARACTER LOCK\]+垫入定脸图；每10镜抽查一致性。

### Step3：镜头语言→英文Prompt速查

**景别**：大远景extreme wide shot(EWS)|远景wide shot(WS)|全景full shot(FS)|中全景medium long shot(MLS/cowboy)|中景medium shot(MS,waist-up)|中近景medium close-up(MCU/chest-up)|近景close-up(CU/head-shoulders)|特写tight close-up|大特写extreme close-up(ECU)|建立镜头establishing|双人two-shot|过肩OTS|群像wide group|插入镜insert shot

**角度**：平视eye-level|俯拍high angle|鸟瞰bird's-eye/extreme high|仰拍low angle|大仰拍extreme low/worm's-eye|过肩OTS|POV first-person|荷兰角dutch/tilted|顶拍top-down/zenithal|3/4侧面three-quarter|正面centered/frontal|框中框frame within frame

**焦距**：广角wide angle deep DOF|标准50mm natural|中长焦85mm shallow DOF bokeh|长焦telephoto 135mm+ extremely shallow|变形anamorphic lens flare oval bokeh

**光影**：自然光natural window light|黄金时刻golden hour|蓝调blue hour|月光moonlight silver-blue|霓虹neon cyan/magenta rim|烛光candlelight warm flicker|台灯practical lamp tungsten 2700K|荧光灯fluorescent cool white overhead|伦勃朗Rembrandt triangle cheek|侧光split lighting half shadow|逆光backlit silhouette rim light halo|顶光top overhead eye-socket shadow|底光underlighting uplight eerie|柔光soft diffused overcast|硬光hard direct sharp shadows|体积光volumetric god rays crepuscular

### Step4：静态图标注规范

- 推/拉：同心箭头+虚线框;摇/移：边缘方向箭头;跟拍：运动轨迹线;升降：侧边箭头;手持：抖动线;焦点转移：虚/实圆圈A→B;慢动作：标"Slow Motion 120fps"+动势模糊;固定：不标注
- 半透明白/灰细线+小字放边缘，不遮挡面部和核心信息，一镜≤2种运动，总占比≤8%

### Step5：分镜图布局

```
┌─────────────────────────────────────┐
│S01-03│                          │ ← 镜号左上(半透黑底白字3%高)
│      │      [画面区域]             │
│      │   →(运动箭头,若有)          │
│                 3.5s│大特写       │ ← 时长+景别右下
│ 台词内容(字幕条,底部1/6)            │ ← 台词/VO
└─────────────────────────────────────┘
```

人物在底部时字幕条放顶部。

### Step6：场景基准镜机制

- 每个场景第一个出图镜头=场景基准镜
- 后续该场景镜头引用基准图做垫图：same location, same lighting direction, same color temperature, same spatial layout

### Step7：按场景批量出图+确认门③

逐场景生成;通过→下一场;单镜重出→调prompt不改文字;改景别/运动等→回退文字分镜修改。

### 交付物

1. 单镜PNG：`storyboard-{项目名}-S{场}-{镜}.png`
2. 分镜表长图：每场横向拼合多格
3. Shot List CSV：镜号/场景/景别/运动/时长/台词/备注

---

## 八、AI视频Prompt（可选模式）

格式：

```
[Shot S{场}-{镜}]
{运动英文}, {景别}, {角度}, {焦距}, {画面描述英文}, {光线}, {色调风格}, cinematic, {时长}s, {aspect ratio}
Transition: {转场英文}
```

硬规则：时长精确到0.5s;运动描述放最前(模型首词权重高);禁止自由描述角色外貌(引用face_lock);转场单独一行末尾;追加负面词：`blurry, deformed, extra limbs, bad anatomy, low quality, oversaturated, watermark, text, subtitles`

---

## 九、数据持久化要点

**目录**：`{项目}/storyboard-{名}.json` + `assets/(char_*_face.png, char_*_fullbody.png, scene_*_base.png)` + `storyboard-output-*/(S01-01.png..., storyboard-sheet-{场}.png, shotlist.csv)`

**JSON核心字段**：schema_version("3.0"), project_name, style({mode,name,keywords,description}), asset_mode("existing"/"generated"), aspect_ratio, character_assets(\[{character_id,name,face_ref_path,fullbody_ref_path,face_lock,confirmed}\]), scene_refs(\[{scene_id,scene_name,base_ref_path,light_direction,color_temperature,confirmed}\]), current_phase("entry"→"style_select"→"asset_generation"→"beat"→"text"→"asset_check"→"image"→"complete"), beat_sheet\[\], shots\[\], beat_confirmed, text_locked, style_confirmed, assets_verified, style_sample_confirmed

---

## 附录A · 自检清单精华

**节拍层(7)**：开场钩子3镜内?|情绪曲线有≥9峰值?|结尾落点合理?|密度匹配类型?|转场有理由?|总镜数/时长在约束内?|高差值场有足够镜头?

**逐镜(18)**：3镜内钩子|禁3连同景别|对话不越轴|节点镜三条件(时长×2+极端景别+建压/释放)|3运动后有静止/5固定后有运动/手持后有落地|建压递减+峰值骤停+释放|POV≤15%且三段式|每15-20镜有静默|一镜一信息|视线落点标注且衔接合理|每5-8镜有J/L-Cut|有呼吸段落|每镜标转场(特殊有理由)|禁三运动组合|&gt;10s有理由|台词≤30字否则拆|同场景光线一致|出场角色有引用

**图片(10)**：样张8项全过|角色面部一致(垫定脸图)|场景空间一致(引基准图)|景别/角度/焦距与文字一致|光线方向一致|运动标注不遮挡|叠加≤8%|画幅正确|无AI错误(多指/变形)|服装/道具连贯

**全片(8)**：情绪曲线走完|无疲劳段(&gt;10镜无变化)|30秒留住人|结尾有余味|特殊转场≤20%|时长偏差≤20%|无"漂亮无功能"镜|角色弧线有视觉表达(首尾对照)

---

## 附录D · 各风格定脸打光速查

风格PORTRAIT LIGHTING写实电影感soft natural window light, rembrandt lighting, subtle ambient fill, warm skin tones, gentle catchlights赛博朋克dual neon rim lights (magenta left, electric blue right), dark background, colored accent lights on cheekbones, no frontal fill黑白黑色hard directional side light, venetian blind shadow patterns, deep shadow opposite side, high contrast chiaroscuro日系清新soft diffused overcast daylight from large window, gentle backlight hair glow, no harsh shadows, luminous even skin暗调悬疑single practical light from 3/4 side angle, half face in deep shadow, desaturated cool skin, minimal fill暖调复古warm golden hour side light raking across face, amber temperature, anamorphic lens flare, soft warm shadows冷调科幻cool geometric LED panel from above and side, blue/cyan tint on skin edges, clinical sharp key light, cold rim light梦幻超现实mixed colored gel lighting (warm red/pink one side, cool green/blue other), soft diffusion, haze, ethereal backlight halo自定义根据keywords推断warm/cool/dark/bright/soft/hard/neon组合