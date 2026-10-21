# 排版雕塑海报生成器

## Skill 定位

专门生成「排版即图形」的高端平面海报。核心创意：物体轮廓不用线条勾勒，而是由大量文字（多种字体、字号、字重）从顶部到底部层层堆叠而成，形成强烈视觉雕塑感。全图极简、高对比度、纯平面、无渐变无阴影，呈现复古先锋海报气质。适用于 Midjourney / Stable Diffusion。

**画布验证案例（已跑通）：**

- 果汁玻璃瓶 · 墨绿橙白 · 参考图驱动轮廓
- 牛奶玻璃杯 · 蓝粉白 · 参考图驱动轮廓
- 手机轮廓 · 黑橙白 · 参考图驱动轮廓

---

## 用户输入参数（均为可选，有默认值）

参数默认值可替换为**参考图**（新增）不上传（使用文字描述轮廓）上传任意物体图片，自动匹配其轮廓形状主体轮廓类型奶昔玻璃杯咖啡杯、啤酒杯、奶茶杯、香水瓶、灯泡、手机、任意物体背景色纯深蓝色纯红、纯黑、纯米白、纯墨绿等任意纯色配色方案蓝粉白（背景蓝、主体白、点缀粉）任意 2–3 种纯色组合画幅比例4:5 竖版1:1、3:4、9:16 等

> 不需要提供具体文字内容，字母仅作为图形元素，忽略语义。

---

## 两种使用模式

### 模式 A：参考图驱动（推荐）

上传一张参考图，Skill 自动读取其轮廓特征，生成精确匹配该形状的排版雕塑提示词。

**参考图驱动的提示词结构：**

```
Minimalist high-contrast flat poster, pure [背景色] background, vertical symmetrical composition. A [物体名称] silhouette formed entirely by stacked typography — matching the shape of [参考图节点]: [逐区域描述轮廓特征，如 narrow screw-cap top, gently widening neck, full rounded body, flat base]. [各区域字体描述]. Mixed fonts: thick serif, handwritten script, sans-serif, multiple sizes and weights, some letters stretched, rotated, overlapping, artfully deformed. Color palette: [颜色1], [颜色2], [颜色3] only. Pure flat color, no gradient, no shadow. Vintage screen-print texture, handmade collage feel, slight ink unevenness and halftone grain. Letters as pure graphic forms, no semantic meaning. A thin [颜色] line or small symbol at the bottom as decoration. Retro avant-garde poster, typography as sculpture, strong visual impact. --ar [画幅] --style raw
```

**已验证案例 1 — 果汁玻璃瓶 · 墨绿橙白：**

```
Minimalist high-contrast flat poster, pure dark forest green background, vertical symmetrical composition. A juice glass bottle silhouette formed entirely by stacked typography — matching the shape of [参考图]: narrow screw-cap top, gently widening neck, full rounded body, flat base. Cap area at top suggested by a tight row of small bold sans-serif letters forming a compact rectangle. Narrow neck from thin columns of tiny handwritten cursive script letters. Wide bottle body from alternating bold serif capital letters and compressed sans-serif letters of varying sizes and weights. Bottom base from dense heavy black-weight type rows. Mixed fonts: thick serif, handwritten script, sans-serif, multiple sizes and weights, some letters stretched, rotated, overlapping, artfully deformed. Color palette: dark forest green, orange, white only. Pure flat color, no gradient, no shadow. Vintage screen-print texture, handmade collage feel, slight ink unevenness and halftone grain. Letters as pure graphic forms, no semantic meaning. A thin orange line or small symbol at the bottom as decoration. Retro avant-garde poster, typography as sculpture, strong visual impact. --ar 4:5 --style raw
```

**已验证案例 2 — 牛奶玻璃杯 · 蓝粉白：**

