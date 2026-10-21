# 中式天庭仙境图生视频 · 完整流程 Skill

## Skill 说明

本 Skill 提供一套完整的两阶段创作流程：

1. **第一阶段**：生成雾蒙蒙中式仙境天庭质感图片
2. **第二阶段**：基于图片生成对应运镜方式的视频

用户只需提供简单的场景描述（或直接使用默认风格），即可得到风格统一的图片和视频。

---

## 第一阶段：生成中式天庭仙境图片

### 风格锚点（固定，每次生成必须完整带入）

**色调与光线**

- 暖白象牙金色调为主，绝对不转蓝、不偏冷
- 光线漫射 + 逆光 + 丁达尔光效（光柱穿透云雾）
- 整体曝光偏高，营造仙气弥漫感

**氛围与环境**

- 云雾弥漫、云海翻涌、祥云飘动
- 雾气浓度高，远景建筑若隐若现
- 空气中有细腻的光粒子感

**建筑与场景**

- 中式古典建筑：宫殿、廊柱、亭台楼阁、石桥、汉白玉石栏
- 建筑体量宏伟，纵深感强，空间层次丰富
- 可选元素：参天神树、莲花池、云端石阶

**人物**

- 白衣仙人，体型渺小（衬托建筑宏伟感）
- 人物动作可选：持伞行走、盘坐入定、划船、仰望、远眺

**画质**

- 超写实风格，细节精致
- 分辨率建议：16:9 横构图

### 图片生成 Prompt 模板

```
[场景描述槽位] in a misty Chinese celestial palace, 
ivory warm golden tones, no blue shift, 
volumetric god rays piercing through dense clouds, 
diffused soft light with backlight effect, 
ancient Chinese architecture: grand palace halls, stone corridors, marble railings, stone bridges, pavilions, 
thick rolling sea of clouds, auspicious cloud wisps floating, 
a tiny white-robed immortal figure [人物动作槽位], 
towering architectural scale creating depth and grandeur, 
ultra-realistic, hyper-detailed, cinematic composition, 
rich spatial layers, dreamlike atmosphere, 
8K, masterpiece quality
```

**槽位说明**

- `[场景描述槽位]`：用户输入的主题，如 "a lone immortal rowing a small boat through a cave entrance"
- `[人物动作槽位]`：如 "walking with an oil-paper umbrella"、"sitting in meditation with back to camera"、"gazing up at a giant sacred tree"

**负向提示词（Negative Prompt）**

```
blue tones, cold color, modern buildings, realistic human face close-up, 
low quality, blurry, oversaturated, neon, sci-fi, dark background, 
extra limbs, deformed
```

---

## 第二阶段：生成对应运镜视频

基于第一阶段生成的图片，选择对应的运镜方式生成视频。

### 五种运镜模板（按场景选择一种）

运镜 1 · 划船入境

**适用场景**：人物在洞穴/暗处划船，向光源方向移动 **运镜描述**：

- 镜头从暗处缓慢向光源方向推进（Slow Push-In toward light）
- 云雾弥漫，光线从洞口/远处透入
- 节奏：神秘缓慢，逐渐揭开仙境

**视频生成 Prompt**：

```
Slow camera push-in from a dark cave entrance toward a bright misty light source, 
a tiny figure rowing a small boat on still water, 
dense fog and cloud wisps drifting, 
warm ivory golden light pouring in from the distance, 
ancient Chinese celestial palace architecture visible through the mist, 
cinematic, ultra-realistic, smooth camera movement, no shake
```

---

运镜 2 · 持伞登临

**适用场景**：白衣人物持伞行走，展现建筑全貌 **运镜描述**：

- 镜头跟随人物侧移（Lateral Tracking Shot）或缓慢跟随推进
- 展现宏伟建筑全景
- 节奏：从容优雅，建筑逐渐展开

**视频生成 Prompt**：

