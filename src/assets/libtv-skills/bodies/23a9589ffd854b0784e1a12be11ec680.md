## name: photorealistic-public-art-generator description: 生成超写实（Photorealistic）环艺装置、公共雕塑、建筑艺术、沉浸式空间等方向的图像提示词。融合传统与现代材质，强制无AI感、无3D渲染器感，输出摄影级写实指令。参考腾讯文档案例库、小红书、Pinterest、gooood等平台。 version: 2.0.0 product SzdsAI,WX:13776086896

SKILL：超写实环艺装置·公共艺术生成器

# SKILL定位与核心能力

## 本SKILL专注于通过用户输入的关键词，生成超写实（Photorealistic） 级别的环艺装置、公共雕塑、建筑艺术、沉浸式空间等方向的图像提示词。核心能力覆盖：

造型语言：几何抽象、有机仿生、解构重组、参数化、模块化

材质系统（传统+现代） ：

传统材质：大理石、青铜、花岗岩、汉白玉、砂岩、陶土、木材、玻璃钢（FRP）

现代材质：耐候钢、不锈钢、亚克力、聚碳酸酯、张力膜材、玻璃纤维增强混凝土（GRC）、3D打印塑料、回收复合材料

空间关系：室内/室外/半开放/沉浸式/地景融合

氛围调性：未来感/自然主义/工业风/梦幻感/极简/叙事性/新古典

## 核心输出标准——超写实（无AI味）

所有生成的图像提示词必须强制导向超写实输出，禁止任何AI生成感、3D渲染器感、动画感。

### 强制风格指令（必含）

photorealistic, hyper-realistic, cinematic realism, 8K, shot on Sony A7R IV, 85mm lens, f/2.8, natural lighting,micro-surface detail, real-world material fidelity,no CGI look, no stylized rendering, no 3D render aesthetic

### 负面提示词（必用）

3D render, CGI, computer generated, stylized, cartoon, animation, low poly, video game graphics, Unreal Engine look, V-Ray look, render farm aesthetic, artificial lighting, over-saturated, blurry, low resolution, distorted, unstable structure, extra limbs, unreasonable perspective, cluttered, chaotic, AI-generated artifacts

### 渲染技术说明

为实现超写实效果，提示词中应引导使用以下技术路径（作为生成平台的参数参考，而非在提示词中赘述）：

路径追踪（Path Tracing） ：实现物理级精确的光线反弹与阴影

次表面散射（Subsurface Scattering） ：真实模拟大理石、玉石、皮肤、半透明材质的透光感

微表面细节（Micro-surface Detail） ：呈现木材纹理、金属拉丝、石材颗粒等真实触感

## 提示词标准框架

基于超写实公共艺术图像生成的最佳实践，提示词采用 “超写实锚定 + 主体描述 + 材质系统 + 环境背景 + 视角构图 + 光影调性 + 参数控制” 的七段式结构： \[超写实锚定\] + \[主体描述\] + \[材质系统\] + \[环境背景\] + \[视角构图\] + \[光影调性\] + \[参数控制\]

框架拆解： 模块 功能 关键词示例 超写实锚定 强制锁定写实输出风格 photorealistic, hyper-realistic, cinematic realism 主体描述 定义装置的核心造型、结构逻辑 模块化堆叠、螺旋曲面、竹编骨架、几何体块 材质系统 定义装置所用材料（传统+现代） 大理石、青铜、耐候钢、花岗岩、玻璃钢、木材 环境背景 设定装置所处的空间与场景 城市广场、草地公园、湖畔步道、商业中庭 视角构图 控制观看角度与画面构成 广角远景、鸟瞰俯视、人视平视 光影调性 定义光线氛围与色调 黄昏柔光、清晨薄雾、阴天漫射、金色时刻 参数控制 出图质量与格式约束 8K、摄影写实、电影级光影

## 关键词体系（分类词库）

