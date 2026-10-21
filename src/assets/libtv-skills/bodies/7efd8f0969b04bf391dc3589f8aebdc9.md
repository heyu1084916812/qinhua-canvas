# 三视图人物换装设计

## 核心方法论

### 六维特征提取框架

将复杂的人物/服装/发型参考图解构为可精确复现的六维结构化描述:

**人物面部特征六维**:

- 眼型维度: 形状(杏仁眼/圆眼/丹凤眼)、眼皮类型(单/双)、眼距、眼睛大小
- 鼻型维度: 鼻梁高度(高/中/低)、鼻尖形态(圆润/尖锐)、鼻翼宽度(宽/窄)
- 嘴型维度: 嘴唇厚度(薄/中等/厚)、嘴型大小(小巧/适中/大)、嘴角形态(上扬/平直/下垂)
- 脸型维度: 基础形状(瓜子/圆/方/长)、下颌线(纤细/清晰/宽阔)、颧骨(突出/平缓)
- 肤色维度: 色调(冷/暖)、明度(白皙/中等/深色)、质感(无瑕/自然)
- 年龄特征: 骨骼线条清晰度、五官立体程度、面部弧度

**服装结构六维**:

- 款式结构: 上衣类型(背心/T恤/衬衫)、下装类型(短裤/长裤/裙装)、连接方式(套装/单品)
- 面料质感: 材质类别(棉/化纤/弹力)、表面特征(光滑/粗糙)、光泽度(哑光/微光泽/高光)
- 颜色图案: 主色调、饱和度、图案类型(纯色/印花/条纹/豹纹)、图案分布
- 设计细节: 肩带设计(宽/细/交叉)、腰头设计(高腰/中腰)、特殊元素(镂空/拼接/logo)
- 合身度: 贴合程度(紧身/修身/宽松)、长度比例(短款/中长/长款)、廓形特征
- 风格语境: 风格类别(运动/休闲/正式)、时代感(复古/当代/未来)、场景适配

**发型结构六维**(当提供发型参考图时):

- 长度维度: 整体长度(短发/中长/长发)、前后比例、刘海长度
- 形态维度: 基础形状(直发/波浪/卷发)、蓬松度、纹理特征
- 造型维度: 扎发方式(丸子头/马尾/披肩)、分区结构(中分/侧分/无刘海)
- 颜色维度: 发色(黑/棕/染色)、渐变层次、光泽度
- 细节维度: 发际线形态、碎发处理、发尾处理(齐/碎/烫)
- 修饰元素: 发饰配件、编发元素、造型产品效果

### 四格并排布局逻辑

在4:3横版画布上实现四个等宽分区,每格承载特定视角功能:

**正面全身格**(第1格):

- 功能: 展示正面服装结构完整性、整体比例、面部特征
- 构图标准: 头顶留白5-8%、脚底留白3-5%、左右居中对称
- 必须可见: 全身轮廓、双脚完整、双手自然下垂或微抬、服装所有正面细节

**侧面全身格**(第2格):

- 功能: 展示服装侧面廓形、身材曲线、服装厚度
- 构图标准: 与正面格眼线/肩线/脚底线对齐、侧面角度75-90度
- 必须可见: 身体侧面轮廓线、服装侧缝线、前后层次关系

**背面全身格**(第3格):

- 功能: 展示背部设计细节、后背服装结构
- 构图标准: 与前两格基准线对齐、完全背对镜头
- 必须可见: 后背轮廓、背部特殊设计(背带/开口/拼接)、发型后部

**头部特写格**(第4格):

- 功能: 验证面部特征一致性、展示发型细节、服装上半身细节
- 构图标准: 头肩比例1:0.3-0.5、眼部在画面上1/3处、与第1格面部完全一致
- 必须可见: 完整五官、发型前部和侧部、服装肩部及以上部分

### 一致性锁定策略

跨四格必须严格维持的不变量:

**不变量Level 1(绝对不可变)**:

- 人物身份: 眼型/鼻型/嘴型/脸型/肤色的六维面部特征矩阵完全一致
- 体型比例: 身高比例、肩宽、腰臀比、四肢比例在四格中保持恒定
- 服装本体: 颜色/图案/材质/合身度在四格中完全相同
- 发型本体: 长度/形态/颜色/造型方式在四格中完全相同

