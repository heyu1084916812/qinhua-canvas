# 品牌全案设计生成器（全风格适配版）

## 这个 Skill 做什么

输入品牌基础信息 → 锁定一套统一的视觉基因 + 一张物料质感矩阵 → 输出各类物料的 AI 设计提示词 → 在站内按提示词批量出图。最终交付：成套品牌设计稿 + 可复制到 Midjourney / Stable Diffusion 复用的提示词文本。

**物料范围（13 类）**：Logo、VI 系统（含实物物料）、电商详情页、三折页、官网、IP 吉祥物、**VI Logo 视觉符号规范页**、**IP 视觉符号 12 宫格**、门店美陈设计效果图、品牌线下视觉九宫图、手机端小程序 UI、九宫格 KV 海报组、单张线下 KV 海报。

其中 **Logo、IP 吉祥物 + 两张规范页归为「品牌规范手册」组**：规范页在 Logo 与 IP 锚点确认后生成，用于固化锚点的正确用法。

## 什么时候用，什么时候不用

**用**：用户要做一整套品牌物料，或只做其中某一个模块（例如"只要 Logo""只要一张线下 KV 海报""只要一张 Logo 规范页"）。 **不用**：用户只要一张与品牌主体无关的配图或海报；用户只咨询设计建议、不需要提示词也不需要出图；用户已有完整 VI 手册只需套用既有资产。

> 只做单个模块时，本 Skill 同样适用，但**必须先输出那套视觉基因再出该模块**，保证后续物料能沿用同一套基因。

## 输入槽位

槽位必填缺失时怎么办品牌名称是追问，不得编造所属行业是追问，不得编造风格偏好否按行业自动匹配，不要追问品牌调性关键词否忽略主色偏好否用风格库默认主色，不要追问目标受众否忽略Slogan / 品牌口号否忽略；无 Slogan 时图上只渲染品牌名画幅比例否用本文件"画幅锚点"的默认值是否有线下实体门店否按行业推断：餐饮·咖啡·轻食·烘焙·零售·酒店·花店等视为有门店

只在必填项缺失时才向用户提问；选填项一律由系统自行补齐。

## 锚点一：视觉基因锁定（全案一致性铁律）

以下六项一旦锁定，全案所有物料必须共用，禁止任何物料跳脱：

1. 从品牌名称、行业、风格偏好中提取 3–5 个核心视觉词。
2. 主色 1 个、辅色 1–2 个、点缀色 1 个。
3. 字体风格：分别写出标题字体、正文字体、辅助字体的风格描述。
4. 材质基调。
5. 构图逻辑。
6. 光影调性。

**Logo 是全案核心锚点**：其形态、比例、色彩关系在所有物料中必须完全一致。 **IP 吉祥物是第二核心锚点**（用户要 IP 时）：独立于 Logo，Logo 保持纯图形标；IP 的造型、比例、配色、道具在全案中不得变化。

禁止跨物料出现风格跳脱、色彩冲突或字体混用。风格锁定后全案不得偏移；用户要换风格则整案重新生成，不做局部微调。

用户提供主色偏好时，在所选风格框架内调整主色，其余五项仍由风格库决定。

## 锚点二：风格适配库（10 种风格）

风格名 → 核心视觉词 / 主色 / 辅色 / 字体风格 / 材质基调 / 构图逻辑 / 光影调性 / 适用行业：

