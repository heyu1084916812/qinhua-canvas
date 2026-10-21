---

## name: paper-collage-fable description: &gt;- Turns a Chinese fable or idiom story name into a finished 9:16 paper-collage MP4 (vernacular narration, Ken Burns motion by default, burned-in Chinese subtitles). Use when the user names a story like 曹冲称象 / 司马光砸缸 / 掩耳盗铃 / 孔融让梨, says 做一个寓言视频 / 剪纸故事片 / 成语故事视频, or asks to generate a paper-cut story film from only the story title.

# Paper Collage Fable

把**故事名**做成可播放的竖屏剪纸寓言成片。默认全本地、零云端费用。

## Defaults（不要再问，除非用户改）

项默认画幅9:16 · 1080×1920旁白白话文故事原文/通行白话版（非文言）动画**推镜 Ken Burns**（ffmpeg zoompan）配音edge-tts `zh-CN-XiaoxiaoNeural` rate `-5%`字幕烧录 ASS（微软雅黑，白字黑边，底部）项目路径`~/` 或已有 `Projects/`/`Developer/` 下的拼音目录Seedance**默认不用**；仅当用户明确要「动态纸片 / Seedance」且余额足够

## Fast path：用户只给故事名

例如：`曹冲称象` / `做一个孔融让梨` / `用剪纸做守株待兔`

1. 解析故事名 → 拼音项目名（如 `kong-rong-rang-li`）
2. 在聊天里用**极短**分镜表抛出白话旁白（5 场）
3. **立刻开工**，不要等「按这个做」（用户已用故事名下达制作指令）
4. 若故事歧义或用户说「先看剧本」，才停下等确认

## Hard rules

- 成片交付物必须是 `renders/final.mp4`（含字幕），不要停在关键帧或无字幕版
- 视觉：半色调剪纸拼贴；全片一个纸场色 + 固定人物比例；片尾纸签 = 故事名
- 旁白：**零说教清单**；用故事白话推动画面
- 安全提示词：避免过激「溺水/血腥」措辞；落水等用「缸内可见小孩头与手」这类温和描述
- 依赖：`ffmpeg` `ffprobe` `node` `python` `edge-tts`；拼片用 `~/.agents/skills/paper-collage-ad/scripts/assemble.mjs`

## Pipeline checklist

```text
- [ ] 建项目 + move_agent_to_root
- [ ] brief.md / script.md / storyboard.json
- [ ] 风格锚点 scene-01 → 连续 scene-02..05
- [ ] edge-tts → voice-final/*.wav（时长 = 旁白 + 1.2s）
- [ ] 推镜 scene-*.mp4
- [ ] production-manifest.json + assemble → final-nosub.mp4
- [ ] ASS 字幕 → 烧录 → renders/final.mp4
- [ ] 打开 final.mp4 给用户
```

## Project layout

```text
<project>/
  brief.md
  script.md
  storyboard.json
  manifests/production-manifest.json
  assets/keyframes/scene-01.png … scene-05.png
  assets/voice-final/01.wav … 05.wav
  assets/audio/subtitles.ass
  renders/scene-01.mp4 … scene-05.mp4
  renders/final-nosub.mp4
  renders/final.mp4
```

## Script template（5 场）

在 `script.md` 写清：

1. 一句话创意 + 贯穿视觉隐喻
2. 完整白话旁白
3. 分场旁白（1–5）

分镜默认 5 场：起势 → 冲突 → 转机 → 行动 → 点题（纸签故事名）。

## Visual prompt scaffold

每帧重复：layered editorial paper-cut collage · flat paper field · fine round-dot halftone · crisp machine-cut · thin warm-white keyline · soft down-right shadow · flat even light · no purple · no photoreal · no glossy 3D。

- scene-01：风格锚点（建立人物与主道具）
- 之后每帧：`Image 1 = strict style reference` + 上一镜连续 + 只描述新动作
- 片尾：奶油色纸签，**仅**故事名汉字，禁止错字/多余字

色场按故事换，但全片锁定一个 hex（例：院落 sage `#B7C4A8`，沙地 `#D2C2A4`，牛皮纸 `#C4A574`）。

## Ken Burns（默认动画）

对每张关键帧：

```bash
ffmpeg -y -loop 1 -i assets/keyframes/scene-XX.png \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.00016,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=FRAMES:s=1080x1920:fps=30,format=yuv420p" \
  -t DURATION -r 30 -c:v libx264 -preset medium -crf 18 \
  -pix_fmt yuv420p -movflags +faststart renders/scene-XX.mp4
```

`DURATION = voice_seconds + 1.2`；`FRAMES = ceil(DURATION * 30)`。

也可用本 skill 脚本：

```bash
python <SKILL_DIR>/scripts/kenburns_scenes.py --project .
```

## Assemble

`production-manifest.json` 的路径相对 **manifests/** 目录（用 `../renders/...`）。按实际 ffprobe 时长回写 `duration`/`sourceDuration` 后再拼：

```bash
node ~/.agents/skills/paper-collage-ad/scripts/assemble.mjs \
  --manifest manifests/production-manifest.json \
  --output renders/final-nosub.mp4
```

时长误差 &gt; 0.08s 会失败——先对齐再拼。

## Subtitles

用本 skill 脚本从 manifest + 分场旁白生成 ASS 并烧录：

```bash
python <SKILL_DIR>/scripts/burn_subs.py --project .
```

规则：长句拆行；Font `Microsoft YaHei` Size 52；Alignment 2；MarginV 260。

## Optional：Seedance 升级

仅当用户明确要求且 `belt me` 余额足够：

1. 用已锁定关键帧做 I2V（`bytedance/seedance-2-0-mini`，9:16，5s，`generate_audio=true`）
2. `setpts` 拉到场景时长后替换 `renders/scene-XX.mp4`
3. 重跑 assemble + burn_subs

推镜与 Seedance 可混用（贵的镜头用 Seedance）。

## Revisions

用户说做法分镜 N 不对只重画该关键帧 → 重推镜/重 Seedance → 重拼 + 字幕缺少字幕对现有 `final-nosub`/`scenes` 跑 `burn_subs.py`换旁白音色重 TTS → 按新时长重推镜 → 重拼用动态代替推镜Seedance 升级路径

## Deliver

回报：`renders/final.mp4` 绝对路径 + 时长 +「推镜/Seedance」说明。用 `open_resource` 打开成片。

## More detail

- 视觉与分镜细则：[reference.md](reference.md)
- 已验证样例路径：[examples.md](examples.md)