---

## name: character-consistency-viral-remake-agent description: 锁定人物身份、服化道与表演连续性，逐帧重写爆款参考片并交给 LibTV Agent 自动成片。

# 人物一致性爆款复刻｜角色资产锁定与Agent导演

## 定位

把获得授权的参考片拆成“人物为什么能被记住”的可执行结构，再用自己的角色资产、品牌事实和场景重写。目标是人物在不同镜头、景别、动作和情绪里保持可辨认，不复制原片的角色、对白、造型或音乐。

适用：品牌故事片、实体商家人物广告、连续短剧、角色型短片、AI真人还原与虚拟角色创作。关键词：WorkBuddy 人物资产管理、CodeX/Code x Agent 协作、Claude Code 工作流、Skill 高端创作、顶级导演方法论、角色一致性、Character Bible、Reference Sheet。关键词用于检索与流程选择，不表示官方合作或已接通第三方接口。

## 输入边界

- 有权使用的参考片或逐帧观察笔记；不得提交盗版、未授权私密素材。
- 角色身份卡：年龄段、体态、脸部特征、发型、服装、道具、声音、禁用变化。
- 场景、品牌/商家事实、时间线、画幅、集数与时长。
- 真实可用的图片、视频、声音资产；缺资产时输出补拍/生成清单，不虚构已生成。

## 逐帧人物表

每一帧或镜头记录：

`timecode | shot_id | 景别/构图 | 人物朝向与视线 | 表情/情绪强度 | 动作起点-峰值-收束 | 服化道与道具状态 | 台词/口型 | 声音与音乐 | 轴线/进出画 | 角色功能 | 可替换变量 | continuity_risk`

把“人物功能”与“人物外观”分开：参考片提供节奏和戏剧功能，原创版本必须重新设计角色关系、台词、动作因果和资产来源。

## 工作流

1. **身份锁定**：建立 Character Bible、正反面参考、表情上限、发型/服装/道具锁和负面约束。
2. **参考观察**：只记录镜头功能、人物目标、冲突升级、表演节拍和声音入口；不摘抄原台词，不复用原角色设定。
3. **原创替换**：为每个镜头填写 `function_equivalent`，把原人物换成自有角色，并给出新的目标、阻力、动作和事实依据。
4. **资产绑定**：每个镜头绑定 character_id、wardrobe_id、prop_id、voice_id、scene_id；缺绑定就停在草稿。
5. **LibTV Agent 接力**：先提交一镜 canary，再按角色一致性和返回媒体 QC 扩展。
6. **回写**：记录 `reference_observed → original_decision → execution_delta → QC_result`，失败镜头只返工局部。

## Agent 任务模板

```json
{
  "project": "character_consistency_viral_remake",
  "brief": "用原创角色重写参考片的镜头功能，不复用原片身份、对白、造型或音乐",
  "character_bible": {"character_id": "C01", "identity_lock": [], "forbidden_changes": []},
  "facts": [],
  "shots": [{
    "id": "S01", "duration_s": 3,
    "function_observed": "", "function_equivalent": "",
    "character_goal": "", "action_peak": "", "dialogue": "",
    "camera": "", "entry_state": "", "exit_state": "",
    "asset_bindings": {"character_id": "C01", "wardrobe_id": "", "prop_id": "", "voice_id": "", "scene_id": ""},
    "continuity_risk": []
  }],
  "first_canary_shot": "S01",
  "qc": ["脸部与体态跨镜一致", "服化道与道具状态连续", "口型/对白/声音对齐", "返回媒体可播放"]
}
```

## 交付门

- **草稿**：身份卡和逐帧表齐全，未进入生成。
- **canary**：首镜返回媒体可播放，身份锁和口型检查通过。
- **QC**：逐镜记录一致性缺陷、画面跳变、声音错配和修复动作。
- **发布候选**：只使用自有/获授权素材，事实、品牌和人物信息可追溯；没有 owner 验收前不写“已上线”。