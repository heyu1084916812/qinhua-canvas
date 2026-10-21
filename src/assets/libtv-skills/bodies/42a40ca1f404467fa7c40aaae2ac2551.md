# 复古工业拼贴海报生成器（自由上传素材版）

## Skill 定位

专门生成融合工业景观与自然元素的复古拼贴海报提示词。用户可自由上传素材图（人物照片、工业场景、自然元素、建筑、植物等），系统自动将其融入黄金比例构图，统一单色调复古配色，加入金色圆形和方形装饰，传达环境主题。适用于 Midjourney / Stable Diffusion 等图像生成工具。

---

## 输入说明

所有输入均为**可选**，未提供时使用默认值补全：

素材类型示例默认值（未上传时）人物图人物照片、剪影、角色参考黑人男性，站立于工厂旁工业场景图工厂、港口、发电站、炼油厂工厂自然元素图鸟、花、蝴蝶、植物、芦苇鸟与花建筑或街道图混凝土建筑、玻璃幕墙、鹅卵石街道混凝土与玻璃建筑、鹅卵石街道配色方案任意单色调复古配色黑、灰、绿为主色，深米色与浅琥珀色为辅画幅比例1:1、16:9、9:16 等4:5（竖版）

> 画面中**不含标题文字**，仅保留图形元素，无需用户提供任何文字内容。

---

## 全局视觉规则

### 素材融合铁律

- 所有上传素材必须被重新统一到同一拼贴风格中，**不能直接堆叠原图**
- 素材之间通过重叠、并置、对比形成拼贴关系
- 素材的颜色、光影、质感必须统一到单色调复古体系中
- 上传的人物保持基本特征（肤色、轮廓、姿态方向），但材质与色调被重新渲染为复古拼贴质感

### 构图铁律

- 严格遵循**黄金比例构图**，视觉焦点落在人物与自然的互动关系上
- 工业元素与自然元素并置，传达环境主题
- 画面整体为拼贴艺术风格，各元素之间有重叠、并置、对比

### 色彩系统

- **默认主色**：黑、灰、绿
- **默认辅色**：深米色、浅琥珀色
- 全图保持统一的复古色调，无高饱和色彩、无明亮原色
- **金色仅用于**圆形和方形几何装饰元素，作为点缀

### 元素组成

- **建筑与地面**：混凝土与玻璃建筑、鹅卵石街道
- **工业主体**：工厂或工业设施
- **自然元素**：鸟、花、热带植物
- **人物**：手伸向建筑上的鸟，肢体语言传递人与自然的联系
- **图形装饰**：金色圆形和方形，以黄金比例位置分布
- **质感**：复古图案纹理、高分辨率细节、复古海报印刷感

### 风格铁律

- 拼贴艺术质感，**非写实摄影，非纯插画**
- 复古海报美学，带有历史感和手工感
- 环境主题叙事感，但**不依赖文字表达**

---

## 内部处理流程

1. **接收素材**：接收用户上传的素材图
2. **解析角色**：识别每张图的角色——人物 / 工业场景 / 自然元素 / 建筑街道 / 装饰参考
3. **缺省补全**：若用户未提供某类素材，使用默认描述补全（见输入说明表格）
4. **构图布局**：按黄金比例逻辑布局工业主体、人物、鸟、植物、几何装饰
5. **统一风格**：统一色彩与质感，确保所有元素符合单色调复古拼贴体系
6. **生成提示词**：输出 Midjourney/SD 正向提示词 + 负向提示词
7. **素材特征引用**：在提示词中明确引用用户上传素材的核心特征（如轮廓、姿态、场景特点）

---

## 提示词模板

### 通用模板（含素材引用）

```
A vintage collage artwork featuring [工业场景描述], with [自然元素描述], centered on [人物描述——若用户上传人物图，则描述其核心特征与姿态], one hand raised toward a bird perched on the building. The composition follows the golden ratio principle and conveys environmental themes through a [配色描述] color palette with vintage patterns. The high-resolution image combines [建筑与街道描述], tropical plants, and graphic design elements including golden circles and squares, all rendered in a monochromatic scheme with [辅助色调] tones that create a cohesive vintage poster aesthetic. All elements are unified into the same vintage collage style, re-colored and re-textured to match the palette. --ar [画幅] --style raw
```

### 默认提示词（未上传任何素材时使用）

```
A vintage collage artwork featuring an industrial plant with birds and flowers, centered on a black man standing near a factory, one hand raised toward a bird perched on the building. The composition follows the golden ratio principle and conveys environmental themes through a black, gray, and green color palette with vintage patterns. The high-resolution image combines concrete and glass buildings, cobblestone streets, tropical plants, and graphic design elements including golden circles and squares, all rendered in a monochromatic scheme with dark beige and light amber tones that create a cohesive vintage poster aesthetic. --ar 4:5 --style raw
```

### 真实案例提示词（亚洲女性 × 威尼斯建筑 × 中式屋檐）

> 素材输入：人物图（短卷发+针织帽亚洲女性）、建筑图（威尼斯巴洛克穹顶教堂）、自然元素图（热带植物）

```
Vintage collage poster, Asian woman with short curly hair and knit beanie, side-walking pose, one hand raised toward a bird on a Chinese dragon-carved roof eave. Background: Venice baroque domed cathedral over water. Left: tropical monstera and palm leaves. Golden ratio spiral and square outlines as decorations, golden circle on right. Cobblestone ground. Monochromatic palette: black, gray, muted green dominant, dark beige and light amber secondary. All elements re-textured into unified vintage collage style, no original photo texture. --ar 4:5 --style raw
```

### 负向提示词（所有情况通用）

```
bright saturated colors, modern digital art, smooth clean vector, 3D render, cartoon, no texture, low detail, cluttered composition, missing vintage feel, white background, neon colors, rainbow colors, glossy finish, original photo texture not unified, mismatched lighting, mismatched color temperature
```

---

## 交互逻辑

- 用户上传素材后若**缺少某类元素**（如没有自然元素），询问是否使用默认元素补全
- 若用户上传的**人物图面部模糊或角度特殊**，尽量保留轮廓与姿态，但提示可能需要微调
- 若用户希望某张素材作为**主要视觉焦点**，可指定优先级
- 若用户希望**调整配色或画幅**，可直接指定
- 其余情况自动融合生成提示词

---

## 自检清单

生成提示词前，逐项确认：

- \[ \] 是否将用户上传的素材统一到同一拼贴风格和单色调中
- \[ \] 是否遵循黄金比例构图
- \[ \] 是否包含工业元素与自然元素的并置
- \[ \] 是否有金色圆形和方形装饰元素
- \[ \] 配色是否保持单色调复古
- \[ \] 是否包含人物与鸟的互动
- \[ \] 是否体现拼贴艺术质感与复古海报美学
- \[ \] 是否无标题文字，仅保留图形元素
- \[ \] 上传素材的特征是否被保留但重新渲染为复古质感