- **极简主义**：留白·几何·干净·秩序 / 黑·白·灰 / 低饱和单色 / 无衬线细体（Helvetica·Futura）/ 哑光纸·纯色平面 / 网格·大量留白·中心对称 / 均匀柔光·无阴影 / 科技·设计·美妆·家居
- **科技未来**：冷峻·数据·光效·精密 / 深空黑·电光蓝 / 青霓虹·钛银灰 / 几何无衬线·等宽体 / 磨砂金属·玻璃·全息投影 / 中心聚焦·纵深透视 / 高对比·边缘扫光·暗角 / 科技·互联网·电子·汽车
- **奢华高端**：精致·典雅·仪式感·质感 / 纯黑·深棕 / 香槟金·玫瑰金 / 衬线体（Didot·Bodoni）/ 拉丝金属·丝绒·大理石·烫金纸 / 黄金比例·对称·大量留白 / 侧光扫过·柔和高光·深暗阴影 / 奢侈品·珠宝·酒店·美妆
- **国潮东方**：东方·雅致·传统·意境 / 朱砂红·墨黑 / 鎏金·青绿·宣纸米 / 书法体·宋体·篆刻 / 宣纸·丝绸·漆器·瓷器 / 留白·卷轴式·对称 / 柔和暖光·水墨晕染 / 茶叶·白酒·服饰·文创
- **复古怀旧**：年代感·手工·温度·褪色 / 褪色黄褐·暗红 / 墨绿·米白 / 复古衬线体·手写体 / 旧纸·牛皮纸·做旧印刷 / 自由拼贴·复古海报式 / 胶片颗粒·轻微褪色·暖调 / 咖啡·手作·服装·唱片
- **自然有机**：清新·天然·生长·柔和 / 森林绿·大地棕 / 奶油白·浅木色 / 圆润无衬线·手写体 / 原木·棉麻·再生纸 / 有机曲线·松散布局 / 自然光·柔和阴影 / 食品·护肤·家居·农产品
- **波普潮流**：撞色·夸张·年轻·活力 / 亮黄·品红 / 电光蓝·荧光绿 / 粗体无衬线·涂鸦体 / 亮面塑料·贴纸·霓虹 / 拼贴·错位·爆炸式 / 高饱和·硬光·无阴影 / 潮牌·饮品·游戏·娱乐
- **暗黑先锋**：神秘·压迫·锋利·反叛 / 纯黑·暗红 / 银灰·紫黑 / 哥特体·锐利无衬线 / 皮革·哑光金属·烟雾 / 不对称·倾斜·中心压迫 / 强对比·局部高光·深黑阴影 / 潮牌·酒吧·音乐·游戏
- **手作温暖**：手工·温暖·亲切·不完美 / 暖米色·浅棕 / 珊瑚粉·暖橙 / 手写体·圆体 / 棉布·陶土·水彩纸 / 松散·手绘感·留白 / 暖光·柔和·轻微纹理 / 烘焙·手工艺·母婴·花店
- **艺术实验**：抽象·先锋·观念·张力 / 任意撞色 / 高饱和对比色 / 实验性排版·变形字体 / 混合材料·拼贴·装置感 / 打破常规·非对称·动态 / 戏剧化·强对比·多光源 / 画廊·设计工作室·音乐·时尚

**风格匹配优先级**（从上往下，命中即停）：

1. 用户明确指定风格 → 直接用该风格。
2. 用户给了调性关键词 → 从风格库挑最接近的一种。
3. 都没给 → 按行业匹配：科技·互联网→科技未来；奢侈品·珠宝→奢华高端；茶叶·白酒→国潮东方；咖啡·手作→复古怀旧；食品·护肤→自然有机；潮牌·饮品→波普潮流；酒吧·音乐→暗黑先锋；烘焙·母婴→手作温暖；画廊·设计→艺术实验；科技·设计·美妆·家居→极简主义。
4. 行业跨多个风格无法判定时，挑适用行业列表里命中最多的一种，并在报告中说明理由。

**风格融合与混搭**：用户给的调性词跨两种风格时（如"温暖邻里 + 日系自然"），可用主次比例融合，默认 7:3；用户明确要求混搭时按其给定比例。主风格决定色彩与字体，次风格只影响材质与构图元素，光影取主风格。融合/混搭结论要写进视觉基因报告。用户单独给出表现语言（如"可爱卡通·极简手绘·笔触肌理"）时，作为叠加在风格库之上的表现手法，不替换风格库字段。

## 锚点三：物料质感矩阵（同一品牌，不同物料用不同质感）

**质感必须按物料区分，视觉基因必须全案统一。** 禁止把全案做成同一种质感，也禁止某个物料跳脱基因。