1. 造型语言关键词 类别 关键词 几何抽象 模块化堆叠、参数化曲面、多边形体块、放射状结构、网格壳体、柏拉图立体 有机仿生 螺旋生长、波浪起伏、叶片脉络、羽翼层叠、花瓣展开、漩涡形态、生物膜结构 解构重组 碎片化拼接、错位叠加、框架镂空、张力布面、折叠展开、构成主义 线性构成 编织曲面、竹篾交错、金属杆件、丝带缠绕、线性节奏、连续曲面
2. 材质系统关键词（传统+现代全面覆盖） 类别 关键词 天然石材 大理石（Carrara/Statuary）、花岗岩（白麻/灰麻）、汉白玉、砂岩、石灰石、板岩 金属材质 青铜铸造、不锈钢（镜面/拉丝）、耐候钢（Corten）、铝合金、黄铜、锻铁、镀金 木材/植物 原木松木、橡木、胡桃木、竹材、藤编、回收原木 陶瓷/玻璃 陶瓷马赛克、高温陶板、玻璃砖、吹制玻璃、琉璃 复合材料 玻璃钢/FRP、玻璃纤维增强混凝土（GRC）、碳纤维、3D打印塑料 混凝土/水泥 清水混凝土、绿色混凝土、彩色混凝土、磨石子 织物/膜材 张力膜（PTFE/ETFE）、半透布面、纤维绳、高韧度聚酯纤维 回收/可持续 回收塑料、废弃木材、再生玻璃、环保复合材料
3. 空间环境关键词 类别 关键词 城市空间 城市广场、商业中庭、街道转角、屋顶花园、地铁站前、机场大道 自然场地 草地公园、湖畔步道、森林空地、海边草坪、山地缓坡、湿地边缘 建筑语境 博物馆前广场、艺术馆庭院、历史建筑院落、工业遗存、校园空间
4. 风格调性关键词 类别 关键词 未来/科技 未来感、参数化、数字梦境、光流体、机械理性、科幻现实主义 自然/生态 自然主义、地景融合、生态诗意、生长感、有机形态、可持续设计 梦幻/诗意 梦幻氛围、超现实、漂浮感、光影叙事、沉浸式、诗性几何 古典/永恒 新古典、永恒感、纪念碑性、庄严、时间感、历史厚重 工业/极简 工业美学、解构主义、极简主义、粗野主义、构成主义

## 风格参考库（基于案例库+新材料拓展）

### 传统材料风格（经典公共艺术）

风格 核心材质 核心关键词 参考案例 古典纪念碑风 青铜、花岗岩、大理石 青铜铸造、花岗岩基座、纪念碑性、庄严叙事、历史厚重 《四海同心》花岗岩+钢结构；《问勇》青铜+花岗岩 新古典雕塑风 汉白玉、大理石、青铜 汉白玉雕刻、大理石基座、古典比例、永恒感、人文叙事 丝路公园艺术品（汉白玉、大理石基座） 陶瓷马赛克风 陶瓷、玻璃马赛克、抿石子 陶瓷马赛克拼贴、高温陶板、色彩镶嵌、公共艺术墙面 台北公共艺术（陶瓷马赛克、高温陶板）

### 现代材料风格（前沿公共艺术）

风格 核心材质 核心关键词 参考案例 参数化壳体风 穿孔金属板、GRC、不锈钢 连续曲面、穿孔表皮、双曲面、参数化设计、镂空光影 《时间塔》（青铜+不锈钢+耐候钢+铝+大理石） 耐候钢工业风 耐候钢、锈钢板、混凝土 耐候钢锈蚀质感、工业美学、粗野主义、构成主义、大地艺术 耐候钢公共雕塑 膜结构轻盈风 PTFE/ETFE膜、钢索、铝框 张力膜结构、半透明、漂浮感、张拉整体、轻量化 Echelman雕塑（高韧度聚酯纤维+编程LED） 玻璃钢/FRP风 玻璃钢、树脂、涂料 FRP雕塑、轻质高强、曲面成型、色彩涂装、户外耐候 熊猫公共艺术（玻璃钢坯胎）

### 材料融合风格（传统+现代混合）

风格 核心材质 核心关键词 参考案例 木构编织风 木材/竹材+金属节点 竹篾编织、原木构架、金属节点、自然材料、手工感 台风倒木再生装置（回收原木+三维扫描重构） 石材+金属混搭风 花岗岩+不锈钢/耐候钢 石材与金属拼接、材质对比、永恒与现代、地标性 《四海同心》（花岗岩+钢结构） 回收材料可持续风 回收塑料、3D打印、光纤 可持续设计、3D打印、回收材料、光艺术、生态意识 《珊海微光》（回收塑料3D打印+光纤）；环生座椅（回收塑料3D打印） 玻璃+金属轻透风 玻璃/亚克力+金属框架 透明与反射、轻质结构、光影穿透、现代简约 《云中的气泡树》（玻璃+铝膜+3D泡沫PVC）

## 标准提示词模板（超写实版）

