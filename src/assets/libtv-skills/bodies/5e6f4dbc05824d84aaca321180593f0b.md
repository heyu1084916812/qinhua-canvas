# 裸眼3D户外大屏广告生成器（Lib Image 版）

## Skill 简介

基于 Nike Air Force 1 裸眼3D户外大屏广告的完整制作流程，帮助用户为任意产品制作同款风格的30秒裸眼3D广告视频。分镜关键帧图片使用 **Lib Image** 模型生成，全程分步确认，每个关键节点等待用户指令后再推进。

---

## 输入信息

用户需提供：

- **产品图**：支持多张，越清晰越好
- **品牌名称或LOGO图片**
- **画幅**：横版 16:9（适合商场大屏/户外大屏）或 竖版 9:16（适合手机竖屏/电梯屏）

---

## 制作流程（逐步确认，每步等待用户指令）

### Step 1｜收集基础信息

用 `ask_parent_agent` 依次询问：

1. 画幅方向：横版 16:9 / 竖版 9:16 / 两个都要
2. 上传产品图 + 品牌名称或LOGO图片

### Step 2｜产品图三视图确认

判断用户上传的产品图是否为**多角度三视图**（正面、侧面、背面/45°角）：

- **已是三视图** → 直接进入 Step 3，告知用户"产品图已包含多角度，无需重新生成"
- **不是三视图**（单张或角度不足）→ 用 `ask_parent_agent` 询问用户：
  - 选项A：帮我生成三视图（AI生成，我来确认）
  - 选项B：我自己补充上传其他角度图片
  - 生成后展示给用户确认，满意后进入 Step 3

### Step 3｜场景锚点确认

生成或确认**户外大屏场景锚点**：

用 `ask_parent_agent` 询问：

- 选项A：帮我生成场景锚点图（AI生成L型拐角大屏）
- 选项B：我自己上传户外大厦参考图

**若选A，生成提示词模板（使用 Lib Image 模型）：**

```
A large L-shaped corner LED billboard wrapping around the corner of a modern urban building, two screen panels meeting at a 90-degree building corner angle, bare-eye 3D anamorphic billboard setup, daytime natural light, overcast sky, [城市风格] city environment, multiple buildings in background, street level fixed camera looking up at mid-shot, the two LED panels are blank white/off showing the corner structure clearly, realistic commercial photography, cinematic wide shot
```

> ⚠️ 关键：必须是**L型拐角大屏**（两面夹角90°），不能是平面单屏，否则无法产生裸眼3D视觉错觉。

生成后展示给用户确认，满意后记录为场景锚点 `scene_anchor`，进入 Step 4。

### Step 4｜品牌包装道具确认

用 `ask_parent_agent` 询问品牌包装道具（如产品包装盒）如何处理：

- 选项A：保持默认风格（参考原片红色鞋盒）
- 选项B：帮我生成一个品牌包装盒设计图，我来确认
- 选项C：自定义颜色/风格（用户输入描述）

**若选B，使用 Lib Image 模型生成，提示词模板：**

```
A [品牌名] product packaging box, [主色调] color, [品牌LOGO] logo in [对比色] on the front panel, brand text in [对比色], the box lid is slightly open, 3D perspective angle view, product photography, pure white background, clean minimalist design, commercial product rendering, high quality
```

生成后展示给用户确认，满意后记录为道具锚点 `prop_anchor`，进入 Step 5。

### Step 5｜生成 S01–S09 分镜关键帧图片

> 🎨 **本步骤全部使用 Lib Image 模型生成**，参数：`ai_model: "Lib Image"`，`mode_type: "image2image"`，画幅与用户选择一致。

参考场景锚点 + 产品图 + 道具锚点，按以下分镜结构生成9张关键帧图片：

分镜组01｜品牌建立与开箱（M01·0s–7s）

