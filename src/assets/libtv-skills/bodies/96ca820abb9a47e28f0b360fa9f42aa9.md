# 赛璐璐风职业短片生成器

## 这个 Skill 做什么

用户提供一张人物参考图和职业/场景设定，Agent 生成一段 15 秒、1 镜到底的 cel-shaded 3D 动画短片。 视频中人物外貌与参考图保持一致，场景和连续动作节拍按用户输入生成。

## 使用时机

- 想为真实人物生成一段有仪式感的职业短片（咖啡师、厨师、花艺师、调酒师等）
- 需要 cel-shaded 手绘质感 + 暖金光氛围 + 1 镜连续叙事风格
- 不适合：写实风格、卡通/迪士尼/皮克斯风格、需要多镜头剪辑的场景

## 用户需要提供

1. **人物参考图**（必须）：清晰的正面或四分之三角度人像，用于提取人物外貌特征
2. **职业/场景设定**（必须）：例如"意式咖啡馆咖啡师""日式花店花艺师""法式餐厅主厨"
3. **动作节拍序列**（可选）：希望在 15 秒内依次呈现的 3\~6 个动作节拍；若不填，Agent 根据职业自动生成

## Agent 执行步骤

### 第一步：提取人物特征

从参考图中提取并记录以下特征，作为全程人物一致性锚点：

- 面部特征（五官轮廓、肤色、眼型）
- 发型与发色
- 体型与姿态特征

### 第二步：生成动作节拍序列

若用户未提供动作节拍，根据职业/场景自动生成 4\~6 个连续动作节拍，要求：

- 每个节拍是一个具体的、可视化的动作（不是状态描述）
- 节拍之间有自然的动作衔接逻辑
- 最后一个节拍以人物的"英雄时刻"收尾（完成某个核心动作后的满足感表情）

### 第三步：组装视频生成提示词

将以下固定锚点与用户输入的槽位组合，生成完整提示词：

**固定锚点（不可修改）：**

- 渲染风格：Cinematic cel-shaded 3D anime, semi-realistic CGI, hand-painted textures, hard-edge brushwork, cel-shaded rendering
- 光影：warm soft shadows, warm golden amber light
- 镜头：shallow depth of field, 1 continuous uncut shot, 15 seconds
- 质感限定：subtle film grain, not cartoon, not Disney, not Pixar
- 叙事基调：each moment breathing and telling its own story, warm and intimate throughout

**槽位（按用户输入替换）：**

- `{{PROTAGONIST}}`：从参考图提取的人物外貌描述，identity and appearance preserved consistently throughout
- `{{SETTING}}`：场景描述（地点、标志性道具、光线氛围）
- `{{ACTION_SEQUENCE}}`：连续动作节拍，用分号分隔，在 15 秒内依次流畅呈现

**完整提示词模板：**

```
Cinematic cel-shaded 3D anime short film, 15 seconds, 1 continuous uncut shot.
Protagonist: {{PROTAGONIST}}, identity and appearance preserved consistently throughout.
Setting: {{SETTING}}.
Action sequence unfolding continuously: {{ACTION_SEQUENCE}}.
Semi-realistic CGI, hand-painted textures, hard-edge brushwork, cel-shaded rendering, warm soft shadows, warm golden amber light, shallow depth of field, subtle film grain, not cartoon not Disney not Pixar, each moment breathing and telling its own story, warm and intimate throughout.
```

### 第四步：生成视频

使用上述提示词调用视频生成模型，输出 15 秒短片。

### 第五步：人物一致性检查

生成完成后，对照第一步提取的人物特征锚点，确认视频中人物外貌与参考图一致。 若存在明显偏差，在提示词中补充更具体的人物特征描述后重新生成。