模板一：公共艺术雕塑（室外·城市广场） \[超写实锚定\] Photorealistic, hyper-realistic, cinematic realism, \[主体\] 一座由\[几何模块/有机形态/解构体块\]构成的\[材质\]公共艺术雕塑，\[造型特征描述\]，表面带有\[纹理/穿孔/雕刻/渐变\]细节 \[材质\] \[主材\]为主材，\[辅材\]作为\[基座/连接件/装饰\] \[环境\] 置于\[城市广场/公园绿地/湖畔步道\]之中，周围有\[建筑/树木/水面\]作为背景 \[视角\] \[广角远景/人视平视/鸟瞰俯视\]，\[具体视角描述\] \[光影\] \[黄金时刻/黄昏柔光/清晨薄雾/阴天漫射\]，\[光影效果描述\] \[参数\] 8K, shot on Sony A7R IV, 85mm lens, natural lighting, physically-based rendering, real-world material fidelity, no CGI look

\*\*\* 示例应用：\*\*\* Photorealistic, hyper-realistic, cinematic realism. A monumental public art sculpture composed of interlocking geometric volumes, crafted from polished white marble with subtle veining, mounted on a solid granite base. The sculpture features a spiraling upward composition with precision-cut facets that catch and reflect natural light. Situated in a grand urban plaza surrounded by contemporary glass-and-steel skyscrapers. Wide-angle establishing shot, golden hour warm sunlight casting long dramatic shadows across the plaza floor. 8K, shot on Sony A7R IV, 85mm lens, natural lighting, physically-based rendering, real-world material fidelity, no CGI look.

模板二：沉浸式装置（室内·展览空间） \[超写实锚定\] Photorealistic, hyper-realistic, museum-quality documentation, \[主体\] 一个由\[悬挂/堆叠/编织\]方式构成的\[材质\]空间装置，\[结构逻辑描述\]，形成可\[穿行/停留/互动\]的沉浸式体验 \[材质\] \[主材\]为主体结构，\[辅材\]用于\[连接/装饰/照明\] \[环境\] 位于\[美术馆展厅/商业中庭/品牌快闪空间\]内，\[顶部/地面/墙面\]处理为\[材质/色彩\] \[视角\] \[人视穿行/仰视/轴测\]，\[具体视角描述\] \[光影\] \[顶部天光/人工聚光/漫射光\]，\[光影效果描述\] \[参数\] 8K, cinematic lighting, photorealistic render, physically-based materials, real-world scale, no 3D render aesthetic

\*\*\* 示例应用：\*\*\* Photorealistic, hyper-realistic, museum-quality documentation. A suspended spatial installation composed of hundreds of translucent amber-colored acrylic panels arranged in a spiraling wave formation, each panel precision-cut with laser-etched patterns, suspended from ultra-fine stainless steel cables. The installation forms a walk-through immersive experience where visitors can traverse the spiral pathway. Located in a contemporary art museum's main hall with a dramatic barrel-vaulted glass ceiling allowing natural daylight to filter through the amber panels, casting warm dappled light patterns on the polished concrete floor below. Human-eye-level perspective walking through the installation. 8K, cinematic lighting, photorealistic render, physically-based materials, real-world scale, no 3D render aesthetic.

模板三：建筑化装置（半室外·过渡空间） \[超写实锚定\] Photorealistic, hyper-realistic, architectural visualization quality, \[主体\] 一座以\[设计概念\]为核心的\[构筑物类型\]，由\[结构系统\]构成，\[形态特征\] \[材质\] \[主材\]构建主体结构，\[辅材\]用于\[细节/连接/表面处理\] \[环境\] 坐落于\[场地类型\]，与\[自然/城市\]环境形成\[对比/融合\]关系 \[视角\] \[特定视角\]，\[具体构图描述\] \[光影\] \[自然光环境\]，\[光影与材质的互动描述\] \[参数\] 8K, architectural photography style, physically-based rendering, real-world material authenticity, no stylized rendering

\*\*\* 示例应用：\*\*\* Photorealistic, hyper-realistic, architectural visualization quality. A pavilion-scale art installation conceived as a "woven timber canopy," constructed from an intricate lattice of steam-bent hardwood strips interwoven with polished stainless steel nodes. The structure rises in a double-curved shell form, with openings that frame views of the sky. Situated in a public park beside a reflective lake, the warm timber tones contrast harmoniously with the surrounding greenery and water. Human-eye-level perspective from the lakeside, capturing the pavilion's reflection in the still water. Overcast soft daylight emphasizing the rich wood grain and metal node details. 8K, architectural photography style, physically-based rendering, real-world material authenticity, no stylized rendering.

## 参数控制体系

### 超写实强制参数

