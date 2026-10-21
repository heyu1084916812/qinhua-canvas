---

## name: craft-cinematic-tension-closeups description: Create, prompt, art-direct, revise, or quality-check original ultra-detailed cinematic character close-ups with strong visual tension, face-first composition, wind-driven hair, foreground occlusion, shallow depth of field, directional light, suspended particles, and controlled action cues. Use for vertical character key art, wuxia or fantasy portraits, high-impact thumbnails, image-generation prompts, image-to-video opening frames, or any request for 人物张力大特写、电影光感、战损氛围、极近景、超清人像、武器前景压迫感. Preserve original identities and designs rather than copying a recognizable person, artist, film, game, or supplied reference frame.

# 人物张力大特写超清

把普通“漂亮人像”转化为具有叙事压力、空间层次和电影光感的人物大特写。先读取 `references/style-profile.md`；需要直接生成提示词或变体时，再读取 `references/prompt-patterns.md`。

## 工作流

 1. 提取任务中的人物、时代、动作、道具、情绪、画幅和用途。缺失项不阻塞时，采用克制的原创设定。
 2. 写一条人物身份锁：年龄段、脸型、眉眼、发型、服装轮廓、主色、唯一识别物。不得借用可识别真人或现成角色。
 3. 选择一个“张力动词”：迎击、格挡、回望、压低重心、蓄势、穿越风尘。每张图只保留一个主动作。
 4. 设计三层构图：
    - 前景：失焦武器、衣料、碎屑或结构边缘，遮挡画面 15%–35%；
    - 中景：眼睛与面部为唯一清晰核心，至少一只眼完整可读；
    - 后景：只保留环境色、天空或暗部轮廓，不抢主体。
 5. 先锁眼神和脸部平面，再加入风发、粒子与运动模糊。发丝可越过面部，但不得同时遮死双眼、鼻梁和唇线。
 6. 建立冷暖分工：冷色环境光负责轮廓与空气，暖金或铜红反光负责皮肤、金属和飞尘；避免全画面同色滤镜。
 7. 指定真实摄影逻辑：竖构图优先，85–135mm 人像压缩感或近距离 50–85mm 动态感，f/1.4–2.8 浅景深，焦点落在近眼虹膜与睫毛。
 8. 增加超清约束：虹膜、睫毛、皮肤微纹理和关键服装纤维清楚；允许非关键前景与发梢产生方向性拖影。
 9. 按 `references/prompt-patterns.md` 的固定顺序输出生成提示词、负面约束和可选视频运动段。
10. 使用 `references/qa-rubric.md` 逐项检查；任一硬失败项出现时重写，而不是继续堆叠修饰词。

## 不可妥协的视觉规则

- 张力来自眼神、遮挡、对角线和即将发生的动作，不来自夸张表情或无意义爆炸。
- 面部占画面约 35%–65%；眼睛位于上半部视觉锚点，人物不居中时仍需保持视线方向可读。
- 前景必须产生压迫与纵深，但不能像随机贴纸，也不能把五官切碎。
- 仅保留 1 个主武器或动作道具；武器方向应形成对角线并指向画外或视线目标。
- 风必须有统一方向。发丝、衣缘、尘屑和运动拖影遵循同一风向。
- 清晰与模糊要分层：眼睛最清晰，脸部次之，前后景自然虚化；禁止全图锐化和蜡质磨皮。
- 皮肤保留毛孔、细小汗光和自然色差；战损只用少量灰尘、擦痕或干涸血迹，禁止猎奇伤口。
- 光斑与粒子必须受光、受景深控制；禁止均匀撒满画面的廉价金粉效果。
- 参考图只用于提炼抽象语法。不得复制具体脸、服装、武器、姿势、画面布局或水印。

## 输出格式

默认给出：

1. 一句创意意图；
2. 主提示词；
3. 负面约束；
4. 三项可调参数：张力等级、遮挡比例、冷暖比例；
5. 简短 QA 结论。

用户要求批量变体时，保持身份锁不变，只轮换一个维度：动作、机位、光向或前景材质。不要在同一变体里同时更换多个核心变量。

## 工具与资源

- 需要快速组装一致格式的提示词时，运行： `python scripts/build_closeup_prompt.py --config <config.json> --out <prompt-pack.json>`
- 配置字段和可复制模板见 `references/prompt-patterns.md`。
- 视觉判定标准见 `references/style-profile.md`。
- 成片复核见 `references/qa-rubric.md`。

## 立即拒绝或重做

- 双眼均被发丝、武器或阴影遮死；
- 五官变形、身份漂移、塑料皮肤、过度磨皮或错误手指；
- 只有“美女 + 光斑”，没有动作方向、空间层次或叙事压力；
- 主体、武器、粒子和背景全部同等清晰；
- 粒子不受光或景深影响，像叠加滤镜；
- 随机文字、水印、UI、品牌标识；
- 可追溯到具体真人、商业角色或单张参考图的复刻。