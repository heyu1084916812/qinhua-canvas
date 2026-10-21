---

## name: yanyun-shiliuzhou-film description: End-to-end production workflow for turning a story idea into a shot-by-shot AI film — script, character sheets, scenes, props, storyboard, and per-shot video prompts — shipping in a locked AAA 3D wuxia/xianxia game-render look (the "燕云十六州 / Where Winds Meet 燕云十六声" official in-game style as its default skin). Use this skill whenever the user wants to make a Guofeng/wuxia/xianxia vertical drama, animated comic (漫剧), game cinematic, or story-driven AI short and needs a repeatable pipeline rather than one-off images — even if they do not name the style by name. Also trigger when they name 燕云十六州 / 燕云十六声 / Where Winds Meet, or ask for a script, characters, scenes, props, storyboard, or shot video prompts in an Oriental cinematic 3D game-render style. It keeps one locked visual DNA and orchestrates screenwriting, character sheets, scene design, prop prompts, storyboards, and video prompts so every asset stays consistent from idea to finished cut. description_zh: 国风仙侠成片工作流（燕云十六州风格为默认皮肤，从剧本到逐镜视频提示词） description_en: Guofeng wuxia/xianxia AI film pipeline, Where Winds Meet look by default agent_created: true

# 国风仙侠成片工作流（燕云十六州风格）

这是一套**可复用的国风仙侠短剧成片工作流**：把一个故事想法，走完「剧本 → 角色 → 场景 → 道具 → 分镜 → 逐镜视频提示词」的完整链条，产出可直接进生产的整套前期资产。它默认套用「燕云十六州 / 燕云十六声 Where Winds Meet」官方 AAA 3D 武侠仙侠游戏渲染质感作为视觉皮肤——**风格是这条流水线的默认皮肤，流水线本身才是主体**。风格 DNA 与验证版触发公式已内联固化，脱离总控风格库也能独立运行。

> 定位说明：本 Skill 的核心能力是「从想法到成片的一整套工作流」，能吃下"国风仙侠短剧/漫剧/游戏CG"这一整类需求，而非只服务某一条视频。燕云风格是它开箱即用的默认视觉基因；换题材、换角色、换场景时流水线不变，只在风格锚点内替换 `{subject}`。
>
> 命名说明：用户卡面标题为「燕云十六州」，据此保留为本 Skill 显示风格名；其视觉配方沿用同一游戏《燕云十六声 / Where Winds Meet》官方角色 CG 实测公式（`style_040`）。二者指向同一视觉基因。

## 何时触发

只要用户想做一部国风/武侠/仙侠向的 AI 短剧、漫剧、游戏 CG 或剧情短片，并且需要的是「一套能反复用的成片流程」而不是单张图，就用本 Skill——**即使用户没点名燕云风格**：

- 用户想做国风/武侠/仙侠短剧、漫剧、动画短片、游戏过场，需要从剧本一路做到分镜和视频提示词。
- 用户点名「燕云十六州」「燕云十六声」「Where Winds Meet」并要写剧本、做角色、场景、道具、分镜或逐镜视频提示词。
- 用户想在东方电影化 3D 游戏渲染质感下，产出全片风格统一的整套前期资产。
- 用户已有一个故事一句话或分场想法，想把它工程化成可交接生产的成片工作流。

## 必读资源

- 风格配方：`references/style-recipe.md`
- 制作流程：`references/production-pipeline.md`
- 项目骨架：`templates/project-package.md`

## 锁定的风格 DNA（内联真源，最高优先级）

