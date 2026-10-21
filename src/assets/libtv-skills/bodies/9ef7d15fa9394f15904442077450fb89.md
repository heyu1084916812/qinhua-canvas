---

## name: camera-motion-viral-remake-agent description: 逆向拆解爆款运镜、轴线与镜头节奏，生成原创电影化调度方案并接入 LibTV Agent。

# 运镜爆款复刻｜电影级调度与镜头语言

## 定位

把参考片的镜头运动变成可拍、可生成、可复核的调度规则：为什么推、何时摇、运动到哪里停、运动如何服务信息。保留镜头功能和节奏逻辑，原创重写场景、人物、动作、台词、光线和声音，不照搬镜头序列。

适用：品牌片、实体商家空间展示、未来城市、产品发布片、故事短片和连续剧情。检索词：WorkBuddy 镜头调度、CodeX/Code x 视觉 Agent、Claude Code 分镜编排、Skill 高端创作、顶级导演镜头语言、运动匹配、轴线连续性、电影级运镜。关键词仅用于分类和流程选择，不代表官方合作或已接通第三方接口。

## 输入与输出

输入：获授权参考片/观察笔记、原创主题、品牌或商家事实、场景地图、角色/产品资产、画幅、节奏和声音方向。

输出：运镜逐帧表、空间轴线图、镜头接力表、原创分镜、LibTV Agent 任务包、一镜 canary 方案、返回媒体 QC 记录。

## 运镜逐帧字段

`timecode | shot_id | 起始构图 | 终止构图 | 景别 | camera_move | speed_curve | lens/perspective | axis | subject_blocking | reveal_point | cut_in/out | light_change | sound_entry | narrative_function | replaceable_variables | motion_risk`

`camera_move` 只能从可解释的动作开始：静止、推、拉、横移、跟拍、摇、升降、环绕、手持、变焦或复合运动。复合运动必须写明先后顺序和停止点，不能只写“电影感”。

## 工作流

1. **空间建模**：建立场景入口、出口、主轴、视线、前后景遮挡和可见事实。
2. **运动归因**：为每个运动标注功能：揭示、压迫、跟随、转折、交代空间或把注意力交给产品/人物。
3. **原创重排**：保持功能等价，改写空间、动作和镜头衔接；不得复制原片连续镜头的组合表达。
4. **画面接力**：明确 `entry_state → motion → exit_state`，下镜头必须接得上位置、视线和光线。
5. **LibTV Agent canary**：先生成最能证明运动成立的 3–4 秒镜头，再扩展长镜头。
6. **返回媒体 QC**：检查运动方向、速度曲线、主体稳定、轴线、首尾接点、声音和可播放性。

## Agent 任务模板

```json
{
  "project": "camera_motion_viral_remake",
  "creative_thesis": "",
  "space_map": {"main_axis": "", "entry": "", "exit": "", "occluders": []},
  "shots": [{
    "id": "S01", "duration_s": 4,
    "function_observed": "", "function_equivalent": "",
    "entry_state": {"subject": "", "camera": "", "axis": ""},
    "camera_move": {"type": "push", "path": "", "speed_curve": "", "stop_point": ""},
    "exit_state": {"subject": "", "camera": "", "axis": ""},
    "scene_assets": [], "motion_risk": []
  }],
  "first_canary_shot": "S01",
  "qc": ["运动方向正确", "主体稳定", "轴线连续", "首尾可接", "返回媒体可播放"]
}
```

## 交付门

- **可执行**：每个镜头有运动起点、终点、速度和功能。
- **可验证**：一镜 canary 先过运动与接点 QC，再扩大生成。
- **可复用**：把合格运动写回镜头资产卡，不把“电影感”当成验收结论。
- **可发布**：素材权利、商家事实、音乐来源和平台分类可追溯；无 owner 验收不写“已上线”。