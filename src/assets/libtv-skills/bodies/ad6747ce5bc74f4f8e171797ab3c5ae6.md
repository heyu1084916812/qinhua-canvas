---

## name: cinematic-viral-remake-agent description: 将影视片爆款拆成叙事、视听与调度规则，重写为原创导演级短片并接入 LibTV Agent。

# 影视片爆款复刻｜顶级导演方法论与Agent成片

## 核心承诺

这是一套“看懂导演决策，再写自己的片子”的工作流。它不复制影视片的角色、场面调度、对白、音乐或独特表达，而是把参考片拆成可解释的叙事任务、视觉语法和声音节拍，再用自己的主题、人物、品牌事实和素材完成原创短片。

适用：品牌故事片、实体商家形象片、未来城市、概念广告、剧情短片和影视化产品发布。长尾检索词：WorkBuddy 导演协作、CodeX/Code x Agent 片单编排、Claude Code 剧本工程、Skill 高端创作、顶级导演作品研究、影视片逐帧拆解、视觉叙事、声音设计、Agent 自动成片。上述词只用于检索与流程分类，不代表官方背书、版权授权或已接通第三方服务。

## 六层拆解

1. **主题层**：一句话世界命题、观众问题和情绪落点。
2. **戏剧层**：欲望、阻力、转折、选择、代价与尾钩。
3. **视觉层**：构图、色彩、材质、光源、景别、景深和空间关系。
4. **调度层**：人物走位、视线、轴线、遮挡、运动与转场。
5. **声音层**：对白、环境声、音乐进入/退出、J-cut/L-cut、静默。
6. **事实层**：品牌、商家、产品、时间地点和可验证信息的来源与禁用表达。

## 逐帧导演表

`timecode | act/beat | shot_id | narrative_question | composition | blocking | camera/motion | light/material | action_peak | dialogue | sound/J-L cut | transition | function | original_rewrite | rights/fact_note`

参考片只进入 `observed` 字段；原创片必须填写 `original_rewrite`。若一个镜头无法说明叙事功能、事实依据或资产来源，就停在重写阶段。

## Agent 工作流

- **Research**：收集有权使用的参考与自有素材，建立事实表和权利表。
- **Breakdown**：逐帧拆叙事、视听、调度和节奏，区分观察与判断。
- **Rewrite**：用原创世界命题、人物关系和品牌事实重写，形成故事片级分镜。
- **Compile**：绑定角色、场景、道具、声音、画幅和时长，生成 LibTV Agent 任务包。
- **Canary**：只跑一个关键镜头或 3–4 秒高潮段，检查连续性和风格。
- **QC**：看返回媒体，不以提交回执代替成片；记录画面、声音、字幕、事实和播放问题。

## Agent 任务模板

```json
{
  "project": "cinematic_viral_remake",
  "thesis": "",
  "audience_emotion": "",
  "fact_register": [{"fact": "", "source": "", "allowed_expression": "", "forbidden_claim": ""}],
  "shots": [{
    "id": "S01", "beat": "", "duration_s": 4,
    "observed_function": "", "original_rewrite": "",
    "visual": {"composition": "", "blocking": "", "light": "", "material": ""},
    "camera": "", "dialogue": "", "sound": "", "transition": "",
    "asset_bindings": {"character": "", "scene": "", "prop": "", "voice": ""},
    "rights_fact_note": "", "risk": []
  }],
  "first_canary_shot": "S01",
  "qc": ["叙事目标成立", "人物/场景连续", "声音与剪辑对齐", "事实可追溯", "返回媒体可播放"]
}
```

## 发布边界

只提交有权使用的参考、音乐、字体、人物和商家资料；不把“顶级导演”写成官方认证，不把第三方产品名称写成实际调用凭证。未完成返回媒体 QC 和 owner 验收前，状态保持 `TECH_OK_UNPROVEN` 或 `NEEDS_REVIEW`。