**S01｜0–2.5s｜包装盒推出·品牌建立**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, the giant [品牌] product packaging box {{prop_anchor}} slides forward from deep inside the screen toward the viewer with strong perspective depth, [品牌] logo on pure white background inside the screen, box protrudes beyond the screen frame creating 3D illusion, daytime natural light, city buildings in background, fixed camera mid-shot looking up, cinematic commercial advertising
```

参考节点：`scene_anchor`、`prop_anchor`

**S02｜2.5–5s｜产品元素涌出·视觉冲击**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, the [品牌] packaging box {{prop_anchor}} lid flips open on the screen, dozens of colorful [产品特征元素] burst out and fly toward the viewer beyond the screen boundary, kinetic energy explosion effect, white background inside screen, daytime city environment, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、`prop_anchor`

**S03｜5–7s｜产品浮现出屏·揭示产品**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, [产品名称] {{product_anchor}} rises from the open packaging box on the screen, product floats forward and protrudes beyond the screen edge toward the viewer, no support floating illusion, bare-eye 3D product reveal, white background inside screen, daytime city buildings background, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、`product_anchor`

分镜组02｜产品制作展示（M02·7s–14s）

**S04｜7–9.5s｜包装盒碎裂重组·场景转换**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, the [品牌] packaging box shatters and explodes into fragments on screen, pieces scatter dynamically then reassemble, background transitions to warm beige grid paper texture, workshop crafting atmosphere, dynamic particle explosion animation, daytime city environment, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`

**S05｜9.5–12s｜虚拟小手拼装产品·工艺展示**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, cartoon virtual hands break through a warm beige grid paper background on the screen, nimble fingers assembling [产品名称] {{product_anchor}} piece by piece, colorful material blocks flying in from all directions snapping together, playful crafting animation style, daytime city background, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、`product_anchor`

**S06｜12–14s｜产品悬浮出屏·揭示定制配色**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, cartoon hand holds up [产品名称] {{product_anchor}} on the screen, product floats and protrudes beyond the screen boundary toward viewer, [背景色] background with [装饰纹样] patterns, vivid colorway, bare-eye 3D floating illusion, daytime city buildings background, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、`product_anchor`

分镜组03｜快切收尾（M03·14s–22.7s）

**S07｜14–18s｜多款快切闪过·节奏加速**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, rapid montage of [产品款式数量] [产品名称] displayed simultaneously on screen — [款式1] {{product_anchor_1}}, [款式2] {{product_anchor_2}}, [款式3] {{product_anchor_3}} — each floating and protruding toward viewer at different positions, fast-cut rhythm energy, vivid colors, bare-eye 3D effect, daytime city background, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、全部 `product_anchor`

**S08｜18–20.5s｜几何撤色·视觉高潮**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, [产品名称] {{product_anchor}} flashes on screen, then geometric color blocks rapidly dissolve and strip away, colors drain from vivid to black-and-white monochrome in a dynamic visual climax, sharp geometric transitions, peak rhythm moment, daytime city background, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、`product_anchor`

**S09｜20.5–22.7s｜收尾元素收回·品牌回归**

```
Bare-eye 3D anamorphic LED billboard on L-shaped building corner {{scene_anchor}}, [品牌] packaging box {{prop_anchor}} reappears in the center of the screen, a large white fluffy cat paw reaches out from beyond the right edge of the billboard frame, grabs the box and drags it back into the screen depth, bare-eye 3D cat paw breaking the screen boundary, cinematic ending moment, screen fading to white, daytime city background, fixed camera mid-shot looking up
```

参考节点：`scene_anchor`、`prop_anchor`

生成完毕后，展示全部9张分镜图给用户确认，等待用户指令。

### Step 6｜生成最终视频成片

用户确认分镜图后，等待用户明确指令"开始生成视频"。

使用 **Seedance 2.5** 模型，将以下所有节点作为参考输入，生成**一个视频节点**：

**输入节点清单：**

- 场景锚点：`scene_anchor`（L型拐角大屏）
- 道具锚点：`prop_anchor`（品牌包装盒）
- 产品参考：`product_anchor`（产品三视图，可多款）
- 分镜关键帧：S01–S09 共9张图片节点（Lib Image 生成）