物料默认质感关键写法IP 吉祥物、Logo平涂手绘 / 扁平矢量，干净纯色背景`flat cute cartoon illustration` / `clean vector style`，不叠实拍**VI Logo 视觉符号规范页、IP 视觉符号 12 宫格扁平精确的规范手册页排版**细线分隔、网格对齐、白/主色底、不叠实拍与手绘肌理VI 系统**实拍实物 mockup + 手绘元素点缀**`realistic mockup`、真实材质（纸、木、棉、陶瓷）电商详情页、三折页、官网、单张线下 KV 海报**实拍主体 + 手绘元素点缀 + 中文文案排版**`REAL commercial photograph` + `hand-drawn illustration accents`门店美陈设计效果图**C4D / Octane 三维渲染**`High-end C4D / Octane 3D render`、PBR 材质、全局光、环境光遮蔽品牌线下视觉九宫图**真实商业摄影（非插画）**`nine REAL PHOTOGRAPHS (not illustration, not drawing, not watercolor, not cartoon)`手机端小程序 UI高保真界面稿圆角卡片、真实 UI 文本、底部 Tab九宫格 KV 海报组每格独立 KV：实拍 + 手绘 + 中文标题`EACH of the nine tiles is a complete standalone KV poster`

质感切换时，色彩、字体风格、材质基调、光影调性、文案语气必须仍是同一套视觉基因。

## 锚点四：物料提示词模板（13 类）

把视觉基因报告的字段填进模板槽位 `[ ]`，质感按"物料质感矩阵"选择。每条提示词都要带**中文文案渲染要求**与**负向提示词**。

### 1. IP 吉祥物锚点（要 IP 时最先出，供全案引用）

```
Cute minimalist hand-drawn mascot character for [品牌名], a [行业] brand. [IP 形象描述：体型/五官/腮红/头顶元素/服装/道具], [性格关键词]. [主色] background, [辅色] soft accents, visible soft pencil and watercolor brush texture, organic wobbly outline, flat cute cartoon illustration, centered full-body character, high resolution, no text on this image, clean character only. --ar 1:1 --style raw
```

输出：IP 主形象 1 张（锚点）；需要动作组时用同一形象延展（招手、端碗/端盘、写黑板、递物）。

### 2. Logo 设计

```
Minimalist logo design for [品牌名], [行业] brand, [核心视觉词], using [主色] and [辅色], [字体风格] typography, [材质/图形元素], clean vector style, centered composition, [主色或白] background, professional brand identity, high resolution, text rendering: the brand name "[品牌名]" must appear as clean, correctly spelled, legible typography, no garbled or distorted letters, no extra text. --ar 1:1 --style raw
```

输出三个版本：标准版（白底彩标）、反白版（主色底白标）、单色版（单色线稿标）。Logo 保持纯图形标，不与 IP 融合。

### 3. VI Logo 视觉符号规范页（品牌规范手册 · 3:4）

```
Brand guidelines page (brand manual page) for [品牌名], [行业] brand, a single 3:4 manual page with a clean editorial grid layout on [主色] background, documenting the identical logo shown in {{logo节点}}. Sections on this one page, separated by thin hairline rules: 1) the main logo lockup, large and centered; 2) clear space / safety area diagram with "x" unit measurement marks and a dashed boundary box; 3) minimum size specification with small logo samples and size callouts; 4) three color versions side by side — standard full color, reverse (knockout) version on [主色], single-color [点缀色] line version; 5) color palette swatches with hex codes for [主色] / [辅色] / [点缀色]; 6) an incorrect-usage row of four to six forbidden examples each crossed out with a red line (stretched, rotated, recolored, drop-shadowed, low-contrast, cluttered placement); 7) correct background applications shown on light and dark surfaces. Consistent [字体风格], precise alignment, generous whitespace, print-ready brand manual aesthetic, flat and exact — no photography, no hand-drawn texture. Text rendering: all section titles, labels and hex codes must be crisp, correctly spelled, legible Chinese (brand name "[品牌名]" accurate) alongside standard design terms, no garbled characters, no gibberish English, no lorem ipsum, no extra text. --ar 3:4 --style raw
```