**不变量Level 2(可调整但需连贯)**:

- 光线方向: 四格统一光源方向(建议正前方45度柔光)
- 背景: 四格统一纯白#FFFFFF背景
- 基准线: 眼线/肩线/腰线/脚底线在前三格必须水平对齐

**可变量(需要变化)**:

- 身体朝向: 第1格正面、第2格侧面、第3格背面
- 可见服装区域: 每格展示该视角下的可见部分
- 手臂姿态: 在不遮挡关键细节前提下可自然变化

## 工作流程

### 1. 准备阶段

**输入资产清单**:

- 必需: 人物参考图(清晰正面照,可识别面部特征)
- 必需: 服装参考图(展示完整服装的平铺图或穿着图)
- 可选: 发型参考图(当需要特定发型时提供)

**前置检查项**:

- \[ \] 人物参考图是否清晰可见五官细节
- \[ \] 服装参考图是否展示了所有关键设计细节
- \[ \] 如提供发型参考图,是否清晰展示前/侧/后发型结构
- \[ \] 确认目标风格(写实人像/插画风格/3D渲染)

### 2. 初始设计阶段

**执行步骤**:

步骤1: 人物面部特征六维提取

- 逐项分析人物参考图的眼/鼻/嘴/脸/肤色/年龄六个维度
- 输出结构化描述清单,每项使用具体形容词(不用"一般"/"普通"等模糊词)
- 示例输出格式: "眼型:杏仁眼,双眼皮,眼距适中,眼睛大小适中"

步骤2: 服装结构六维提取

- 逐项分析服装参考图的款式/面料/颜色/细节/合身度/风格六个维度
- 特别关注特殊设计元素(交叉背带/镂空/拼接/印花图案)
- 输出详细服装提示词,可直接用于图像生成

步骤3: 发型结构六维提取(如提供参考图)

- 逐项分析长度/形态/造型/颜色/细节/修饰六个维度
- 明确扎发方式、分区结构、发尾处理等关键特征
- 输出发型提示词,确保可在四格中一致复现

步骤4: 构建生成提示词

- 提示词结构: \[四格布局声明\] + \[人物特征描述\] + \[服装描述\] + \[发型描述\] + \[视角指令\] + \[质量标准\]
- 示例结构:

  ```
  4:3 horizontal canvas, 4 equal-width panels side by side from left to right:
  [Panel 1: Full-body front view] + [Panel 2: Full-body side view] + [Panel 3: Full-body back view] + [Panel 4: Head close-up]
  
  Character: 20-year-old female, almond eyes with double eyelids, medium-height nose bridge with refined rounded tip, small mouth with medium lips and slightly upturned corners, V-shaped face with delicate jawline, cool-toned fair skin
  
  Outfit: Ice-blue sports bra with thin crossed straps + high-waisted fitted shorts, cut-out waist design, stretch athletic fabric with subtle leopard print pattern, white knee-high socks with black logo lettering + white sneakers
  
  Hairstyle: Black hair in high bun, sleek and neat, with clean hairline
  
  Panel 1: front-facing full body from head to toe, arms naturally down, both feet fully visible
  Panel 2: side profile full body, 75-90 degree angle, aligned eye/shoulder/foot baseline with Panel 1
  Panel 3: back view full body, completely facing away, crossed back straps clearly visible
  Panel 4: head and shoulders close-up, same facial features as Panel 1, upper body outfit visible
  
  Pure white background, unified soft front lighting, photorealistic style, high detail, professional photography quality
  ```

步骤5: 生成四格并排图像

- 使用AI图像生成工具,输入完整提示词
- 单次生成包含四格的完整4:3横版图
- 初始生成后立即进入质量检查环节

### 3. 迭代优化阶段

**质量审核检查项**:

一致性维度检查:

- \[ \] 四格人物面部特征完全一致(重点检查眼型/鼻型/嘴型/脸型)
- \[ \] 四格肤色无色差
- \[ \] 四格服装颜色/图案/细节完全相同
- \[ \] 四格发型长度/形态/颜色完全一致
- \[ \] 前三格眼线/肩线/脚底线水平对齐

