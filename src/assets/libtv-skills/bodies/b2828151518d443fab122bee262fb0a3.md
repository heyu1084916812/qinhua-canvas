# 短视频带货Skills｜多层嵌套总控版

## 做什么

支持产品、脚本、图片或视频输入，完成创意策划、逐帧拉片、镜头级还原、人物设定、逐句微表演、分镜及 Seedance 2.0 提示词生成。

## 需要什么输入

参考视频、脚本、对白、截图文案、产品图片、人物参考图、产品资料或纯创意目标中的任意一种或多种。未知信息标记“未提供”，不得猜测。

## 怎么做

### 一、先识别主任务

- 有视频＋拉片/逐帧/1:1/还原 → `workflows/reference_video_restore.md`
- 有脚本/对白/表格＋拆解/镜头化 → `workflows/script_analysis.md`
- 保留结构/节奏，不要求每帧一致 → `workflows/structure_adapt.md`
- 只给产品/目标，要脚本和提示词 → `workflows/script_create.md`
- 要思路/栏目/强反差/立项 → `workflows/direction_ideation.md`
- 已有脚本，要优化 → `workflows/script_optimize.md`
- 明确只要提示词、不要分析 → 主工作流完成后，再按 `workflows/prompt_only.md` 裁剪展示
- 要人物标准像/三视图/关键帧 → `workflows/image_asset.md`

### 二、主任务与输出形式分离

“拉片、逐帧、拆解、1:1”是主任务；“给我提示词”通常只是交付要求。不能因为出现“提示词”三个字就跳过拉片、人物设定、分镜或连续性。只有用户明确说“只给提示词、不要分析、不要分镜”时才裁剪。

执行前必须读取 `templates/output_contracts.md`。

### 三、强制依赖

- 所有任务：`modules/core_rules.md`＋`modules/quality_compliance.md`
- 有产品：`modules/product_system.md`
- 最终画面有人物：`modules/character_performance.md`
- 有对白或清晰面部表演：必须逐句微表情＋听者反应
- 有参考视频：`modules/video_restore.md`
- 有脚本/创意：`modules/script_creative.md`
- 有镜头或场景：`modules/camera_scene_continuity.md`
- 输出视频提示词：`modules/audio_duration_seedance.md`

### 四、人物自动补齐规则

最终视频只要出现任何人物，就必须为每位人物输出：人物、年龄、外貌面部描述、服饰描述，并逐字附加固定人物设定提示词。用户只提供产品时，先完成脚本；脚本一旦选择人物形式，自动补齐人物设定。用户明确只要提示词时，人物设定仍不得省略。

### 五、完整性闸门

交付前必须执行 `templates/output_contracts.md` 的十项检查和 `templates/delivery_checklist.md`。缺少强制模块时不得交付。

## 产出什么

根据任务模式输出：视频元数据与允许改动清单、产品档案和动态产品变量、人物形象描述及固定三视图提示词、逐帧/镜头级时间轴、逐句微表情与听者反应、完整脚本、完整分镜、每段不超过15秒的 Seedance 2.0 可复制提示词、统一与项目专属负面提示词、关键帧/人物图提示词、创意方向与评分、标题/封面/评论区，以及100分质检和合规检查。用户只要求某一模块时按需裁剪。

### 输出判断硬规则

- 上述内容是本 Skill 的完整能力清单，必须根据主任务模式选择对应模块，不得把所有任务机械输出成同一种格式。
- 用户说“帮我拉片、逐帧分析、1:1还原、按Skills给我提示词”时，默认仍是完整拉片还原任务；“给我提示词”只是交付项，不代表只输出提示词。
- 只有用户明确出现“只给提示词、不要分析、不要分镜、不要其他内容”等排他表达，才按需裁剪为提示词包。
- 最终画面只要有人物，人物形象描述及固定三视图提示词就是强制模块；有对白时，逐句微表情与听者反应就是强制模块。
- 用户只提供产品并要求带货剧本和提示词时，先完成产品判断、创意方向、人物选择与完整脚本；脚本中只要有人物，就必须补齐人物设定、逐句表演、分镜和提示词。

### 任务模式默认输出矩阵

1. **参考视频逐帧还原**：视频元数据与允许改动清单、产品档案和变量、人物设定、逐帧/镜头级时间轴、逐句微表情、完整改编脚本、完整分镜、Seedance分段提示词、负面提示词、关键帧提示词、100分质检与合规检查。标题/封面/评论区仅在用户要求发布方案或完整商业交付时增加。
2. **脚本/对白拆解**：产品档案和变量、人物设定、结构与时长判断、逐句微表情、镜头化方案、完整脚本、完整分镜、Seedance分段提示词、负面提示词、关键帧提示词、质检与合规检查。
3. **只提供产品，从0创作**：产品档案、创意方向与评分、推荐方向、人物设定、完整带货脚本、逐句微表情、完整分镜、Seedance分段提示词、负面提示词、关键帧/人物图提示词、标题/封面/评论区、质检与合规检查。
4. **创意方向/立项**：产品与目标判断、方向矩阵、5—10个方向、评分、推荐母概念、首条样片结构、系列化延展；若生成完整样片或提示词，自动补齐人物、脚本、分镜和提示词模块。
5. **人物图/关键帧**：人物四项描述、固定三视图提示词、关键帧构图提示词、负面提示词和一致性质检。
6. **明确只要某一模块**：按需裁剪展示，但底层仍执行影响正确性的产品、人物、连续性、时长分段和合规检查。

## 什么时候问你

仅在缺失信息会导致方向根本错误时询问；已提供产品、人物、场景、对白、时长、画幅和输出要求时直接执行。镜头级还原未说明素材权属时，默认改为结构与节奏迁移。

## 文件导航

### 工作流

- `workflows/reference_video_restore.md`
- `workflows/script_analysis.md`
- `workflows/structure_adapt.md`
- `workflows/script_create.md`
- `workflows/direction_ideation.md`
- `workflows/script_optimize.md`
- `workflows/prompt_only.md`
- `workflows/image_asset.md`

### 公共模块

- `modules/core_rules.md`
- `modules/product_system.md`
- `modules/character_performance.md`
- `modules/video_restore.md`
- `modules/script_creative.md`
- `modules/camera_scene_continuity.md`
- `modules/audio_duration_seedance.md`
- `modules/quality_compliance.md`

### 模板与完整规范

- `templates/output_contracts.md`
- `templates/user_input_templates.md`
- `templates/delivery_checklist.md`
- `docs/full_original_spec_index.md`：原完整规范索引。
- `docs/full_original_spec_part1.md`：原完整Skills第1部分，含第1—15章。
- `docs/full_original_spec_part2.md`：原完整Skills第2部分，含第16—31章及附录；两部分合并即完整正文，内容不得被下级文件削弱。

## 冲突优先级

用户明确要求 &gt; 根目录总控规则 &gt; 当前主工作流 &gt; 输出契约与强制依赖 &gt; 公共模块 &gt; 原完整规范归档。下级文件不得取消根目录规定的强制人物设定、产品档案、连续性、分段或质检。