输出：1 张。**执行顺序**：必须在 Logo 与 IP 锚点出图并确认之后生成，正文内容必须引用 `{{logo节点}}` 的实际形态。

### 4. IP 视觉符号 12 宫格（品牌规范手册 · 1:1，4×3）

```
IP mascot brand guidelines board for [品牌名], [行业] brand: a single square sheet divided into a 4x3 grid of twelve equal panels documenting the identical mascot shown in {{IP节点}}. Panel contents in order: 1 front view turnaround; 2 side view turnaround; 3 back view turnaround; 4 waving greeting pose; 5 holding a coffee cup with a wave; 6 holding a salad bowl; 7 writing on a chalkboard; 8 delivery pose carrying a takeaway bag; 9 happy expression close-up; 10 relaxed expression close-up; 11 standard color swatches with hex codes [主色] / [辅色] / [点缀色]; 12 forbidden usage examples each crossed out with a red line (distorted proportions, recolored, extra accessories, flipped, outline-only, extra limbs). Every panel carries a small Chinese caption label. Flat cute cartoon illustration, consistent [主色] background with [辅色] panels and thin [点缀色] rules, the identical mascot proportions and palette in every panel, neat equal-sized grid, professional character design sheet. Text rendering: all Chinese captions and labels must be crisp, correctly spelled, legible characters, no garbled characters, no English gibberish, no lorem ipsum, no extra text. --ar 1:1 --style raw
```

输出：1 张。**执行顺序**：同样在 IP 与 Logo 锚点确认之后生成，十二格内容按固定顺序，不得增删。

### 5. VI 系统（含实物物料，物料要够密）

```
Comprehensive brand identity mockup collection for [品牌名], [行业] brand, [核心视觉词], laid out as a rich top-down flat-lay on a warm surface, mixing REAL mockup photography with cute hand-drawn accents. Include BOTH stationery AND [行业相关实物] AND staff uniform: business card, envelope, letterhead, ID badge, takeaway packaging box; PLUS [行业实物清单：如陶瓷咖啡杯与外带纸杯+杯套、拿铁、餐盘碗筷勺、菜品/招牌产品、餐巾、玻璃杯]; AND staff items — [制服/围裙/帽子/托特包]. Every item in [主色] / [辅色] / [点缀色], [字体风格], [材质描述] textures, soft loose layout with small hand-drawn doodles. All items share the same visual identity and the identical logo shown in {{logo节点}}, and feature the identical mascot from {{IP节点}} as stickers, badges and a small plush. Soft warm diffused lighting, realistic mockup, abundant and complete display, text rendering: brand name "[品牌名]" and slogan "[Slogan]" accurately spelled and legible Chinese, no lorem ipsum, no garbled strokes, no extra text. --ar 4:3 --style raw
```

**物料密度是硬要求**：餐饮/零售类品牌至少要出现菜品、餐具、咖啡杯（或对应行业实物）、制服四类实物，不得只剩文具。缺物料时优先补物料清单，而不是改风格。

### 6. 电商详情页

```
E-commerce product detail page design for [品牌名], [产品名], [行业] brand. Main banner with [主色] background and a REAL commercial product photograph (DSLR, natural light, shallow depth of field) decorated with cute hand-drawn accents, [核心视觉词] mood. Detail sections showing product features, ingredients/materials, usage scenarios. Clean loose grid layout, [字体风格], [辅色] accents, high-end commercial advertising aesthetic, text rendering: brand name "[品牌名]", slogan "[Slogan]" and Chinese section headlines accurately spelled and legible, no garbled letters. --ar 3:4 --style raw
```

输出：主图 1 张 + 详情页模块（卖点、成分/材质、使用场景）各 1 张。

### 7. 三折页

