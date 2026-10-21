# 梦核坠落幻觉视频生成工作流

## 工作流概述

本 Skill 将用户提供的参考照片，经过两个阶段生成完整的梦核（Dreamcore）坠落幻觉视频作品：

- **阶段一**：生成 10 张超现实场景图 + 1 张封面海报
- **阶段二A**：将 10 张场景图合成为 1 段 30 秒一镜到底视频
- **阶段二B**：将场景图分组生成 3 段分镜视频，经智能剪辑合成成片

---

## 核心风格锚点（所有图片节点通用）

所有图片生成节点必须遵守以下基础风格约束，不得偏离：

```
Dreamcore surreal image, no humans, no people, no figures, no silhouettes, no red lines, no guidelines.
```

- **色调**：暗调、电影感、梦境感，以深色/冷色为主
- **物体变形规则**：场景中的物体必须处于"变形中途"状态（mid-transformation），例如沙发正在变成鲸鱼、时钟正在变成花朵、储物柜正在变成鸟群
- **禁止元素**：无人物、无人形轮廓、无红色引导线、无标注线

---

## 阶段一：生成 10 张超现实场景图

每张场景图由 **3 张参考图** 输入生成，参考图提供场景氛围、色调和空间感参考。

### 场景图生成规则

每张场景图对应一个独特的**构图方式**和**场景融合组合**，构图方式是锚点（固定不变），场景组合是槽位（可替换为用户自己的场景主题）。

---

### I-01：街角×地铁×花园 — 仰角构图

**构图锚点**：

```
COMPOSITION: extreme low-angle worm's-eye view, camera looking straight up from the ground, the subway platform ceiling looms overhead, tiles stretch into infinite distance above.
```

**场景槽位**（可替换）：

- 场景融合：地铁站台 + 街角 + 花园
- 变形物体：交通灯正在变成一条鱼，鱼的单眼转向观者
- 地面细节：站台瓷砖爆发出数千个细小黑洞，向上延伸消失

**参考图输入**：3 张参考照片（提供室外街角/地铁/植物相关参考）

---

### I-02：花园×室内×废墟 — 俯瞰构图

**构图锚点**：

```
COMPOSITION: extreme bird's-eye view overhead shot, camera looking straight down from above, the living room floor seen from directly overhead, furniture arranged below like a map.
```

**场景槽位**：

- 场景融合：昏暗客厅废墟 + 室内花园
- 变形物体：浇水壶正在变成老式电话，听筒朝上面向镜头
- 墙面细节：墙壁变成蜂巢状结构

**参考图输入**：3 张参考照片

---

### I-03：地铁×医院×学校 — 斜角构图

**构图锚点**：

```
COMPOSITION: dutch angle tilted 45 degrees, horizon severely slanted, disorienting diagonal framing, everything off-kilter.
```

**场景槽位**：

- 场景融合：地铁站 + 医院走廊 + 学校走廊
- 变形物体：巨大时钟正在变成盛开的花朵，花瓣朝观者旋转
- 轨道细节：铁轨分解成数千个细小金属球，密集如虫卵，部分漂浮

**参考图输入**：3 张参考照片

---

### I-04：室内×废墟×地铁 — 极近景构图

**构图锚点**：

```
COMPOSITION: extreme close-up macro shot, filling the entire frame with a single transformed object in intimate detail, background blurred into abstraction.
```

**场景槽位**：

- 变形物体：沙发正在变成鲸鱼，巨大眼睛占据画面大部分，虹膜倒映无限走廊，皮肤纹理从织物编织过渡到鲸脂，缝线变成藤壶
- 背景：天花板虚化，隐约可见地铁站结构

**参考图输入**：3 张参考照片

---

### I-05：超现实空间×电子设备×冥界 — 无限透视构图

**构图锚点**：

```
COMPOSITION: infinite tunnel one-point perspective, single vanishing point dead center, corridor stretches to infinity, strong symmetrical convergence lines pulling the eye into the center void.
```