完整性维度检查:

- \[ \] 第1格:头顶到脚底全部可见,无裁切
- \[ \] 第2格:侧面全身可见,脚部完整
- \[ \] 第3格:背面全身可见,背部设计清晰
- \[ \] 第4格:面部五官清晰,肩部及以上可见
- \[ \] 四格背景统一纯白,无渐变/阴影/杂色

细节准确性检查:

- \[ \] 服装特殊设计元素准确呈现(如交叉背带/镂空/印花)
- \[ \] 配饰准确呈现(如长筒袜/鞋/发饰)
- \[ \] 发型细节准确(如丸子头/马尾/刘海分区)
- \[ \] 手部姿态自然,不遮挡关键服装细节

**优化决策树**:

如果一致性问题(人物不像同一人/服装有差异): → 强化提示词中的锁定描述,增加更具体的特征词 → 在提示词开头添加"same person in all 4 panels"强调 → 重新生成

如果完整性问题(脚部被裁切/头顶被裁切): → 提示词中添加"full body from head to toe, no cropping"声明 → 调整构图留白比例描述(头顶留白5-8%,脚底留白3-5%) → 重新生成

如果细节准确性问题(服装设计细节缺失/发型不对): → 提取该细节的更具体描述词(如"thin crossed spaghetti straps forming X-shape on back") → 在提示词中单独强调该细节("must show: \[specific detail\]") → 重新生成

如果布局问题(四格不等宽/没有并排): → 提示词开头明确"4:3 horizontal canvas divided into 4 equal vertical panels" → 使用"from left to right: \[panel 1\] \[panel 2\] \[panel 3\] \[panel 4\]"顺序声明 → 重新生成

**迭代终止条件**: 满足以下所有条件时接受输出:

- 四格人物身份一致性通过(同一人)
- 四格服装/发型准确性通过(与参考图匹配)
- 三格全身完整性通过(无裁切)
- 四格布局规范性通过(等宽并排)
- 背景/光线统一性通过(纯白背景+柔光)

## 关键约束与标准

### 不可违背的硬性规则

**人物一致性铁律**:

- 四格中的人物必须是同一人,面部特征六维不可有任何偏差
- 如果任何一格的人物看起来像"另一个人",必须拒绝该输出并重新生成
- 肤色不可有明显色差(允许光线导致的轻微明暗变化,但色调必须一致)

**完整性铁律**:

- 前三格(正面/侧面/背面)必须展示从头顶到脚底的完整全身
- 脚底不可被画布边缘裁切,必须完整可见双脚
- 头顶不可被裁切,发型顶部必须完整可见
- 如果任何一格出现裁切,必须拒绝并重新生成

**布局铁律**:

- 必须是4:3横版画布,不可生成竖版或其他比例
- 必须包含4个等宽垂直分区,不可出现3格或5格
- 四格必须并排排列,顺序固定:正面→侧面→背面→特写
- 不可生成4张独立图片,必须是单张合并图

**背景铁律**:

- 四格背景必须统一纯白#FFFFFF
- 不可出现渐变背景/彩色背景/场景背景
- 不可出现地面阴影/人物投影(纯白摄影棚效果)

### 质量保真规则

**服装保真规则**:

- 服装颜色饱和度必须与参考图一致(不可过饱和或过灰)
- 服装图案(如豹纹/条纹/印花)必须准确复现,位置和密度与参考图匹配
- 特殊设计细节(交叉背带/镂空/拼接)必须清晰可见且准确
- 配饰(袜子/鞋/腰带)必须完整呈现,颜色和样式与描述一致

**发型保真规则**(当提供发型参考图时):

- 发型长度必须与参考图一致(短发不可变长,长发不可变短)
- 扎发方式必须准确(丸子头/马尾/半扎发/披肩)
- 刘海分区必须准确(中分/侧分/无刘海/空气刘海)
- 发色必须一致(黑/棕/染色),不可在四格间变化

**比例协调规则**:

- 人物身高在四格中保持一致,不可出现"侧面变高"或"背面变矮"
- 头身比例保持一致(建议1:7至1:8写实比例)
- 服装合身度在四格中保持一致,不可出现"正面紧身,侧面宽松"