```
Minimalist high-contrast flat poster, pure deep blue background, vertical symmetrical composition. A rounded milk glass silhouette formed entirely by stacked typography — matching the shape of [参考图]: glass rim at top built from tiny handwritten cursive letters and small script, wide rounded body from alternating bold serif capital letters and clean compressed sans-serif letters of varying sizes, thick base from dense heavy black-weight type rows. The overall glass shape is barrel-like: wide in the middle, slightly narrowing at top and bottom. Mixed fonts: thick serif, handwritten script, sans-serif, multiple sizes and weights, some letters stretched, rotated, overlapping, artfully deformed. Color palette: blue, pink, white only. Pure flat color, no gradient, no shadow. Vintage screen-print texture, handmade collage feel, slight ink unevenness and halftone grain. Letters as pure graphic forms, no semantic meaning. A thin pink line or small symbol at the bottom as decoration. Retro avant-garde drink poster, typography as sculpture, strong visual impact. --ar 4:5 --style raw
```

**已验证案例 3 — 手机轮廓 · 黑橙白：**

```
Minimalist high-contrast flat poster, pure black background, vertical symmetrical composition. A smartphone silhouette formed entirely by stacked typography — matching the shape of [参考图]: rounded rectangular outline of a modern phone body. Top camera module area suggested by dense circular punctuation marks and small bold letters. Phone body from alternating bold serif capital letters and compressed sans-serif letters of varying sizes and weights. Bottom from dense heavy type rows. Mixed fonts: thick serif, handwritten script, sans-serif, multiple sizes and weights, some letters stretched, rotated, overlapping, artfully deformed. Color palette: black, orange, white only. Pure flat color, no gradient, no shadow. Vintage screen-print texture, handmade collage feel, slight ink unevenness and halftone grain. Letters as pure graphic forms, no semantic meaning. A thin orange line or small symbol at the bottom as decoration. Retro avant-garde poster, typography as sculpture, strong visual impact. --ar 4:5 --style raw
```

---

### 模式 B：文字描述轮廓（无参考图）

不上传参考图，直接用文字指定主体轮廓类型，Skill 根据常见形态描述生成提示词。

**通用提示词模板：**

```
Minimalist high-contrast flat poster, pure [背景色] background, vertical symmetrical composition. A [主体轮廓] silhouette formed entirely by stacked typography—[顶部结构] from [顶部字体描述], [主体结构] from [主体字体描述], [底部结构] from [底部字体描述]. Mixed fonts: thick serif, handwritten script, sans-serif, multiple sizes and weights, some letters stretched, rotated, overlapping, artfully deformed. Color palette: [颜色1], [颜色2], [颜色3] only. Pure flat color, no gradient, no shadow. Vintage screen-print texture, handmade collage feel, slight ink unevenness and halftone grain. Letters as pure graphic forms, no semantic meaning. A thin [颜色] line or small symbol at the bottom as decoration. Retro avant-garde drink poster, typography as sculpture, strong visual impact. --ar [画幅] --style raw
```

**默认提示词（奶昔 · 蓝粉白 · 4:5）：**

```
Minimalist high-contrast flat poster, pure deep blue background, vertical symmetrical composition. A milkshake glass silhouette formed entirely by stacked typography—whipped cream at top built from small handwritten cursive letters, glass body from alternating bold serif and clean sans-serif letters, bottom from dense heavy type. Mixed fonts: thick serif, handwritten script, sans-serif, multiple sizes and weights, some letters stretched, rotated, overlapping, artfully deformed. Color palette: blue, pink, white only. Pure flat color, no gradient, no shadow. Vintage screen-print texture, handmade collage feel, slight ink unevenness and halftone grain. Letters as pure graphic forms, no semantic meaning. A thin pink line or small symbol at the bottom as decoration. Retro avant-garde drink poster, typography as sculpture, strong visual impact. --ar 4:5 --style raw
```

---

## 内部处理流程