```
Smooth lateral tracking shot following a white-robed immortal holding an oil-paper umbrella walking along stone steps, 
grand Chinese palace architecture revealed in the background, 
misty clouds drifting around the pillars and corridors, 
warm golden ivory tones, soft diffused backlight, 
cinematic wide shot, ultra-realistic, no camera shake
```

---

运镜 3 · 仰望巨树

**适用场景**：人物仰望参天神树，展现树木高度 **运镜描述**：

- 仰角镜头，镜头缓慢上摇（Slow Tilt-Up from low angle）
- 从人物脚部/腰部开始，摇至树冠消失于云雾
- 节奏：震撼、敬畏感

**视频生成 Prompt**：

```
Slow upward tilt shot from low angle, starting at the base of an enormous sacred tree, 
camera tilts up revealing the massive trunk and branches disappearing into misty clouds, 
a tiny white-robed figure standing at the base looking up, 
warm golden light filtering through the canopy, 
ancient Chinese celestial atmosphere, ultra-realistic, cinematic
```

---

运镜 4 · 俯瞰天宫

**适用场景**：高角度展现天宫长廊全景，恢宏壮阔 **运镜描述**：

- 高角度俯拍 + 缓慢平移（High-angle Overhead Pan）
- 展现天宫长廊、宫殿群的宏大全景
- 节奏：恢宏壮阔，视觉高潮

**视频生成 Prompt**：

```
High-angle aerial overhead shot slowly panning across a vast Chinese celestial palace complex, 
endless stone corridors and grand palace halls stretching into the misty horizon, 
sea of clouds surrounding the architecture, 
warm ivory golden tones, dramatic scale, 
tiny immortal figures visible on the walkways, 
cinematic epic wide shot, ultra-realistic, smooth pan movement
```

---

运镜 5 · 盘坐入定

**适用场景**：人物背对镜头盘坐，安静收尾 **运镜描述**：

- 镜头缓慢拉远（Slow Pull-Back / Dolly Out）
- 人物背对镜头盘坐，镜头拉远直至人物渺小
- 节奏：安静、禅意、收尾感

**视频生成 Prompt**：

```
Slow dolly pull-back shot, a white-robed immortal sitting in meditation with back to camera, 
camera slowly retreats revealing the vast celestial palace and endless cloud sea, 
figure becomes smaller and smaller against the grand architecture, 
warm golden misty atmosphere, peaceful and serene, 
cinematic, ultra-realistic, smooth camera movement
```

---

## 完整使用流程

### Step 1：确认场景主题

询问用户（或由用户直接提供）：

> "你想要哪种场景？可以直接描述，或从以下选择：划船入境 / 持伞登临 / 仰望巨树 / 俯瞰天宫 / 盘坐入定"

### Step 2：生成图片

- 将用户的场景描述填入图片 Prompt 模板的槽位
- 使用图片生成工具生成，参数建议：16:9，高分辨率
- 展示图片，询问用户是否满意，不满意则调整 Prompt 重新生成

### Step 3：选择运镜方式

- 根据用户选择的场景，自动匹配对应运镜模板
- 也可由用户手动选择其他运镜方式

### Step 4：生成视频

- 以 Step 2 生成的图片为参考，使用视频生成工具
- 带入对应运镜的视频 Prompt
- 建议参数：16:9，16秒，720P 或以上

### Step 5：交付成果

- 输出图片 + 视频
- 如需调整，可单独重新生成图片或视频，不必重跑全流程

---

## 风格一致性注意事项

- **色调**：全程保持暖白象牙金，不转蓝，不加冷色滤镜
- **云雾**：图片和视频中的云雾密度保持一致，不额外叠加烟雾特效
- **人物比例**：人物始终渺小，建筑始终宏伟，不要让人物占据画面主体
- **运动**：视频镜头运动平滑，无抖动、无速度渐变、无二次缩放
- **转场**（如需剪辑多段）：第一段用极短白光或云雾溶解，其余用形状匹配硬切或不超过 0.2 秒短叠化