- **风格名**：燕云十六州（原样保留，不改写）
- **来源模型**：未知（不以画面外观断言来源）
- **首选生产模型**：GPT-Image 2（实测出图）；**备选**：Midjourney V8.1（游戏3D质感强，需重写配方并重验）；**不推荐**：纯 chibi/Q版模型（与写实3D武侠基因冲突）
- **默认画幅 / 时长档 / 平台**：9:16 竖屏 / 30–60 秒 / 短视频与游戏向社区
- **核心 DNA**：AAA 3D 游戏渲染、东方国风仙侠、窄脸尖下巴大眼 CG 雕塑脸、小头完美身材比例、戏剧性明暗体积光、刺绣/丝绸/金属/皮草超精细材质、物理模拟发丝、空气粒子、冷暖对比、8k、无 logo；面无表情、禁止显示面部肌肉结构
- **构图版式**：近景腰上景别，角色约占画面 70%；夜色古代宫廷回廊背景，冷调轮廓光 + 暖金高光；左上留 UI 徽标负空间，底部留标题条负空间
- **禁止项**：微笑、露齿、夸张表情、写实毛孔、塑料皮肤、大头、短身材比例、现代服装、过饱和色、嵌入文字/标题/logo/水印/边框/界面元素、主体外的其他角色
- **允许直写游戏名**：是（写 Where Winds Meet / 燕云十六声 可提高风格命中率）
- **稳定性**：当前 3 / single-image-provisional（已用蓝裙侠女抚琴单图跑通验证公式）。这不是缺陷，是诚实的成熟度标注——单图能证明公式成立，但要证明"换 `{subject}` 也稳、能吃一整类需求"，需按下方《稳定性升级路径》补齐多角色/多场景验证图后，才能上调到 4–5 并对外宣称稳定。

### 稳定性升级路径（补齐这 4 张即可从 3 升到 4–5）

风格稳定性的本质是：换角色、换场景、换资产类型时，同一套 DNA 是否仍然成立。用下面 4 张最小验证图覆盖三类资产，就能把"单图侥幸"升级为"可复现的风格"。每张只替换 `{subject}`（场景/道具用净化版，不塞脸型词）：

#验证图换的变量证明的验收项1男性主角立绘（已有蓝裙侠女为女性锚点）角色性别/体型脸型比例 DNA 跨性别复现2反派/年长角色立绘（不同气质）角色气质/年龄DNA 不因气质崩坏3无人物古代宫廷回廊场景（净化版）资产类型：场景场景与角色共享同一光影/材质基因4单件兵器或乐器道具特写（净化版）资产类型：道具道具吃同一 DNA、可交接生产

4 张若都保持风格一致：把本行稳定性上调为 `4 / multi-asset-verified`（角色+场景+道具三题通过）；若同时补一段用本流程跑出的成片，可标 `5 / production-verified`。**在补齐前，对外（发布/showcase）只可称"单图验证的候选风格"，不得宣称稳定。**

### 验证版触发公式（只可替换 `{subject}`，不可改写）

```text
Please generate a vertical 9:16 character-cover image designed for a premium game-style card.

The image style is Where Winds Meet (燕云十六声) official in-game character style, AAA 3D game render, narrow face shape, pointed chin, smooth face shape, big eyes, CG sculpt face, 3D game model face, small head perfect body proportion, slender neck delicate bone structure, non-photorealistic idealized anatomy, Oriental Guofeng Xianxia aesthetics, dramatic chiaroscuro volumetric lighting, hyper-detailed embroidery silk metal fur textures, physics-simulated hair, atmospheric particles, warm-cold contrast, 8k, no logo. Displaying facial muscle structures is prohibited. Expressionless.

The character description is: {subject}. Use a close cinematic waist-up composition with the character occupying approximately seventy percent of the frame. The background is a dark atmospheric ancient Chinese palace corridor at night with cool rim lighting and warm golden highlights. Keep the face and upper costume clearly readable at thumbnail size. Preserve clean negative space in the upper-left corner for a UI status badge and along the bottom edge for a separately added style title. No embedded text, title, logo, watermark, frame, border or interface elements. No smiling, exposed teeth, exaggerated expression, photorealistic pores, plastic skin, oversized head, short body proportions, modern clothing or oversaturated colors.

No characters other than the single described subject should appear.
```

## 不可破坏的规则

1. 全片只锁这一个项目 DNA；角色、场景、道具、分镜逐字复用核心 DNA。
2. 验证公式只替换 `{subject}`，需要优化时另存净化版，不覆盖验证版。
3. 生图走 API，首选 GPT-Image 2；不接 Qwen、不走 ComfyUI。跨模型迁移需重写配方并重新验证。
4. 用户端不暴露固定词；系统内部用 `{subject}` 拼接。
5. 实际生图前告知单张约 5–10 积分并确认数量；生视频前告知 5 秒约 50–100 积分并确认。
6. 场景/道具净化版不塞角色脸型词；但角色资产的验证版完整公式必须保留。

