# 角色四视图生成

## Skill 定位

输入一张角色全身立绘参考图，生成包含**正面头像特写 + 正面/侧面/背面全身立绘**的标准四视图，从左到右依次排列，输出纯图像内容（不含任何文字标注），输出比例固定为 **16:9**。适用于任意风格（古风、现代、奇幻、科幻等）和任意性别角色。

---

## 用户输入

| 项目 | 说明 |
|---|---|
| 角色参考图 | 一张角色全身立绘图（正面或四分之三视角均可），作为图生图的参考输入 |
| 风格描述（可选） | 如有特定风格要求可补充，例如"古风仙侠""赛博朋克""写实风" |

---

## 工作流

### 节点 1：四视图生成

- **节点类型**：图生图（Image-to-Image）
- **上游输入**：用户上传的角色全身立绘参考图（对应画布节点 `i-OofjoHnUbx`）
- **输出**：四视图一张，比例 16:9（对应画布节点 `i-LwFlS6afzM`）

#### Prompt 要求

**正向 Prompt 核心结构（根据角色实际特征填入槽位）：**

```
character design sheet, four views, close-up face portrait on the leftmost,
front view, side view, back view,
[角色性别，如 1girl / 1boy],
[角色发色，如 white hair / black hair],
[角色服装描述，如 white hanfu dress / armor / modern outfit],
[角色风格，如 xianxia style / fantasy / sci-fi / modern],
full body, standing pose, white background, clean lineart, high detail,
multiple views, turnaround sheet, character reference sheet,
consistent character design, same character in all views,
no text, no labels, no captions, no annotations, no watermark
```

**负向 Prompt（锚点，固定不变）：**

```
multiple characters, different characters, inconsistent design, deformed, bad anatomy,
extra limbs, missing limbs, blurry, low quality,
text, label, caption, annotation, watermark, logo, subtitle,
FRONT, SIDE, BACK, CLOSE-UP, 正面, 侧面, 背面, 特写
```

#### 参数锚点

| 参数 | 推荐值 | 说明 |
|---|---|---|
| 图生图参考强度（Denoising Strength） | 0.55 ~ 0.70 | 保留角色特征的同时允许多视角变化 |
| **图像尺寸（宽高比固定 16:9）** | **1280×720 / 1920×1080 / 1024×576** | 四视图横向排列，比例必须为 16:9，不得使用其他比例 |
| 采样步数 | 28 ~ 35 | 保证细节质量 |
| CFG Scale | 7 ~ 9 | 标准范围 |
| 参考图权重（ControlNet / IP-Adapter，如使用） | 0.6 ~ 0.8 | 保持角色外观一致性 |

---

## 四视图布局说明（锚点）

生成的四视图在一张图内横向排列，**从左到右依次为**：

1. **正面头像特写**（最左侧，上半身/头部，展示面部细节）
2. **正面全身立绘**（角色正面，展示完整服装和体型）
3. **侧面全身立绘**（角色侧面，展示轮廓和层次）
4. **背面全身立绘**（最右侧，角色背面，展示背部服装细节）

> ⚠️ 输出图像中**不得包含任何文字**，包括但不限于视角标注（FRONT / SIDE / BACK / CLOSE-UP）、角色名称、说明文字、水印等。

---

## 参考示例

- **输入参考图**：白发白裙古风仙侠风格女性角色全身立绘（正面）
- **输出四视图**：同一角色的正面头像特写（最左）+ 正面/侧面/背面全身立绘，白色背景，16:9 比例，无任何文字标注

> 示例来源：画布节点 `i-OofjoHnUbx`（全身立绘）→ `i-LwFlS6afzM`（四视图）

---

## 质量检查要点

- [ ] 输出图像比例为 **16:9**（如 1280×720、1920×1080、1024×576）
- [ ] 从左到右依次为：**正面头像特写、正面全身立绘、侧面全身立绘、背面全身立绘**
- [ ] 图像中**无任何文字**（无视角标注、无水印、无说明文字）
- [ ] 四个视角的角色外观（发色、服装、体型）保持一致
- [ ] 背景干净（白色或纯色）
- [ ] 无多余人物、无肢体变形
- [ ] 头像特写与全身立绘的面部特征一致
- [ ] 侧面/背面服装细节与正面对应