### 视角精确性规则

**正面视角规则**:

- 身体完全正对镜头,左右对称
- 双肩水平,不可一高一低
- 双脚平行站立或微微分开,重心居中

**侧面视角规则**:

- 身体侧转75-90度(接近完全侧面)
- 可见单侧眼睛、鼻梁、单侧嘴角(不可出现正面特征)
- 服装侧缝线清晰可见

**背面视角规则**:

- 身体完全背对镜头,不可看到正面任何特征
- 后背服装设计完整展示(如背带/开口/拼接线)
- 发型后部完整可见(如丸子头后脑勺/马尾辫/披肩发背面)

**特写视角规则**:

- 构图范围:头顶到胸部中上方
- 面部占画面60-70%
- 五官清晰度高于全身格,可见皮肤质感/眼睛细节

## 示例

### 输入示例

人物参考图:20岁女性证件照,杏仁眼双眼皮,精致鼻型,小巧嘴型,瓜子脸,冷白肤色 服装参考图:冰蓝色运动套装,细肩带交叉背带运动背心+高腰紧身短裤,豹纹暗纹,白色长筒袜+运动鞋 发型参考图:黑色高丸子头,整洁贴头

### 提示词示例

```
4:3 horizontal photographic canvas, divided into 4 equal-width vertical panels arranged left to right:

[PANEL 1: Full-body front view]
A 20-year-old East Asian female, almond-shaped eyes with distinct double eyelids and medium eye spacing, medium-height nose bridge with refined rounded tip and narrow nostrils, small mouth with medium lip thickness and slightly upturned corners, V-shaped face with delicate jawline and smooth cheekbones, cool-toned fair porcelain skin. Black hair styled in high neat bun. Wearing ice-blue sports bra with thin crossed spaghetti straps forming X-shape + high-waisted fitted shorts with subtle leopard print pattern, cut-out waist design, stretch athletic fabric with slight sheen. White knee-high socks with small black logo lettering + white sneakers. Full body from head to toe, standing straight facing camera, arms naturally at sides, both feet fully visible and flat on ground, head-to-canvas-top spacing 5-8%, feet-to-canvas-bottom spacing 3-5%.

[PANEL 2: Full-body side view]
Same person as Panel 1, same outfit, same hairstyle. Body turned 80 degrees to show left side profile. Full body side view from head to toe, one eye visible in profile, nose bridge and tip clearly visible, body silhouette and outfit side seam visible. Eye line, shoulder line, and foot baseline aligned with Panel 1.

[PANEL 3: Full-body back view]
Same person as Panel 1, same outfit, same hairstyle. Completely facing away from camera showing back. Crossed X-shaped back straps of sports bra clearly visible, back of shorts visible, back of white socks and sneakers visible, back of head showing bun hairstyle. Full body from head to toe. Baseline aligned with Panel 1 and 2.

[PANEL 4: Head and shoulders close-up]
Same person as Panel 1, identical facial features (same almond eyes, same nose, same mouth, same face shape, same skin tone). Head and shoulders view, face占60-70% of frame, eyes positioned at upper 1/3 of panel. Upper body outfit (sports bra straps) visible. Same hairstyle (bun) visible from front.

---

All 4 panels: Pure white background #FFFFFF with no gradients, no shadows, no ground plane. Unified soft frontal lighting at 45-degree angle. Same person across all panels with zero facial feature deviation. Photorealistic style, professional studio photography quality, high detail, sharp focus.
```

### 预期输出

单张4:3横版图像,包含四个等宽垂直分区:

- 分区1:20岁女性正面全身照,冰蓝运动套装,黑色丸子头,白色背景,头到脚完整
- 分区2:同一人侧面全身照,展示身体曲线和服装侧面廓形,与分区1眼线/脚底线对齐
- 分区3:同一人背面全身照,交叉背带清晰可见,丸子头后脑勺可见
- 分区4:同一人头肩特写,面部特征与分区1完全一致,服装上半部分可见

四格人物身份完全一致,服装/发型在所有格中准确复现,背景统一纯白,无裁切。