## 工作流程（九阶段）

1. **风格锁定卡**：直接引用上面的 DNA，向用户确认故事方向。
2. **交互 Brief**：每轮最多问四个高价值问题（故事/爽点、时长画幅平台、受众情绪节奏、做到哪一层）。
3. **剧本**：加载并调用 `ai-film-screenwriting`，传入 Brief + 燕云 DNA + 时长 + 9:16，产出分场剧本 + 角色/场景/道具表。
4. **角色**：加载并调用 `ai-film-character-sheet`，传入 DNA + 验证公式，产出白底全身立绘提示词；先定主角脸型比例再批量配角。
5. **场景**：加载并调用 `ai-film-scene-design`，产出无人物古代宫廷/山水场景提示词 + 中文画面说明。
6. **道具**：按 `references/production-pipeline.md` 的九段式道具公式产出兵器、乐器、信物等设定提示词。
7. **分镜**：加载并调用 `ai-film-storyboard`，把剧本拆成可迭代镜头 + 静帧/动态交接单。
8. **视频提示词**：单镜精修加载 `seedance2-skills`；整场结构化转换加载 `mx-shell-prompt`。
9. **一致性台账**：维护 Style / Character / Scene / Prop / Shot Bible，改动不可变字段必须回写并检查后续镜头。

每次调用下游 Skill 前先加载它，并把燕云 DNA 与验证公式作为最高真源传入，禁止下游重新选风格或覆盖 DNA。下游自带旧版 `style-library.md` 只作缺省参考。

## 发布与 showcase 指引（决定评级和长期分成）

本 Skill 按 LibTV「成片 Skill」规格发布（不是单点皮肤），定位、素材、文案都要往"一整套工作流"上靠：

- **标题/简介**：写成"国风仙侠短剧成片工作流（燕云风格默认皮肤）"这类，突出"从剧本到逐镜视频一条龙"，风格只作默认皮肤，别把卖点写小成"只出这一种风格的图"。
- **showcase**：优先放**一段用本流程跑出的 15–30 秒成片**，配文"本条 Skill 从剧本→角色→场景→分镜全程生成"；成片旁再附 3–4 张《稳定性升级路径》里的多资产验证图，直接对应"结果可复现、吃一整类需求"两条硬门槛。静帧单图只作补充，不作主证据。
- **场景泛化**：描述适用面时写"国风/武侠/仙侠短剧、漫剧、游戏CG 通用成片流程"，适用面越宽，评级、使用量与长期分成越高。

## 验收（对齐 LibTV 6 条成片 Skill 硬门槛）

交付/发布前逐项自检，括号内为对应的 LibTV 门槛：

- **稳定运行无报错**：全流程走 API，不接 Qwen、不走 ComfyUI，无环境依赖。（门槛①）
- **结果可复现**：验证公式只替换 `{subject}`、DNA 逐字复用；已按《稳定性升级路径》补齐或明确标注当前成熟度，未用单图冒充稳定。（门槛②）
- **流程职责清晰**：九阶段各司其职，下游 Skill 调用与传参写明。（门槛③）
- **适用场景明确、吃一整类需求**：定位为"国风仙侠成片工作流"，能吃这一整类短剧/漫剧/游戏CG，而非只服务某一条视频。（门槛④）
- **他人可直接上手复用**：触发条件、必读资源、不可破坏规则齐备，换题材换角色即可复用。（门槛⑤）
- **内化真实叙事/镜头逻辑**：剧本→角色→场景→道具→分镜→视频链条完整，非单点堆砌。（门槛⑥）
- 附加自检：风格名「燕云十六州」与验证公式未被改写；已给出首选/备选模型与理由、来源模型标注未知；全片共享同一 DNA、各资产可直接交接生产；生成前已完成积分告知与数量确认。