**场景槽位**：

- 场景融合：抽象白色虚空 + 复古电子设备 + 地下地狱景观
- 变形物体：合成器正在变成肉体与电缆构成的树，枝条向走廊两侧延伸

**参考图输入**：3 张参考照片

---

### I-06：学校×巨物空间×电子设备 — 广角远景构图

**构图锚点**：

```
COMPOSITION: wide establishing shot, camera pulled far back, entire scene visible from a distance, vast empty space dominating the frame, subject small against enormous environment.
```

**场景槽位**：

- 场景融合：空旷学校走廊 + 建筑物大小的巨型卡带播放机
- 变形物体：储物柜正在变成一群鸟，散落在宽阔画面中
- 地面细节：地板覆盖着密集的细小物体

**参考图输入**：3 张参考照片

---

### I-07：地下通道×冥界×电子设备 — 镜像对称构图

**构图锚点**：

```
COMPOSITION: mirror reflection split-frame, the image divided horizontally at center, top half is the real scene, bottom half is its perfect mirror reflection creating a Rorschach-like symmetry, reality and reflection bleeding into each other.
```

**场景槽位**：

- 场景融合：地下通道过渡到冥界，倒映在静止黑水中
- 变形物体：中间的门正在变成镜子，反射面渗入现实

**参考图输入**：3 张参考照片

---

### I-08：冥河×电子设备×室内 — 水平侧视构图

**构图锚点**：

```
COMPOSITION: side profile lateral tracking shot angle, camera positioned at water level looking horizontally across the river surface, the black water stretching to the horizon, objects seen from the side at eye-level with the river.
```

**场景槽位**：

- 场景融合：黑色地下河流 + 漂浮在水面的废弃客厅
- 变形物体：复古音箱正在变成动物形态

**参考图输入**：3 张参考照片

---

### I-09：地狱神殿×电子设备×花园 — 螺旋俯视构图

**构图锚点**：

```
COMPOSITION: spiral overhead vortex shot, camera looking straight down into a circular spiral arrangement, everything arranged in concentric rings around a central void, like looking down into a whirlpool or drain.
```

**场景槽位**：

- 场景融合：黑色石材地下神殿 + 从祭坛生长的花园
- 变形物体：键盘按键正在变成一排排牙齿，从中心向外螺旋排列

**参考图输入**：3 张参考照片

---

### I-10：虚空终章·多场景碎片 — 碎镜多视角构图

**构图锚点**：

```
COMPOSITION: fragmented multi-panel shattered glass composition, the frame itself broken into irregular shards like a cracked mirror, each shard showing a different scene at a different angle simultaneously, edges of shards dark.
```

**场景槽位**：

- 场景融合：无底虚空中包含街角、花园、地铁、客厅、医院的碎片，每个碎片通过不同破碎玻璃面板呈现
- 此场景为终章，汇聚前序所有场景的视觉元素

**参考图输入**：3 张参考照片

---

## 阶段一附加：封面海报生成

**节点名称**：梦核坠落 封面海报

**输入**：I-01（仰角）、I-09（螺旋俯视）、I-10（碎镜）三张场景图

**Prompt 锚点**：

```
Dreamcore surreal vertical poster design, no humans, no figures. Dark cinematic composition referencing the visual style of [I-01] for the upper dreamcore atmosphere, [I-09] for the spiral hellscape mid-section, and [I-10] for the shattered void lower section. A bottomless void with fragments of subway station, ruined living room, and underground hellscape layered in depth, fused together in a dreamlike collage. The center of the poster opens into a deep abyss glowing dark.
```

**衍生变体**：封面海报生成后，可再生成 2 张变体图（图片节点 1、图片节点 2）

---

## 阶段二A：30 秒一镜到底视频

**节点名称**：梦核坠落 - 30秒一镜到底

**输入**：全部 10 张场景图（I-01 至 I-10）

**视频要求**：