1. 判断用户是否上传了参考图
   - **有参考图** → 进入模式 A，读取参考图轮廓特征（整体形态、各区域宽窄比例、顶部/主体/底部结构特征），生成精确匹配该形状的提示词
   - **无参考图** → 进入模式 B，根据用户指定的主体轮廓类型（或默认奶昔杯）生成提示词
2. 接收背景色、配色方案、画幅参数（未指定则使用默认值）
3. 构建排版结构：顶部 / 主体 / 底部 / 吸管或手柄（可选）/ 底部装饰
4. 为每个区域匹配字体类型与字号逻辑
5. 生成正向提示词 + 负向提示词
6. 输出自检清单，确认提示词符合全局视觉规则

---

## 全局视觉规则

### 构图铁律

- 垂直对称构图，主体负形轮廓居中
- 所有排版文字共同构成完整物体轮廓，从顶部到底部全部由文字堆叠而成
- 整张海报仅使用一个纯色背景，无渐变无纹理无场景
- 所有文字和图形纯色填充扁平化处理
- **禁止**任何渐变、投影、外发光、内阴影

### 色彩系统

- 默认蓝粉白三色：背景纯蓝，主体文字白色，点缀粉色
- 允许替换为任意 2–3 种纯色组合
- 全图不超过 3 种颜色

### 排版规则

- **字体混合**：粗衬线体、手写草书、无衬线体混合排布
- **字号与字重**：从极小装饰文字到巨大主结构文字，细体/常规/粗体/特粗体并用
- **文字堆叠构成轮廓**：
  - 顶部（奶油/瓶盖/顶端）：手写体与小字号文字，或密集小号无衬线体
  - 主体：粗衬线体与无衬线体交替
  - 底部：密集粗体文字
- **艺术化变形**：部分字母拉长、压扁、旋转、翻转、穿插重叠，可超出轮廓一点点但整体形状可辨认
- **文字作为图形**：忽略语义，可为单个字母、重复字母、数字、标点符号的混合
- 吸管、手柄或细节结构用细长文字或纯色细线表示
- 底部预留小面积细线装饰或符号元素，保持极简

### 质感与风格

- **复古丝网印刷质感**：轻微不均匀墨色、网点感、边缘略粗糙
- **手作拼贴风格**：字距不完全均匀、行间细微错位、字母偶尔重叠
- **复古先锋气质**：像上世纪中期或 90 年代的地下饮品海报、独立杂志内页广告、唱片封套或咖啡店手作菜单

---

## 负向提示词

```
gradient, shadow, 3D, realistic photo, illustration of a real object, outline drawing, vector clean look, smooth digital, readable text, meaningful words, multiple colors, complex background, texture background, photograph, CGI
```

---

## 自检清单

生成提示词后，逐项确认：

- \[ \] 是否使用纯色背景，无渐变无阴影
- \[ \] 物体轮廓是否完全由排版文字堆叠构成
- \[ \] 有参考图时，是否准确描述了参考图的轮廓特征（各区域宽窄、形态）
- \[ \] 是否包含粗衬线体、手写草书、无衬线体三种字体类型
- \[ \] 是否使用多种字号和字重
- \[ \] 是否有字母变形、旋转、重叠
- \[ \] 配色是否仅为用户指定的 2–3 种纯色
- \[ \] 是否体现复古丝网印刷与手作拼贴质感
- \[ \] 文字是否作为纯图形，不强调语义
- \[ \] 底部是否有小面积细线装饰或符号
- \[ \] 整体是否呈现复古先锋海报气质

---

## 用户定制提示

- **上传参考图**：任意物体均可，Skill 自动读取轮廓形状，无需手动描述
- **替换主体轮廓**（无参考图时）：直接说明物体类型，排版逻辑不变
- **更换配色**：直接指定新配色（如纯红背景加黑白文字）
- **强调某种字体风格**：如全手写体或全粗衬线体，可调整字体混合比例
- **底部装饰特殊偏好**：可指定符号类型或细线样式
- 其余情况直接使用默认提示词或通用模板生成