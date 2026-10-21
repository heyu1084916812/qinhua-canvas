# doomsday_romance_film_skill.yaml

```yaml
skill_name: 90年代末日爱情电影视觉Skill
skill_id: doomsday_romance_film_v1
version: 1.0
language: zh-CN
description: >
  用于生成超写实、35mm胶片感、低照度、潮湿朦胧、蓝调褪色、
  带有90年代末日爱情电影气质的画面。默认无人物，默认输出2x2网格。

use_case:
  - 末日废墟场景
  - 灾难浪漫主义空镜
  - 蓝调梦境感城市废墟
  - 火山、爆炸、黄昏、潮湿街道、 abandoned city
  - 图像提示词生成
  - 图生视频提示词生成

default_rules:
  realism: 超写实真实摄影
  human_rule: 默认不要生成人物
  layout_rule: 默认形成2x2网格
  style_rule:
    - 禁止明显CGI感
    - 禁止3D渲染感
    - 禁止游戏概念图质感
    - 禁止过度HDR
    - 禁止过度锐化
    - 禁止假景深
    - 禁止高饱和赛博朋克色彩

camera_system:
  format: 35mm电影摄影质感
  frame_rate: 24fps
  lenses:
    environment:
      focal_length: 28-35mm
      note: 中广角环境叙事镜头，真实透视，不过度畸变
    character:
      focal_length: 50mm, 85mm
      note: 仅在明确要求人物时启用，用于情绪近景和特写
  shutter:
    normal: 1/48s
    chaos_escape: 1/24-1/32s
    note: 混乱、逃亡、爆炸、快速运动时使用慢快门制造自然拖影
  aperture:
    environment: F2.8-F5.6
    character_closeup: F1.8-F2.8
  iso: 1250-2500
  white_balance: 6000K
  depth_of_field: 中等景深，背景保留可识别叙事信息

optical_character:
  lens_style: 复古电影镜头成像
  features:
    - 低微反差
    - 适度边缘柔化
    - 轻微光学瑕疵
    - 柔和高光滚降
  diffusion_filter: Black Pro-Mist 1/4-1/2
  bloom: 明显但克制
  halation: 轻微红橙Halation

exposure_strategy:
  exposure: 整体轻微欠曝
  shadows: 暗部保留深蓝黑，不强行提亮
  highlights: 允许爆炸、夕阳、火焰、车灯等自然溢出
  contrast: 低反差，不做硬朗数字对比

film_look:
  stock_reference: Kodak Vision3 500T
  texture:
    - 有机35mm胶片颗粒
    - 轻微低照度噪点
    - 轻微褪色
    - 柔软细节
  digital_suppression:
    - 降低数字锐化
    - 降低clarity
    - 降低micro contrast
    - 避免8K数码锐利感

color_mood:
  base_palette:
    - 深蓝
    - 蓝灰
    - 青灰
    - 蓝黑
  accent_palette:
    - 火焰橙
    - 夕阳橙
    - 红橙高光
    - 暖黄路灯
  atmosphere:
    - 潮湿
    - 朦胧
    - 褪色
    - 蓝调梦境
    - 末日浪漫
    - 90年代爱情电影感

environment_cues:
  preferred_elements:
    - 潮湿空气
    - 薄雾
    - 烟尘
    - 雨后路面
    - 水汽
    - 湿润混凝土
    - 生锈金属
    - 褪色招牌
    - 破败建筑
    - 火光
    - 黄昏天空
  note: >
    优先让光通过空气、水汽、烟雾和湿润表面反射形成空间层次。

emotion_core:
  - 末日感
  - 浪漫感
  - 孤独感
  - 怀旧感
  - 蓝调梦境
  - 灾难浪漫主义
  - 世界即将结束前的宁静与悲伤

positive_prompt_template: >
  超写实，{human_rule}，{layout_rule}，{scene_subject}，
  35mm电影摄影质感，28–35mm中广角电影镜头，24fps电影运动逻辑，
  正常运动1/48s快门，剧烈运动与混乱场景1/24–1/32s慢快门产生自然运动拖影，
  环境镜头F2.8–F5.6，{character_aperture_if_needed}，
  ISO 1250–2500真实低照度成像，约6000K白平衡，
  中等景深，背景保留可识别叙事信息，自然真实的中广角摄影透视，
  复古电影镜头成像，低微反差，适度边缘柔化和轻微光学瑕疵，
  Black Pro-Mist 1/4–1/2扩散滤镜效果，整体轻微欠曝，暗部保留深蓝黑，
  允许爆炸与夕阳高光自然溢出，柔和高光滚降，明显Bloom，轻微红橙Halation，
  降低数字锐化与清晰度，加入35mm Kodak Vision3 500T式有机胶片颗粒与轻微低照度噪点，
  形成柔软、潮湿、朦胧、褪色、蓝调梦境般的90年代末日爱情电影画面。

negative_prompt: >
  人物，人群，肖像，CGI，3D render，游戏画面，Unreal Engine，塑料质感，
  过度锐化，8K数字锐利感，HDR，过度清晰，过度饱和，高对比商业调色，
  过度降噪，假景深，手机人像模式虚化，极端超广角畸变，空间折叠，
  建筑弯曲，不合理透视，赛博朋克霓虹，过度Teal and Orange，
  过强Bloom，过强Halation，均匀数字噪点，AI插画感，概念艺术感

variables:
  scene_subject: 必填，填写具体场景内容
  human_rule: 默认“不要生成人物”，若用户明确需要人物则改为“生成人物”
  layout_rule: 默认“形成2x2网格”，若不是拼图则删除
  character_aperture_if_needed: >
    若无人物则删除；
    若有人物则填写“人物近景F1.8–F2.8，50mm与85mm情绪镜头切换”

usage_rules:
  - 如果用户只给场景，则自动套用全部默认参数
  - 如果用户要求四个不同场景，则保留2x2网格
  - 如果用户要求单张海报或单场景，则删除2x2网格
  - 如果用户要求人物，则解除“无人物”限制，并启用50mm/85mm人物镜头逻辑
  - 如果用户要求更强压迫感，可强化低机位、前景遮挡、烟雾和慢快门拖影
  - 如果用户要求更浪漫，可强化黄昏、逆光、潮湿空气、柔和光晕和褪色感
  - 如果用户要求图生视频，可保留摄影参数并补充镜头运动描述

quick_call:
  short_command: 调用90年代末日爱情电影Skill
  execution: >
    自动添加：超写实、35mm胶片、28-35mm环境镜头、24fps、
    1/48s常规快门、1/24-1/32s混乱拖影、F2.8-F5.6、ISO1250-2500、
    6000K、轻微欠曝、Pro-Mist扩散、500T胶片颗粒、Bloom、轻微Halation、
    潮湿朦胧蓝调褪色末日浪漫氛围。

example_prompt:
  - >
    调用90年代末日爱情电影Skill，四个不同的废弃纽约街头场景，
    黄昏，空气中有烟尘与潮湿薄雾，远处偶尔有火光与坍塌痕迹，
    不要人物，形成2x2网格。16比9格式
  - >
    调用90年代末日爱情电影Skill，海边被遗弃的小镇公路，
    落日余晖，湿润柏油路面反光，远处废弃汽车与褪色路牌，
    不要人物，单张横版16:9。
```