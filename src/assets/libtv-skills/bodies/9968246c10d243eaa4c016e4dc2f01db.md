# 风格锚定生图器

## 这个 Skill 是什么

接收用户指定的「风格名称」和「内容描述」，自动展开风格关键词、拼合完整英文 prompt，并直接调用图像生成工具输出一张风格化图像。

适用场景：需要快速生成带有特定视觉风格的图像时使用。 不适用场景：生成视频脚本、文案、非图像类内容。

---

## 输入格式

用户需提供以下两项：

- **风格名称**：如「日系胶片感」「赛博朋克」「水墨国风」「美式电影感」等
- **内容描述**：如「一个女孩站在雨夜街头」「一辆老式轿车停在星空下」

可以用任意自然语言格式输入，例如：

- 「风格：日系胶片感，内容：一个女孩站在雨夜街头」
- 「帮我生成赛博朋克风格的，内容是一只机械猫」

---

## 执行步骤

### Step 1：识别输入

从用户输入中提取：

- `{style}`：风格名称
- `{subject}`：内容描述

如果缺少其中任意一项，用 `ask_parent_agent` 询问缺失的部分，不要自行补全。

如果 `{style}` 是模糊或生僻的名称，先用 `ask_parent_agent` 向用户确认具体指哪种视觉特征，再继续。

### Step 2：调用「风格锚定 Prompt 生成器」

调用 skill `libtv-user-generated/style-anchor-prompt-f1cd68423b354abba991fe16eb70fb0a`，传入 `{style}` 和 `{subject}`，获得一条完整的英文图像生成 prompt。

### Step 3：调用图像生成工具

将 Step 2 输出的完整英文 prompt 传入图像生成工具，生成图像并输出给用户。

### Step 4：输出结果

直接展示生成的图像，无需额外解释。如有必要，可在图像下方附一行简短说明，标注所用风格和主要关键词，方便用户理解和调整。

---

## 示例

**输入**：风格：美式电影感，内容：一辆老式轿车停在满天星空下

**中间 prompt（Step 2 输出）：**

```
a vintage classic car parked under a vast starry night sky, American cinematic Hollywood film look, warm golden and teal-orange color grading, dramatic directional moonlight with deep shadows, anamorphic lens with shallow depth of field, widescreen dramatic composition, fine film grain, polished blockbuster visual quality
```

**输出**：一张美式电影感风格的图像。