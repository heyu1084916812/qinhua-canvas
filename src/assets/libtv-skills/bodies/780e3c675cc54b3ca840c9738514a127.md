# Character Design Asset Workflow

## Core Methodology

### 1. Triple-Path Output Logic

本工作流采用**三路并行生成**架构,从单一输入源(角色肖像)产出三类互补资产:

- **Path A: 脸部三视图** — 固定横版布局,正面+四分之三侧面+纯侧面三视角水平并排,用于建立角色脸部的空间形态锚点
- **Path B: 精修肖像图** — 保持原始构图的竖版输出,应用统一质感提示词提升细节保真度
- **Path C: 人物设计单** — 全身九头身比例视图+细节拆解标注,白底竖版,Character Design Sheet 标准格式

三路共享**同一套质感基底提示词**,确保输出风格统一,同时通过构图/视角/信息密度差异实现功能互补。

### 2. Feature Anchoring Framework

质感统一依赖**特征锚定清单**机制。在执行前必须从源图提取:

- **非人类特征** (如精灵尖耳、兽耳、龙角等)
- **五官细节** (眼睛颜色/形状、唇形、脸型)
- **发型发色** (长度、卷直、刘海形态、发色色号)
- **服饰配饰** (材质、颜色、花纹、配饰位置)
- **肤色色调** (瓷白/小麦/古铜,冷调/暖调)

该清单直接注入三路 prompt,作为**强制保持项**。用户每次迭代纠正的偏差(如"尖耳消失了")都应追加到清单,形成累积约束。

### 3. Unified Aesthetic Prompt Template

三路共用的质感描述模板结构:

```
[光线类型] + [景深控制] + [材质质感] + [瑕疵保留策略] + [风格定位]
```

Default template:

```
这张照片是用iPhone拍摄的,在她身上呈现出一种冷调中性光(#D9B79C),光线略微从上方照射下来,浅景深,面部清晰对焦,边缘自然过渡。肌肤纹理自然,毛孔可见,略有瑕疵,未经任何修图处理。用 iPhone 拍摄,皮肤纹理真实,毛孔清晰可见,自然不对称,未经修图,无 AI 磨皮。自然真实,媲美杂志大片,高端社交媒体品质。纯粹的 iPhone 照片质感——非影棚拍摄,非杂志大片。自然流露的活力。
```

用户可整体替换该模板,三路自动同步应用。

## Workflow

### 1. Preparation Stage

**输入要求:**

- 单张角色肖像图(竖版优先,但横版也可处理)
- 肖像需包含完整头部+部分肩颈,面部清晰可见
- 推荐尺寸: 512px 短边以上

**预处理检查清单:**

- \[ \] 源图是否为真实肖像/插画角色(非抽象/剪影)
- \[ \] 面部是否被遮挡(口罩/墨镜/头发严重遮挡会影响三视图生成)
- \[ \] 角色是否有明确的非人类特征(需单独标注)
- \[ \] 如果是古装/奇幻角色,配饰复杂度如何(复杂配饰需在 prompt 中逐项列举)

**特征提取**:从源图人工/半自动提取特征锚定清单,格式化为:

```
- 非人类特征: [尖耳/无]
- 眼睛: [颜色] [形状]
- 发型发色: [长度] [质地] [颜色]
- 配饰: [类型1: 细节], [类型2: 细节]
- 服饰: [材质] [颜色] [图案]
- 肤色: [色调] [明度]
```

### 2. Generation Stage

**Path A: 脸部三视图生成**

Prompt 结构:

```
[基础质感模板] + [角色特征清单] + 
"Generate three facial views of this character in a single horizontal layout:
- Left: Front view (正面)
- Center: Three-quarter view (四分之三侧面)
- Right: Profile view (纯侧面)
All three views maintain identical facial features, proportions, and accessories.
White background, professional character reference sheet style."
```

输出尺寸: 建议 1024×512 或 1280×640 (宽横版)

**Path B: 精修肖像生成**

Prompt 结构:

```
[基础质感模板] + [角色特征清单] + 
"Maintain original composition and pose. Enhance detail fidelity while preserving character identity."
```

输出尺寸: 与源图同比例,建议 512×768 或 768×1024 (竖版)

**Path C: 人物设计单生成**

Prompt 结构:

```
[反推的全身特征描述] + 
"Full body character design sheet, 9-head-tall proportions, white background, 
front view with annotation-ready layout. Include detailed rendering of costume, 
accessories, and hairstyle from multiple angles. Professional concept art style."
```

反推全身特征时需补充:

- 体型比例(如"九头身修长""五头身Q版")
- 服装全貌(鞋履、下装、外套层次)
- 姿势(标准 A-pose 或自然站姿)

输出尺寸: 建议 768×1024 或 1024×1536 (竖版)

**并行执行策略**:三路同时启动,互不依赖。如果某路失败(如三视图角度错乱),可单独重生成该路,其他路保持不变。

### 3. Quality Check & Iteration Stage

**一致性审核维度:**