```
Tri-fold brochure design for [品牌名], [行业] brand, [核心视觉词]. Front cover with the identical logo and a REAL hero photograph with hand-drawn accents, inside spread with product/service introduction, back cover with contact info styled like a handwritten note. [主色] and [辅色] color scheme, [字体风格], [材质描述]. Flat lay or mockup presentation, clean and professional, text rendering: brand name "[品牌名]", slogan and Chinese section titles accurately spelled and legible, no garbled letters. --ar 16:9 --style raw
```

输出：封面、内页、封底各 1 张。

### 8. 官网

```
Website homepage design for [品牌名], [行业] brand, [核心视觉词]. Hero section with [主色] background, the identical logo, headline in [字体风格], REAL product photographs with hand-drawn accents, product/service showcase, navigation bar, footer. Clean modern friendly UI, responsive layout, [辅色] accents, soft natural light, generous whitespace, text rendering: brand name "[品牌名]", slogan and Chinese navigation labels accurately spelled and legible, no garbled letters. --ar 16:9 --style raw
```

输出：首页 1 张 + 内页（产品页或关于我们）1 张。

### 9. 门店美陈设计效果图（C4D / Octane 三维渲染）

```
High-end C4D / Octane 3D render of the interior of [品牌名], a [行业] shop, [核心视觉词] mood, rendered as a polished three-dimensional scene (NOT illustration, NOT hand-drawn, NOT watercolor, NOT flat cartoon). Clean stylized 3D storefront cutaway: [陈列要素：吧台、展示柜、主推产品、设备、黑板菜单、灯具、橱窗、绿植、座位区、开放操作区]. Smooth soft global-illumination lighting, gentle ambient occlusion, subtle depth of field, refined PBR materials ([材质清单：哑光木、磨砂玻璃、陶瓷、亚麻、涂料]), soft warm shadows, cozy premium diorama feel. Window and hanging sign show a clean 3D extruded logo matching {{logo节点}}; a cute 3D figure matching {{IP节点}} stands by the door and appears as a softly lit wall decal. Text rendering: signage shows the Chinese brand name "[品牌名]" and slogan "[Slogan]" as crisp, correctly spelled, legible 3D letters, no garbled characters, no extra text. --ar 16:9 --style raw
```

### 10. 品牌线下视觉九宫图（真实商业摄影）

```
Photorealistic brand offline visual 9-grid contact sheet for [品牌名], a [行业] brand. A clean 3x3 grid of nine REAL PHOTOGRAPHS (not illustration, not drawing, not watercolor, not cartoon), each square a real-life brand touchstone shot with a DSLR camera, natural window light and shallow depth of field: 1 [招牌/门头], 2 [橱窗贴], 3 [外带杯], 4 [产品包装], 5 [制服/围裙帽子], 6 [黑板菜单/宣传板], 7 [周边/贴纸托特包], 8 [堂食餐具与产品], 9 [座位角/空间一角]. Consistent palette [主色]/[辅色]/[点缀色]; real [材质清单] textures; soft warm daylight, authentic lifestyle commercial photography, even gutters. The logo and mascot appear as REAL printed/engraved/frosted graphics on the actual objects, exactly matching {{logo节点}} and {{IP节点}}. Text rendering: the Chinese brand name "[品牌名]" and slogan "[Slogan]" appear as real, sharp, correctly spelled printed signage, no garbled characters, no English gibberish, no extra text. --ar 1:1 --style raw
```

负向必须显式排除插画：`illustration, drawing, painting, watercolor, cartoon, anime, sketched style, CGI`.

### 11. 手机端小程序 UI（9:16）

```
Mobile mini-program app UI design for [品牌名], a [行业] brand, shown as a clean smartphone screen mockup (mobile interface). Home screen with: top location bar and search box; a large hero banner with the logo and a hand-drawn product illustration; the mascot matching {{IP节点}} waving with a greeting bubble; a horizontal category row ([品类1, 品类2, 品类3, 每日新品]); product cards with photos, names, prices and an add button; a bottom tab bar ([首页, 点单, 订单, 我的]). Consistent palette: [主色] background, [辅色] cards, [点缀色] buttons and accents; rounded cards with soft shadows, generous whitespace, [字体风格]; soft warm light, modern friendly high-fidelity UI. The logo matches {{logo节点}}. Text rendering: all Chinese labels, brand name "[品牌名]" and slogan "[Slogan]" must be crisp, correctly spelled, legible real UI text, no garbled characters, no English gibberish, no lorem ipsum, no extra text. --ar 9:16 --style raw
```

