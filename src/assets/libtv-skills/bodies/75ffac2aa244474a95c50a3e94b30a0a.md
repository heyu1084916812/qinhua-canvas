# 东方版画拼贴旅行诗·完整工作流

## Skill 简介

上传任意一张旅行照片，经过五个步骤的完整工作流，生成一张 3:4 竖版「东方版画拼贴旅行诗」成品：

1. **照片分析**：识别地点、季节、氛围、主体与空间层级
2. **版画元素提取**：提取 3–6 个最具辨识度的真实元素
3. **色彩提取**：从原照片提取版画用色方案
4. **诗句创作**：创作 5–8 词原创英文旅行诗句
5. **成品生成**：合成 3:4 竖版东方版画拼贴旅行诗成品图

---

## 工作流节点

### 节点 1：照片分析（文本生成节点）

- **节点类型**：文本生成
- **上游依赖**：`{{travel_photo}}`（用户上传的旅行照片）
- **任务**：对输入照片进行结构化分析，输出分析报告

**Prompt：**

```
请仔细分析这张旅行照片 {{travel_photo}}，输出以下结构化分析报告：

1. 【地点与季节】
   - 推断地点（国家/城市/具体景点）
   - 推断季节或时段（春/夏/秋/冬，清晨/正午/黄昏/夜晚）

2. 【主体识别】
   - 列出画面中最显著的 3–6 个主体（建筑、自然元素、人物、水体等）
   - 描述每个主体的位置（左/中/右，前景/中景/背景）和大小关系

3. 【空间层级】
   - 描述前景、中景、背景的内容和层次关系

4. 【光影与氛围】
   - 光线方向、强度、色温
   - 整体氛围（宁静/热烈/神秘/清新等）

5. 【构图特征】
   - 主要构图线（水平线、对角线、曲线、对称轴等）
   - 最有视觉张力的构图元素

请用简洁的中文输出，每项不超过 3 句话。
```

---

### 节点 2：版画元素提取（文本生成节点）

- **节点类型**：文本生成
- **上游依赖**：节点 1 的分析报告 + `{{travel_photo}}`
- **任务**：从分析报告中提炼版画转绘所需的元素清单

**Prompt：**

```
基于以下照片分析报告：
{{节点1输出}}

请为东方版画拼贴转绘提取元素清单，严格遵守以下规则：

【版画元素清单】
从照片中提取 3–6 个最有辨识度的真实元素，每个元素包含：
- 元素名称（如：石拱桥、枫树、白墙民居）
- 在版画中的抽象表达方式（如：粗墨线轮廓+平面色块、干刷边缘+丝网颗粒）
- 在画面中的位置和大小（保留原照片中的位置关系）
- 是否作为视觉焦点（是/否）

【构图规则】
- 版画画面位于下半部分中部或中下部
- 宽度约占画布 45%–60%，不铺满纸面
- 保留大量留白，构图克制安静
- 保留主体之间原有的位置、大小和前后关系

【可选系列符号】（二选一，也可不选）
- 圆形日轮或月轮（克制，不抢主体）
- 很小的红色抽象印章（不含可辨认文字）

请输出结构化的元素清单和构图方案。
```

---

### 节点 3：色彩提取（文本生成节点）

- **节点类型**：文本生成
- **上游依赖**：节点 1 的分析报告 + `{{travel_photo}}`
- **任务**：从原照片提取版画专用色彩方案

**Prompt：**

```
基于以下照片分析报告：
{{节点1输出}}

请为东方版画拼贴提取色彩方案，严格遵守以下规则：

【色彩提取规则】
色彩只能从原照片中提取，整体降低饱和度，呈现旧版画的自然褪色感。

请提取以下四类颜色（用色名+近似十六进制色值描述）：
1. 主色（画面中占比最大的颜色，降饱和度后的版本）
2. 深色结构色（用于轮廓线、阴影、主体边缘的深色）
3. 纸张中性色（接近象牙白手工纸 #F3F0E8 的背景色）
4. 强调色（最多一处小面积强调色，可以是照片中最鲜艳的局部颜色，降饱和后使用；如无合适颜色可不选）

【禁止】
- 不得使用照片中没有的颜色
- 不得使用高饱和度的鲜艳色彩
- 不得使用渐变

请输出色彩方案表格，并说明每种颜色在版画中的使用位置。
```

---

### 节点 4：诗句创作（文本生成节点）

- **节点类型**：文本生成
- **上游依赖**：节点 1 的分析报告
- **任务**：创作原创英文旅行诗句

**Prompt：**

