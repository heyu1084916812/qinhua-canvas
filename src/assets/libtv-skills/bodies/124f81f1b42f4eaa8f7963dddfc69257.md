# 鬼武者战斗场景生成

## 这个 Skill 做什么

用户提供一张角色参考图，Agent 将图中角色转换为《鬼武者》(Onimusha) 游戏风格的武士鬼战士，生成一段电影化动作战斗场景。

整体视觉风格固定为 Onimusha 风格锚点（见下方），战斗动作/敌人/招式内容由用户每次调用时自定义。

---

## 输入

- **必填**：一张角色参考图（人物、角色设计图、肖像均可）
- **可选**：战斗动作描述槽位 `{{action_description}}`
  - 示例："与敌方鬼怪进行动态刀剑格斗，劈砍击倒敌人"
  - 若用户未提供，使用默认值："the warrior engages in dynamic sword combat against enemy demons, slashing and striking down the foes"

---

## 固定风格锚点（每次调用均保持不变）

以下参数写死，不随用户输入变化：

- 武器：glowing katana（发光武士刀）
- 光影：dramatic low-key lighting（戏剧性低调光影）
- 时代氛围：dark Sengoku-era atmosphere（战国时代阴暗氛围）
- 画面质感：stylized game cinematic rendering（风格化游戏影像质感）
- 运镜：fast-paced motion, dynamic camera movement（快节奏动作、动态镜头运动）
- 整体风格参照：Onimusha game series（鬼武者游戏系列）

---

## 执行步骤

### Step 1：接收输入

1. 获取用户上传的角色参考图。
2. 读取用户提供的 `{{action_description}}`；若未提供，使用默认值。

### Step 2：构建生成 Prompt

将以下模板中的槽位替换后，作为图生图/图生视频的生成指令：

```
Transform the character from the input image into a samurai demon warrior in the style of the Onimusha game series: cinematic action scene, the warrior wields a glowing katana and {{action_description}}, dramatic low-key lighting, dark Sengoku-era atmosphere, stylized game cinematic rendering, fast-paced motion, dynamic camera movement
```

**默认 Prompt（用户未填写动作描述时）：**

```
Transform the character from the input image into a samurai demon warrior in the style of the Onimusha game series: cinematic action scene, the warrior wields a glowing katana and engages in dynamic sword combat against enemy demons, slashing and striking down the foes, dramatic low-key lighting, dark Sengoku-era atmosphere, stylized game cinematic rendering, fast-paced motion, dynamic camera movement
```

### Step 3：生成场景

使用图生图或图生视频模型，以 Step 1 的角色参考图为输入，以 Step 2 构建的 Prompt 为指令，生成战斗场景。

- 优先生成视频；若当前环境不支持视频生成，退回生成图像。
- 保持角色与参考图的外貌一致性（面部特征、体型、服装基础轮廓）。

### Step 4：输出结果

直接输出生成的战斗场景视频或图像，无需额外说明。

---

## 约束与禁止项

- **不得**修改固定风格锚点中的任何参数（光影、氛围、质感、运镜）。
- **不得**在用户未要求的情况下更换武器类型（始终为发光武士刀）。
- **不得**在角色转换过程中丢失参考图中角色的核心外貌特征。
- 若用户上传的图片不包含可识别的人物/角色，告知用户"请上传包含角色的图片"，不继续生成。