### 12. 九宫格 KV 海报组（九张独立海报排在一张里）

```
A single 3x3 poster board containing NINE separate advertising key-visual posters for [品牌名], a [行业] brand, arranged in an even 3x3 grid with thin [主色] gutters. EACH of the nine tiles is a complete standalone KV poster: a REAL commercial product photograph (DSLR, natural window light, shallow depth of field) of a different product, PLUS a clear Chinese headline title and a short Chinese sub-copy placed on a text band inside that tile, with small cute hand-drawn accents and the mascot matching {{IP节点}} as a small sticker. The nine posters and their exact Chinese titles are: 1 [产品与标题]; 2 […]; 3 […]; 4 […]; 5 […]; 6 […]; 7 […]; 8 […]; 9 […]. Every tile keeps the SAME layout logic (photo + Chinese headline + tiny sub-line + mascot accent) and the SAME palette [主色]/[辅色]/[点缀色], soft warm daylight, premium poster design, equal-sized tiles. The logo matching {{logo节点}} appears small and identical in a corner of every poster. Text rendering: ALL titles and copy must be crisp, correctly spelled, legible Chinese characters, no English-only labels, no garbled strokes, no lorem ipsum, no extra text. --ar 1:1 --style raw
```

**三条硬要求**：九格等大；九格各自独立成完整 KV；每格必须有中文标题与短副文案。生成时把九格的"产品 + 中文标题"逐条写进提示词，不要只说"九张海报"。

### 13. 单张线下 KV 海报（实拍 + 手绘点缀 + 层级化中文文案）

```
A single vertical offline advertising key-visual poster for [品牌名], a [行业] brand, print poster with clean professional editorial layout. Hero image is a REAL commercial product photograph (DSLR, natural window light, shallow depth of field) of [主推产品], arranged on [场景/材质]. Decorated with cute hand-drawn illustration accents: [手绘元素：水彩叶片、涂鸦、星光、手绘边框箭头], and the mascot matching {{IP节点}} peeking from a lower corner as a hand-drawn sticker. Strong Chinese typographic hierarchy: a large handwritten headline at top "[主标题]", a secondary title "[副标题]", a short sub-line "[副文案]", and a small footer with brand name, address and opening hours. The logo matching {{logo节点}} at the top. Palette [主色]/[辅色]/[点缀色], generous whitespace, balanced grid, soft warm daylight, premium poster design. Text rendering: all Chinese copy must be crisp, correctly spelled, legible characters, no garbled strokes, no gibberish English, no lorem ipsum, no extra text. --ar 3:4 --style raw
```

文案层级固定三层：主标题（Slogan 或价值主张）→ 副标题（产品名）→ 副线（卖点短句）+ 底部信息。

### 负向提示词（通用基底，每条都要带）

```
style chaos, inconsistent color palette, mixed typefaces, conflicting styles, low resolution, blurry, cheap look, distorted logo, warped logo, misspelled text, garbled text, gibberish letters, lorem ipsum, extra text, watermark, cluttered composition, off-brand color
```

**按物料追加**：

- 写实/摄影类物料追加：`illustration, drawing, painting, watercolor, cartoon, anime, sketched style, CGI, plastic 3d food`
- C4D 渲染类物料追加：`2d illustration, hand-drawn outlines, watercolor, sketch, anime cel shading, flat cartoon, photorealistic photo, noisy grain`
- 手绘/插画类物料追加：`photorealistic render, glossy plastic, cold blue tone`
- 规范手册类物料（Logo 规范页、IP 12 宫格）追加：`photography, hand-drawn texture, multi-page brochure spread, uncrossed forbidden examples, blank placeholder boxes, missing captions, inconsistent character proportions, unequal panel sizes`
- 文案要求高的物料追加：`English-only headlines, blank text bands, empty blank items`
- 九宫格类物料追加：`oversized center tile, inconsistent tile layouts`