- 时长：30 秒
- 风格：一镜到底，场景之间无缝穿梭过渡，具有视觉冲击力
- 运镜：跟随各场景的构图特征（仰角→俯瞰→斜角→极近景→无限透视→广角→镜像→侧视→螺旋→碎镜），形成坠落感的视觉叙事
- 过渡要求：场景间需有流畅的视觉过渡，避免硬切，利用首尾帧衔接

> ⚠️ 注意：此节点在原画布中无产出 URL，表示尚未成功生成，执行时需重新生成。

---

## 阶段二B：3 段分镜视频 + 智能剪辑合成

### 分镜视频分组

**视频节点 2**（v-hRbCz2narU）

- 输入场景图：I-04、I-02、I-03、I-05、I-01、I-06
- 产出：15 秒分镜视频

**视频节点 3**（v-Xp6zD5wp53）

- 输入场景图：I-07、I-09、I-10、I-08
- 产出：15 秒分镜视频

**视频节点 4**（v-d7AZf1rBgU）

- 输入场景图：I-07、I-05、I-06
- 产出：15 秒分镜视频

### 智能剪辑合成

**节点名称**：智能剪辑 1

**输入**：视频节点 2 + 视频节点 3 + 视频节点 4

**输出**：智能剪辑 1 成片（完整合成视频）

---

## 完整依赖关系图

```
参考图组A (IMG_1306, IMG_1270, IMG_1301)
    └─→ I-03 地铁×医院×学校（斜角）─→ [视频节点2] [30秒视频]

参考图组B (IMG_1271, IMG_1275, IMG_1307)
    └─→ I-04 室内×废墟×地铁（极近景）─→ [视频节点2] [30秒视频]

参考图组C (IMG_1269, IMG_1268, IMG_1302)
    └─→ I-02 花园×室内×废墟（俯瞰）─→ [视频节点2] [30秒视频]

参考图组D (IMG_1265, IMG_1264, IMG_1266)
    └─→ I-01 街角×地铁×花园（仰角）─→ [视频节点2] [30秒视频] [封面海报]

参考图组E (IMG_1265, IMG_1276, IMG_1264)
    └─→ I-09 地狱神殿×电子设备×花园（螺旋俯视）─→ [视频节点3] [30秒视频] [封面海报]

参考图组F (IMG_1277, IMG_1275, IMG_1278)
    └─→ I-10 虚空终章（碎镜多视角）─→ [视频节点3] [30秒视频] [封面海报]

参考图组G (IMG_1271, IMG_1303, IMG_1267)
    └─→ I-08 冥河×电子设备×室内（水平侧视）─→ [视频节点3] [30秒视频]

参考图组H (IMG_1269, IMG_1268, IMG_1272)
    └─→ I-07 地下通道×冥界×电子设备（镜像对称）─→ [视频节点3] [视频节点4] [30秒视频]

参考图组I (IMG_1277, IMG_1276, IMG_1266)
    └─→ I-05 超现实空间×电子设备×冥界（无限透视）─→ [视频节点2] [视频节点4] [30秒视频]

参考图组J (IMG_1273, IMG_1274, IMG_1279)
    └─→ I-06 学校×巨物空间×电子设备（广角远景）─→ [视频节点2] [视频节点4] [30秒视频]

封面海报（I-01 + I-09 + I-10）─→ 封面变体图1 + 封面变体图2

视频节点2 + 视频节点3 + 视频节点4 ─→ 智能剪辑1 ─→ 智能剪辑1成片
```

---

## 执行顺序

1. 准备参考图（建议 11 张，覆盖室内/室外/地铁/学校/自然等多种场景）
2. 并行生成 10 张场景图（每张独立，可并行执行）
3. 生成封面海报（依赖 I-01、I-09、I-10 完成后执行）
4. 并行执行两条视频链路：
   - **链路A**：10 张场景图 → 30 秒一镜到底视频
   - **链路B**：场景图分组 → 视频节点2/3/4 → 智能剪辑 → 成片