# 煎食物极致微距商业美食短片

## Skill 定位

为任意**煎类食物**（煎饺、煎牛排、煎蛋、煎鱼、煎饼等）直接生成一段**完整的极致微距商业美食视频**。风格锚点固定，食物种类和视频时长作为可替换槽位。

---

## 输入

用户提供：

- `{{food}}`：煎类食物名称，例如"煎牛排"、"煎蛋"、"煎鱼排"
- `{{food_detail}}`（可选）：食材细节补充，例如"厚切肋眼，五分熟，表面有焦化纹路"；若用户未提供，根据食物常识自动补全
- `{{duration}}`（可选）：视频总时长（秒）；若用户未指定，默认使用 **6-8 秒**

---

## 风格锚点（贯穿全片，固定不变）

以下风格参数在所有节点的 prompt 中必须保持一致，不随食物种类或时长变化：

- **画面质感**：超写实高端商业美食微距摄影，极致细节，浅景深
- **打光**：温暖奶油质感打光，暖色调，高光打在食物表面油脂/酥皮上
- **背景**：深色温馨厨房背景，虚化，有质感
- **运镜**：缓慢流畅，慢动作，强调汤汁/油脂黏稠感与蒸汽升腾
- **英文风格关键词（用于 prompt）**：`hyper-realistic, high-end commercial food cinematography, extreme macro detail, shallow depth of field, creamy warm lighting, moody dark cozy kitchen background, slow-motion`

---

## 执行步骤

### Step 1：生成锚点图 A1（起始帧）

**目标**：确立食物主体、场景、构图基准，作为视频的 start_frame。

**生成图片节点，prompt 模板：**

```
Hyper-realistic, high-end commercial food macro photography. Extreme macro angle: [夹取工具，根据食物选择：chopsticks / tongs / spatula] [lift/flip] a [food_detail描述的] {{food}} from a [适配锅具：black iron pan / cast iron skillet / non-stick pan], revealing [食物表面特征：golden-lace crispy crust / seared crust with grill marks / crispy golden edges], with wisps of steam curling upward. Shallow depth of field, moody dark cozy kitchen background, glistening textures, warm cinematic lighting.
```

**夹取工具与锅具选择规则：**

食物类型夹取工具锅具煎饺/煎包wooden chopsticksblack iron pan煎牛排/猪排metal tongscast iron skillet煎蛋/煎鱼/煎饼spatulanon-stick pan其他tongscast iron skillet

保存为锚点 **A1**，记录 node_key。

---

### Step 2：生成锚点图 A2（状态变化帧，派生自 A1）

**目标**：在 A1 基础上，展示食物被切开/戳破/咬开后的多汁内里状态，作为视频内容的视觉参考。

**以 A1 为 reference，image2image 模式，prompt 模板：**

```
Based on {{A1_node_key}}, same [锅具], [夹取工具], moody dark cozy kitchen background, warm creamy lighting and extreme macro shallow depth of field: the {{food}} is now [切开/戳破/撕开，根据食物选择：cut open / torn open / pierced], revealing [内里特征，根据食物描述：burst of thick amber-colored broth and juicy filling / juicy pink interior with seared crust / runny golden yolk], with [汁液状态：sticky sauce strands stretching / juices flowing / yolk dripping] [落点：into a ceramic spoon / onto the cutting board / onto the plate].
```

**内里特征与汁液选择规则：**

食物类型切开方式内里特征汁液状态落点煎饺/煎包torn openthick amber broth and juicy minced meat fillingsticky sauce strands stretchinginto a ceramic spoon煎牛排/猪排cut openjuicy pink/red interior with seared crustmeat juices flowingonto the cutting board煎蛋piercedrunny golden yolkyolk drippingonto the plate煎鱼flaked aparttender white flaky fleshjuices glisteningonto the plate其他cut openjuicy interiorjuices flowingonto the plate

保存为锚点 **A2**，记录 node_key。

---

### Step 3：直接生成完整视频

**以 A1 为 start_frame，一次性生成完整视频，prompt 中融合全部内容描述：**

**prompt 模板：**

```
Hyper-realistic, high-end commercial food cinematography, extreme macro detail, shallow depth of field, creamy warm lighting, moody dark cozy kitchen background, slow-motion.

The video begins with an extreme macro tracking shot: [夹取工具] [lift/flip] a [food_detail描述的] {{food}} from a [锅具], revealing [食物表面特征] that catches the warm light, with wisps of steam curling upward. Slow, fluid camera movement.

The camera then transitions to a super slow-motion close-up: the {{food}} is [切开方式], revealing [内里特征], with [汁液状态] [落点]. The viscosity and glistening quality are accentuated throughout.

Consistent warm cinematic lighting, moody dark cozy kitchen background, and extreme macro shallow depth of field maintained throughout the entire video.
```

**参数：**

- `start_frame_image_node` = A1 node_key
- `reference_nodes` = \[A1 node_key, A2 node_key\]
- `duration_sec` = `{{duration}}`（用户未指定时取 **7**，即默认 6-8 秒范围的中间值）
- `aspect_ratio=16:9, resolution=1080p`

---

## 输出

一段完整的极致微距商业美食视频（默认 6-8 秒），内容涵盖：

- **前段**：夹起/翻起食物，展示金黄酥脆表皮质感与蒸汽升腾
- **后段**：超级慢动作，食物被切开/戳破，展示多汁内里与汁液拉丝

---

## 注意事项

- A2 必须以 A1 为 reference 生成，确保场景/光线/构图连贯
- 视频生成时同时引用 A1 和 A2 作为 reference，帮助模型理解视频的起始与结束状态
- 若用户未提供 `food_detail`，根据食物常识自动补全
- 用户未指定 `{{duration}}` 时，`duration_sec` 传入 **7**