**视频生成提示词结构：**

```
Bare-eye 3D anamorphic advertisement on an L-shaped corner LED billboard mounted on a modern urban building exterior {{scene_anchor}}, daytime natural light, city buildings background, fixed camera mid-shot looking up throughout.

Scene 1 (0-7s): A giant [品牌] packaging box {{prop_anchor}} slides forward from deep inside the billboard screen toward the viewer with strong perspective depth {{S01}}, [品牌] logo on pure white background, box protrudes beyond the screen frame. Lid flips open, [产品特征元素] burst out flying toward the viewer {{S02}}. [产品名称] {{product_anchor}} rises from the box and floats beyond the screen edge {{S03}}, bare-eye 3D floating illusion.

Scene 2 (7-14s): The packaging box shatters and explodes into fragments then reassembles, background transitions to warm beige grid paper texture {{S04}}. Cartoon virtual hands break through the grid background, assembling [产品名称] piece by piece, colorful blocks snap together {{S05}}. The product floats and protrudes beyond the screen {{S06}}.

Scene 3 (14-22.7s): Rapid montage — [多款产品] flash in quick succession each protruding toward viewer {{S07}}. Geometric color blocks dissolve from vivid to monochrome visual climax {{S08}}. [品牌] packaging box reappears, a white fluffy cat paw reaches out from beyond the right edge of the billboard frame, grabs the box and drags it back into the screen, screen fades to white then cuts to black {{S09}}.

Bare-eye 3D anamorphic effect throughout, subjects protrude beyond billboard boundaries, cinematic commercial advertising style.
```

**参数：**

- 模型：Seedance 2.5
- 画幅：用户选择的比例（16:9 或 9:16）
- 时长：30s
- 分辨率：720p
- tag：final_product

> ⚠️ 所有分镜图片节点 + 产品参考节点 + 场景锚点节点 + 道具锚点节点，全部通过 `reference_nodes` 参数链接到**同一个视频节点**，不要分开生成多个视频节点。

---

## 模型使用说明

步骤模型说明Step 3 场景锚点生成**Lib Image**L型拐角大屏场景图Step 4 道具锚点生成**Lib Image**品牌包装盒设计图Step 5 分镜关键帧 S01–S09**Lib Image**全部9张分镜图，`ai_model: "Lib Image"`，`mode_type: "image2image"`Step 6 最终视频成片**Seedance 2.5**30秒裸眼3D广告视频

---

## 分镜时序结构总览

动态段时间分镜节奏M01 品牌建立0–7sS01+S02+S03舒展·推进M02 制作展示7–14sS04+S05+S06流畅·节奏感M03 快切收尾14–22.7sS07+S08+S09加速·高潮·收尾尾帧黑场22.7–30s—品牌余韵BGM0–24s—活泼节奏广告配乐

---

## 裸眼3D核心技法要点

技法描述**出屏推进**主体从屏幕深处向观众方向推进，利用透视产生纵深感**边框突破**主体超出大屏边框范围，视觉上"脱离"屏幕**背景层次**屏内背景与屏外真实城市建筑形成前后层次对比**悬浮托举**产品被托举悬浮，无支撑感，强化立体错觉**手撕穿透**虚拟手臂"穿破"背景层，制造空间突破感

> ⚠️ 场景锚点必须使用**L型拐角大屏**，两面夹角90°，这是裸眼3D视觉错觉的物理基础，平面单屏无法实现此效果。

---

## AskUser 触发点

以下节点必须暂停等待用户确认：

1. **产品三视图**：判断后告知用户，若需生成则展示确认
2. **场景锚点图**：生成后必须展示给用户确认（注意：必须是L型拐角大屏，平面屏需重新生成）
3. **品牌包装道具**：生成后必须展示给用户确认
4. **S01–S09 分镜关键帧**：全部生成后展示给用户确认
5. **最终视频**：等待用户明确说"开始生成视频"后才执行 Step 6