```
基于以下照片分析报告：
{{节点1输出}}

请为这张旅行照片创作一句原创英文旅行诗句，严格遵守以下规则：

【诗句要求】
- 长度：5–8 个英文单词
- 内容：根据照片中的地点、季节和氛围创作，不得直接描述照片内容
- 风格：诗意、克制、留有余韵，像旅行手账中的一行随笔
- 分行：将诗句自然地分成两行（在语义停顿处断行）
- 字体说明：小号黑色细衬线体或打字机字体，字距疏朗

【禁止】
- 不得出现地名、人名等具体专有名词
- 不得使用陈词滥调（如 "beautiful journey"、"memories forever" 等）
- 不得超过 8 个单词

请输出：
1. 完整诗句（一行）
2. 分行版本（两行，标注断行位置）
3. 简短说明创作思路（1–2 句）
```

---

### 节点 5：成品生成（图片生成节点）

- **节点类型**：图片生成（图生图，参考图为 `{{travel_photo}}`）
- **输出比例**：3:4（竖版）
- **上游依赖**：`{{travel_photo}}` + 节点 2（元素清单）+ 节点 3（色彩方案）+ 节点 4（诗句）

**Prompt 模板：**

```
A 3:4 vertical travel art collage in two distinct halves, seamlessly joined.

TOP HALF (exactly 42% of total canvas height): Place the original travel photograph {{travel_photo}} at the very top, spanning the full width of the canvas with no cropping on the sides. The photograph is preserved with full photographic realism — original composition, subjects, architecture, lighting, and colors must not be redrawn, inpainted, extended, replaced, or altered in any way. No frames, shadows, or torn paper edges. The photo connects directly to the paper surface below.

BOTTOM HALF (58% of total canvas height): Warm, even ivory handmade paper background, color close to #F3F0E8, with subtle paper fiber texture and natural print grain. No gradients.

PRINTMAKING ELEMENTS (from element extraction):
{{节点2输出 — 版画元素清单和构图方案}}

COLOR PALETTE (from color extraction):
{{节点3输出 — 色彩方案}}
Overall desaturated to evoke the natural fading of aged prints.

STYLE: Blend Chinese modern printmaking, woodcut, aged paper collage, and editorial design aesthetics. Flat color blocks, rough ink lines, dry-brush edges, screen-print grain. Restrained, quiet composition with generous negative space. Abstract image centered or in lower-center of bottom half, width approximately 45%–60% of canvas — must NOT fill the entire paper surface.

POETRY (bottom-left area of lower half):
{{节点4输出 — 分行诗句}}
Small black fine serif or typewriter font, generous letter-spacing, restrained typesetting. No other text, titles, numbers, logos, or watermarks anywhere.

OVERALL: Real travel photography and Eastern printmaking form a clear upper-lower contrast. Antique, warm, quiet — like a collectible editorial work in a travel journal — with modern design sensibility.

AVOID: watercolor, guochao illustration, anime, oil painting, ukiyo-e, realistic illustration, 3D rendering, complex decoration, full-bleed composition, excessive aging, excessive grain, fictional figures, fictional architecture, incorrect text, irrelevant objects.

Output: one complete 3:4 vertical image only.
```

---

## 锚点（固定不变的工艺规则）

锚点值成品比例3:4 竖版上半部分高度占比42%下半部分高度占比58%下半背景色象牙白手工纸 #F3F0E8版画元素数量3–6 个最具辨识度的真实元素版画画面宽度约占画布 45%–60%，不铺满纸面色彩来源仅从原照片提取，整体降饱和度系列符号圆形日轮/月轮 或 小红色抽象印章，二选一，不得同时出现英文诗句5–8 词，原创，分两行，置于下半部分左下区域字体小号黑色细衬线体或打字机字体，字距疏朗禁止内容水彩、国潮插画、动漫、油画、浮世绘、写实插画、3D渲染、复杂装饰、满版构图、过度做旧、过度颗粒、虚构人物、虚构建筑、错误文字、无关物体

---

## 槽位（每次运行会变）

槽位说明`{{travel_photo}}`用户上传的旅行照片节点1输出照片分析报告（地点、季节、主体、光影、构图）节点2输出版画元素清单和构图方案节点3输出色彩方案（主色、结构色、纸张色、强调色）节点4输出原创英文旅行诗句（分两行）

---

## 示例参考

画布上已验证的三个案例：

照片地点成品特征西湖杭州西湖六角亭蓝灰湖水+亭台轮廓，金琥珀屋檐色威尼斯大运河黄金时刻穹顶剪影+琥珀色建筑，深蓝水面江南水乡秋日薄雾水村石拱桥圆形倒影+白墙灰瓦+红枫

---

## 注意事项

- 节点 1–4 为文本分析节点，产出结构化文本，供节点 5 使用
- 节点 5 为最终图片生成节点，需将节点 2、3、4 的输出注入 Prompt
- 原照片内容在上半部分必须完整保留，不得任何形式修改
- 成品只输出一张完整图，不输出分步骤图或局部图