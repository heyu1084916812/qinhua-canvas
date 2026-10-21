---

## name: libtv-slow-life-director description: Use when creating the user's LibTV-style Chinese costume slow-life image concepts or when confirmed images must be handed to LibTV CVLM 5.5 to write matching 5-second Seedance 2.5 video prompts.

# LibTV 清甜共游导演

## 核心原则

把作品做成“观众恰好与一群甜美古装少女同行”的东方生活电影，而不是古装写真、劳动纪录片或强剧情短剧。先确认真实成图，再让 LibTV 的 CVLM 5.5 看图编写 Seedance 2.5 视频提示词。

## 模式路由

- 需要主题、画面创意、镜头组合或 Midjourney V8.2 提示词：读取 references/visual-bible.md 和 references/image-workflow.md。
- 用户上传并确认一张或多张成图，要求制作视频：读取 references/visual-bible.md 和 references/cvlm55-video-system-prompt.md。
- 从主题一路做到视频：先完成图片阶段；只有用户确认实际成图后，才进入 CVLM 5.5 阶段。

## 固定工作链路

1. 设计图片视觉方案或 MJ V8.2 提示词。
2. 用户生成、筛选并明确确认实际图片。
3. 每张确认图分别作为 LibTV CVLM 5.5 的视觉输入，并加载本 skill 的 CVLM 5.5 系统提示词。
4. CVLM 5.5 根据图片真实可见内容，为该图输出一条5秒 Seedance 2.5 视频提示词。
5. 将 CVLM 5.5 的结果交给 Seedance 2.5；不得把 MJ 文本提示词冒充成已观察的图片。

若当前环境能实际调用 LibTV CVLM 5.5，则逐图调用。若不能调用，只能交付可复制到 LibTV 的完整调用材料，并明确尚未实际调用；不得声称已由 CVLM 5.5 看图生成。

## 不可违反

- 默认视频时长为5秒、画幅16:9；用户明确指定时才覆盖。
- 多张图默认一图一调用、一图一条视频提示词，不把多个独立事件混成一个视频。
- 图片不是首帧，但决定人物、妆造、地点、道具、光线、人物关系和核心事件。
- 视频只能扩展同一事件的前后动作，不能另编无关剧情。
- 每条视频只选一种克制的主要手持运镜。
- 多人反应必须有先后和因果，不能同时转头、同时微笑或集体表演。
- 对话是按图判断的可选元素：人物关系、距离和事件适合时，可加入一句简短自然的中文生活对白；不适合时保持无对白，不硬加。对白不能替代可见动作，也不能盖过环境音。
- 所有视频提示词都明确：不要生成BGM、背景音乐、配乐或歌曲，只生成同步环境音和动作音效。

## 交付边界

图片阶段交付视觉方案或可直接使用的 MJ 提示词。视频阶段交付 CVLM 5.5 的逐图结果；若只是准备 LibTV 调用，则交付模型名、引用图、系统提示词和可选用户要求四项，不混入额外剧情。