### 画幅锚点

IP 1:1；Logo 1:1；**VI Logo 视觉符号规范页 3:4**；**IP 视觉符号 12 宫格 1:1**；VI 4:3；电商详情页 3:4；三折页 16:9；官网 16:9；门店美陈 16:9；线下视觉九宫图 1:1；小程序 UI 9:16；九宫格 KV 1:1；单张线下 KV 海报 3:4。用户自定义画幅时以用户为准，其余物料仍按默认。

## 出图默认范围

- **品牌规范手册组（Logo、IP 吉祥物、VI Logo 规范页、IP 12 宫格）**：默认全出。Logo 与 IP 先出并确认，随后生成两张规范页。
- **基础物料（VI 系统、电商详情页、三折页、官网）**：默认全出。
- **线下类模块（门店美陈效果图、品牌线下视觉九宫图、单张线下 KV 海报）与小程序 UI、九宫格 KV 海报组**：
  - 品牌**有线下实体门店**（餐饮·咖啡·轻食·烘焙·零售·酒店·花店等）→ 默认一起出；
  - **无实体门店**（纯线上/互联网/服务类）→ 不默认出，用户点名或语义强烈建议后再出，先确认。
- 用户指定某些模块时，只出点名的模块 + 必出的视觉基因报告。

## 执行流程

 1. **收齐输入**：按"输入槽位"判定必填是否齐备，缺则提问；选填自行补齐；判断是否有线下实体门店。
 2. **匹配风格**：按"风格匹配优先级"锁定风格（或用户指定的融合/混搭比例）。
 3. **输出《品牌视觉基因报告》**：风格名称、核心视觉词、主色/辅色/点缀色、字体风格（标题/正文/辅助）、材质基调、构图逻辑、光影调性，共七项，一项不少。
 4. **输出物料质感矩阵与出图清单**：逐物料标明用哪种质感、出几张、画幅多少；并标明规范手册组的先后顺序。
 5. **生成提示词集**：按 13 类模板逐个填充，每条都带中文文案渲染要求、负向提示词、画幅参数；用户只要单模块时，只出该模块的提示词，但视觉基因报告必须照出。
 6. **展示整体方案，等待用户确认**。硬性卡点：方案未确认前，**不得创建也不得出图**。用户要调整风格或物料时，回到第 2 步整案重算。
 7. **确认后先建锚点节点**：IP 吉祥物与 Logo（三版）先创建；其余物料的提示词以 `{{节点key}}` 引用这两个锚点。
 8. **锚点出图并确认后，生成两张规范页**（VI Logo 规范页、IP 12 宫格）——它们固化锚点的正确用法，正文内容必须引用锚点节点的实际形态。
 9. **批量创建其余物料节点**，随后逐一走审批后再运行（见"出图执行规范"）。
10. **自检**：对照清单逐条核对后再交付。

## 出图执行规范

- **先锚点、再规范页、后物料**：IP 与 Logo 先出并确认；两张规范页紧随其后；其余物料提示词必须用 `{{IP节点}}`、`{{logo节点}}` 引用锚点，不得只靠文字描述形象。
- **创建与运行分离**：节点先创建、不运行；运行前必须发一次运行审批卡，卡片列出本次将运行的全部节点，用户批准后才运行。一次审批只覆盖卡片上节点的一次运行，重跑要重新发卡。
- **质感按矩阵执行**：不同物料用不同质感，但色彩、字体、材质基调、光影必须同一套；禁止全案一种质感，也禁止单物料跳脱。
- **文案铁律**：图上文案必须中文、拼写正确、清晰可读，禁止乱码、英文占位标签、lorem ipsum、空白文字带；标题与标签层级不得缺失。
- **不覆盖旧节点**：用户要求换质感或改方向时，新建 v2 节点并保留原节点对比，不要直接改写原节点。
- 出图后逐张检查：实物物料是否出现空白物料或占位符；规范页是否要素齐全（安全空间、最小尺寸、三版色、色值、错误用法）；12 宫格是否 12 格等大、每格有中文标签；九宫格是否九格等大、各自独立、每格都有中文标题；文字是否清晰无错字。不达标就重出，不带病交付。