参数类型 推荐值 说明 分辨率 8K / 超高清 保证细节呈现 渲染引擎参考 Path Tracing / Lumen 物理级光线追踪 镜头模拟 Sony A7R IV / Canon EOS R5 真实相机色彩科学 焦段 35mm（环境）/ 50mm（人视）/ 85mm（细节） 真实摄影焦段 光照 Natural Lighting / Golden Hour / Overcast 自然光效

### 视角参数

视角 适用场景 说明 广角远景 展示装置与环境的整体关系 强调场地融合与尺度感 人视平视 展示装置的人体尺度与互动感 最具代入感的视角 鸟瞰俯视 展示装置的平面布局与空间逻辑 适合参数化、模块化装置 仰视 展示装置的高度感与结构张力 适合高耸塔状装置

### 负面提示词（完整版）

3D render, CGI, computer generated imagery, stylized rendering, cartoon style, animation style, low poly, video game graphics, Unreal Engine aesthetic, V-Ray aesthetic, render farm look, artificial flat lighting, over-saturated colors, blurry textures, low resolution, pixelated, distorted geometry, unstable structure, unreasonable perspective, extra limbs, anatomicalerrors, cluttered composition, chaotic arrangement, AI-generated artifacts, deepfake quality, plastic-looking surfaces

## 参考来源

本SKILL的知识体系与案例参考来源于以下渠道：

### 社交媒体与设计平台

小红书（xiaohongshu.com） ：搜索“公共艺术”、“环艺装置”、“艺术雕塑”、“公共雕塑”等关键词，获取国内外最新公共艺术案例与设计解读、Pinterest（pinterest.com） ：搜索“public art installation”、“sculpture”、“environmental art”、“land art”等关键词，获取高质量视觉参考

### 专业设计网站

谷德设计网（gooood.cn） ：搜索“公共艺术”、“装置”、“雕塑”等关键词，获取中英双语的专业公共艺术项目案例、公共艺术官方平台：各城市公共艺术官网（如台北公共艺术网、台中公共艺术网等），获取正式落成的公共艺术品信息

### 国际公共艺术资讯

Association for Public Art：国际公共艺术协会案例库、Janet Echelman Studio：著名公共艺术家官网，展示大型纤维装置艺术、Metalocus：国际建筑与公共艺术平台

### 搜索指令参考

在执行SKILL时，可指导智能体进行以下搜索以获取最新案例参考： "公共艺术" + "装置" + "2025/2026" "环艺雕塑" + "公共空间" + "案例" "public art installation" + "2025" "site:gooood.cn" + "公共艺术" + "装置" "site:xiaohongshu.com" + "公共艺术" + "雕塑" "site:pinterest.com" + "public art sculpture" "当代公共艺术" + "传统材料" + "现代材料"

## 应用示例：从关键词到完整超写实提示词

### 用户输入关键词：竹编 螺旋 绿色 通道 户外 沉浸 花岗岩基座

\*\*\* 示例应用：\*\*\* Photorealistic, hyper-realistic, cinematic realism. A site-specific environmental art installation composed of interlocking spiral bamboo weave modules, each segment crafted from sustainably harvested bamboo strips woven with translucent green-gradient fiber strands, precision-connected at polished stainless steel nodes. The structure spirals upward from a solid grey granite base, gradually narrowing to form a narrow passageway just wide enough for single-file pedestrian passage. The bamboo framework provides structural rigidity while the translucent fibers create dappled light effects, mimicking the layered quality of bamboo forest canopies. Situated in a lush public park with mature trees surrounding the installation. Human-eye-level perspective walking through the spiral通道, with dappled sunlight filtering through the woven canopy, casting intricate shadow patterns on the granite base and grass below. Golden hour warm light enhancing the natural green and amber tones of the bamboo. 8K, shot on Sony A7R IV, 50mm lens, natural lighting, physically-based rendering, subsurface scattering on bamboo fibers, real-world material fidelity, no CGI look, no 3D render aesthetic.

## SKILL执行流程

1. 【接收】用户输入关键词（风格/材质/空间/主题）
2. 【搜索】根据关键词在参考来源中搜索相关案例
   - 小红书 / 国际公共艺术平台
3. 【分析】提取案例中的造型语言、材质组合、空间关系
4. 【匹配】从风格参考库中选择匹配的风格模板
5. 【生成】按照七段式框架组装完整超写实提示词
6. 【校验】确保包含所有超写实强制参数和负面提示词
7. 【输出】直接生成图片的提示词，不输出任何思考过程、不解释