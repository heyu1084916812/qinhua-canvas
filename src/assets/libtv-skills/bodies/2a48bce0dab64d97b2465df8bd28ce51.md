# 日系复古青春电影风 · 图片生成指南

## 一、Skill 定位

用户提供场景描述或主题，Agent 按照本指南的风格锚点，构建完整的生成提示词，并输出符合"日系复古青春电影风"的图片。

---

## 二、风格锚点（固定不变，所有生成任务均须遵守）

### 2.1 色彩与质感

- **复古褪色感**：低对比度 + 低饱和度。暗部不死黑，亮部不过曝，整体呈柔和的灰蒙蒙质感（faded look）。
- **冷暖色调对撞**：天空与海面使用日系特有的青蓝色（Teal），阳光区域使用暖橘色/浅灰黄，形成"暖高光 + 冷阴影"的经典对比。
- **胶片物理模拟**：拒绝数码锐利感。画面须带有明显的 35mm 胶片噪点颗粒，边缘轻微朦胧（柔光镜效果）。

### 2.2 光线与氛围

- **自然光为主**：主打午后或黄昏（Golden Hour）的柔和自然光。
- **逆光/侧逆光**：大量使用，勾勒人物头发的金色轮廓光（发丝光）。
- **柔和光影过渡**：光影对比不生硬，但须保留清晰的地面斜长投影以交代光源位置。
- **情感基调**：松弛、治愈、美好，同时夹杂对时光逝去的怀旧与淡淡感伤（日系"物哀"美学）。

### 2.3 构图与镜头语言

- **纵深与透视**：偏爱单点透视（延伸的沿海公路、乡间小道），利用道路白线或防波堤形成强烈的视觉引导线。
- **旁观者视角**：第三人称平视或微俯视跟拍，构图松弛，营造不经意的"生活流"抓拍感。
- **物理电影感**：强制采用宽银幕画幅（Letterbox 上下黑边），画面可点缀细小的电影感英文字母及手写体中文标题。
- **景深策略**：环境全景保持深景深；人物特写使用浅景深虚化背景，聚焦情绪互动。

### 2.4 人物与场景元素（锚定符号）

**人物**

- 清纯少女形象，短发/编发，穿着素雅的白色或浅蓝色棉麻质感连衣裙，佩戴编织草帽。
- 若需代入感：强制设为单人背影（不露脸），处于行走等动态中，背双肩包。
- 禁止模特直视镜头进行刻意摆拍。

**场景道具（经典日系符号）**

- 室外：沿海公路（柏油路面 + 白色交通分隔线）、混凝土防波堤、电线杆、复古自行车、乡间小道。
- 室内：老式电风扇、日式推拉门、旧杂志、老式显像管电视机、蓝白格纹床单。

### 2.5 视觉禁忌

- ❌ 严禁使用高饱和度亮色
- ❌ 严禁出现生硬的黑白高对比
- ❌ 严禁模特直视镜头刻意摆拍
- ❌ 严禁数码相机极致锐利感

---

## 三、执行流程

### Step 1：理解用户输入

读取用户提供的场景描述或主题，识别以下要素：

- **主体**：人物数量、动作、穿搭
- **环境**：室内/室外、具体场景
- **情绪基调**：治愈/怀旧/青春/感伤

若用户输入过于简短（如只有"夏天"两字），主动补充符合风格的默认场景元素，并告知用户。

### Step 2：构建生成提示词

按以下结构组装 Prompt：

```
[主体] + [环境] + [光影与视角] + [风格关键词]
```

**风格关键词（固定附加，每次生成必须包含）：**

```
Japanese film photography, cinematic letterbox format, muted colors, low contrast, low saturation, faded look, Teal and Orange color grading, 35mm film grain, soft focus edges, golden hour, backlighting, rim light on hair, nostalgic vibe, slice of life, wabi-sabi aesthetic
```

**示例 Prompt（沿海公路背影场景）：**

```
1 girl, back view, walking away, wearing a backpack, light blue shirt, long skirt,
on an asphalt coastal road, white road line, concrete seawall and ocean on the right,
hillside with houses and trees on the left, utility poles,
sunny day, casting shadow, one-point perspective, leading lines, wide shot,
Japanese film photography, cinematic letterbox format, muted colors, low contrast,
low saturation, faded look, Teal and Orange color grading, 35mm film grain,
soft focus edges, golden hour, backlighting, rim light on hair,
nostalgic vibe, slice of life, wabi-sabi aesthetic
```

### Step 3：生成图片

- 使用图片生成节点，将 Step 2 构建的完整 Prompt 输入。
- 推荐生成比例：**16:9** 或 **2.35:1**（宽银幕）。
- 如需多张对比，可在主体或场景上做微调，保持风格关键词不变。

### Step 4：输出结果

- 输出生成的图片。
- 同时附上本次使用的完整 Prompt，方便用户二次调整。

---

## 四、典型场景参考

场景描述核心构图要素沿海公路背影单点透视、白色路线、防波堤、电线杆、单人背影行走室内慵懒午后浅景深、窗边斜光、老式风扇前景、人物侧脸/背影海边/湖边休憩逆光发丝光、青蓝色水面、草帽少女、浅景深虚化水面乡间小道骑行两人背影、复古自行车、侧逆光、绿植两侧黄昏室内凝视冷暖对撞最强、窗外青蓝天空、室内暖橘余晖、人物背影