## 自检清单

- \[ \] 风格是按优先级正确匹配的吗（用户指定 &gt; 调性词 &gt; 行业 &gt; 命中最多）？
- \[ \] 视觉基因报告七项是否齐全、无空缺？
- \[ \] 是否给出了物料质感矩阵，且各物料质感互不混淆？
- \[ \] 所有物料的提示词是否引用同一套色彩、字体、材质、光影？
- \[ \] Logo（与 IP）是否作为核心锚点被显式引用（`{{节点key}}`）？
- \[ \] 两张品牌规范页是否排在 Logo、IP 锚点确认之后生成？
- \[ \] Logo 规范页是否含安全空间、最小尺寸、三版色、色板 hex、错误用法、正确背景应用？
- \[ \] IP 12 宫格是否按固定 12 格内容、每格带中文标签、含色值与禁止用法？
- \[ \] VI 的实物物料是否够密（含行业实物与制服，不是只有文具）？
- \[ \] 每条提示词是否都带中文文案渲染要求、负向提示词（含按质感追加项）、画幅参数？
- \[ \] 出图前是否已取得用户对整体方案的确认？运行是否走了审批卡？
- \[ \] 单模块场景是否仍然先输出了视觉基因？
- \[ \] 九宫格类物料是否九格等大、各自独立、每格带中文标题？
- \[ \] 提示词是否可直接复制到 Midjourney / SD 使用？

## 迭代经验（来自实际执行，遇到同类反馈时直接套用）

用户反馈正确处理"展示的东西很少，没有食品菜品碗筷和咖啡杯、制服"不改风格、只补物料：把实物清单与制服写进 VI 提示词，并要求 `abundant and complete display`、负向加 `empty blank items`"要实拍摄影图"正向写 `nine REAL PHOTOGRAPHS (not illustration, not drawing, not watercolor, not cartoon)`，负向显式排除插画/水彩/卡通"要 C4D 渲染质感"正向写 `High-end C4D / Octane 3D render ... NOT illustration`，并补 PBR 材质、全局光、环境光遮蔽、浅景深"要九张独立 KV 海报、每张带文案标题"逐格列出"产品 + 中文标题"，写明 `EACH of the nine tiles is a complete standalone KV poster`、`equal-sized tiles`；负向加 `oversized center tile, blank text bands, English-only headlines`"要 Logo 规范页 / IP 12 宫格"归入「品牌规范手册」组，排在 Logo 与 IP 锚点确认之后生成；固定要素清单（安全空间、最小尺寸、三版色、色板 hex、错误用法 / 三视图、动作、表情、色值、禁止用法），每格带中文标签，负向加 `blank placeholder boxes, missing captions, unequal panel sizes`文案乱码 / 出现英文正向写 `all copy must be correctly spelled, legible Chinese`，负向加 `garbled text, gibberish letters, lorem ipsum, English-only labels`加了新方向新建 v2 节点保留原节点对比，不覆盖既有产出

- 必填信息缺失 → 追问行业或风格，不做猜测。
- 用户对某模块有特殊要求（如详情页要突出某个卖点、VI 要加某些实物）→ 只改该模块内容，视觉基因不动。
- 用户要换风格 → 整案重新生成，不做局部修改。
- 用户要融合/混搭风格 → 请其给主次比例，默认 7:3。
- 用户要加 IP 或线下类模块 → 先确认 IP 方向（形象、是否与 Logo 融合、是否要动作组），再纳入方案。
- 用户要加规范类物料 → 归入品牌规范手册组，排在 Logo、IP 锚点确认之后生成。
- 其余情况直接按流程执行，出图前给方案、运行前给审批卡。