1. **跨路特征一致性**

   - \[ \] 三视图的正面视角 vs 精修图的正面角度,五官是否匹配
   - \[ \] 三视图的侧面轮廓 vs 设计单的侧面元素,头部形状是否一致
   - \[ \] 设计单的全身服饰 vs 精修图的服饰局部,纹理/颜色是否统一

2. **三视图内部一致性**

   - \[ \] 三个视角的眼睛颜色是否统一
   - \[ \] 配饰(如耳饰、发饰)在三个角度的位置是否符合空间逻辑
   - \[ \] 发型在侧面/四分之三面的透视是否合理

3. **质感保真度**

   - \[ \] 是否出现过度磨皮/塑料感(违反 iPhone 质感要求)
   - \[ \] 毛孔/皮肤纹理是否可见
   - \[ \] 光影是否自然(避免影棚式顶光/环形光)

**常见问题修正策略:**

问题类型修正方法三视图角度不对(如全是正面)在 prompt 中强化角度描述,添加 "strictly maintain: left=front, center=three-quarter, right=profile"配饰在某视角消失在特征清单中单独强调该配饰,例如 "silver filigree hair crown visible in all three views"精修图变成了不同人物追加 "maintain exact facial structure from input image" + 提高 reference strength设计单变成多角色拼贴明确 "single character only, full body front view"肤色/发色偏移在清单中用色号/描述词锁定,如 "porcelain white skin (#FFF5E1)" "raven black hair (#1C1C1C)"

**迭代终止条件:**

- 三路输出均通过一致性审核
- 用户确认特征清单中的所有强制项均已体现
- 质感符合预设模板(无明显违反 iPhone 质感的渲染痕迹)

## Key Constraints & Standards

### Immutable Rules (绝对不可变)

1. **三路输出必须共享同一套质感基底** — 如果用户更新质感模板,必须同步应用到 Path A/B/C
2. **特征清单中的所有项目为强制保持项** — 生成过程中不得擅自删减/替换(如将"尖耳"改成"圆耳")
3. **三视图必须为三视角,不可出现重复视角** — 左中右必须严格对应 front/three-quarter/profile
4. **设计单必须为单角色全身图** — 禁止生成多角色对比图或局部特写拼贴

### Fidelity Rules (保真度要求)

1. **五官形态保真** — 眼距、鼻梁高度、唇形、脸型轮廓必须与源图在视觉上可识别为同一人物
2. **配饰位置保真** — 头饰、耳饰、项链等配饰在三视图中的空间位置必须符合透视逻辑(例如侧面视图中额饰应向后倾斜)
3. **材质质感保真** — 布料(如薄纱透明度)、金属(如银饰光泽)、宝石(如水晶折射)的渲染必须统一
4. **肤色一致性** — RGB色值偏差控制在 ±10 以内(视觉上无明显色差)

### Consistency Rules (跨路一致性)

1. **光线方向统一** — 三路的主光源方向应一致(默认为顶部微侧光)
2. **色温统一** — 如果质感模板指定冷调(如 #D9B79C),三路色温必须统一为冷调
3. **风格统一** — 三路的渲染风格必须匹配(全写实/全二次元/全概念艺术,不可混搭)
4. **背景纯度统一** — 三视图和设计单必须使用纯白背景(#FFFFFF),精修图可保留源图背景或替换为统一背景

### Quality Thresholds (质量阈值)

1. **面部清晰度** — 眼睛瞳孔、睫毛、唇纹必须清晰可辨,不可模糊
2. **配饰完整度** — 如果源图包含 N 件配饰,输出图必须保留全部 N 件(除非因视角遮挡合理缺失)
3. **透视正确性** — 三视图的四分之三面和侧面必须符合人体头部解剖学透视,不可出现"脸贴平"现象
4. **批次一致性** — 如果用户连续执行多次工作流(如为不同角色生成),每次的三视图布局、设计单格式必须保持一致

### Technical Standards (技术标准)

1. **色彩空间** — sRGB,8-bit per channel
2. **输出格式** — PNG(支持透明背景) 或 JPEG(质量≥90)
3. **命名规范** — `[角色名]_三视图.png`, `[角色名]_精修图.png`, `[角色名]_设计单.png`
4. **分辨率要求** — 三视图宽≥1024px,精修图和设计单高≥1024px

## Recommended Tools & Models

本工作流未在对话中明确引用特定工具,理论上可使用任何支持 image-to-image 和 text-to-image 的 AI 模型执行。推荐选择在角色一致性和细节保真度上表现优秀的模型(如 Stable Diffusion XL + ControlNet, Midjourney 一致性模式, 或专用角色生成模型)。

关键参数建议:

- **Denoising strength**: 0.5-0.7 (保持源图特征的同时允许细节优化)
- **CFG scale**: 7-10 (确保 prompt 约束力)
- **Sampling steps**: ≥30 (保证细节收敛)
- **ControlNet** (如使用): OpenPose + Canny 双重控制,权重 0.6-0.8