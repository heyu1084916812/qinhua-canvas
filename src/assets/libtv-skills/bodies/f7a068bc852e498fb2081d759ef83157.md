# Ghibli-Style Animated Ad Creator

## Core Methodology

### Framework 1: Style Isolation Architecture

Ghibli animation style must be applied as **aesthetic reference only**, never character cloning. The framework isolates style elements into independent dimensions:

- **Visual Style Layer**: Hand-drawn watercolor texture, visible pencil outlines, soft color saturation (60-75%), paper grain texture, natural diffused lighting
- **Narrative Style Layer**: Slow-paced long takes, subtle small gestures, poetic metaphors, emotional flow over plot beats
- **Reference Works**: Spirited Away, My Neighbor Totoro, Princess Mononoke, Castle in the Sky, Howl's Moving Castle — used ONLY for art style/lighting aesthetics, NOT character design templates
- **Character Layer**: 100% original description — hairstyle, clothing, expression, body proportions must be explicitly defined without relying on reference works to "fill in" details

**Critical Rule**: Prompt must state "采用\[作品名\]的画风与光影美学" (adopt the art style and lighting aesthetics of \[work name\]), NOT "参考\[作品名\]人物造型" (reference character design of \[work name\]).

### Framework 2: Single-Track Audio Composition Logic

Commercial video requires clean audio architecture to avoid track interference:

**3-Layer Audio Model**:

1. **Physical Sound Effects** (video native audio, 0dB): Footsteps, bottle cap opening, wing flapping, object collision, character voice — ONLY action-synchronized Foley sounds
2. **Background Music** (separately generated, +6dB): Instrumental-only, emotional tone carrier, must dominate audio space
3. **Prohibited Audio**: Any melodic tones in video track (bells, magic effects, atmospheric music, instrument sounds)

**BGM Fade-Out Standard Process**:

- Step 1: Trim BGM to video duration (e.g., 15s video → trim BGM to exactly 15s)
- Step 2: Apply `transition` with `transition_duration=3` (3-second tail fade, minimal head fade impact)
- Step 3: Volume boost `+6dB` to compensate for slight head fade volume loss
- Step 4: Composite with video (no `endTime` parameter — let BGM play naturally)

**Why This Works**: `endTime` calculates from BGM's own timeline and causes premature cutoff. The correct approach is pre-processing BGM fade before composition.

### Framework 3: Product Prominence Storyboard Logic

Commercial ads must engineer product visibility into narrative structure:

**3-Act Product Integration**:

- **Act 1 (0-33%)**: Establish scene, character enters with product naturally placed in frame (medium shot)
- **Act 2 (33-80%)**: Product interaction becomes narrative focus — close-up of hands holding/using product, facial expression reacting to product, slow-motion product detail shots
- **Act 3 (80-100%)**: Wide shot with product and character harmonized, brand logo naturally emerges in frame

**Storyboard Grid Allocation** (for 15s video, 9-panel grid):

- Panels 1-2: Scene establishment (product visible but not focal)
- Panels 3-6: Product close-ups and interaction (60% of panels focus on product)
- Panels 7-8: Emotional climax with product
- Panel 9: Brand logo fade-in over final frame

## Workflow

### 1. Preparation Stage

**Input Collection Sequence**:

Step 1: Brand/Product Selection

- Present 6 common brand options + 1 custom input
- If custom input: Generate 2-3 creative direction suggestions + "Keep original idea" option for user confirmation

Step 2: Technical Specifications

- Aspect ratio: 16:9 (landscape) / 9:16 (portrait) / 1:1 (square)
- Duration: 15s (single action) / 30s (complete arc) / 60s (multi-scene)
- Resolution with effect explanation:
  - **480P**: Blurry details, lowest point cost, for quick preview only
  - **720P**: Clear and smooth, good color fidelity, moderate cost, ideal for social media ⭐Recommended
  - **1080P**: Full HD with rich detail, highest cost, for official release/large screen display

**Note**: Do NOT display exact point costs — only describe cost magnitude (least/moderate/highest) and quality trade-offs.

Step 3: Character Design Direction

- Ask: "Main character type?" → Boy / Girl / Creature / Animal / Other
- Then ask: "Does character need companion item?" → Small pet (dog/cat/bird) / Handheld object (bag/book) / None
- Generate **1 character concept image only** (not 4 variations) using 23 Niji 7 model

### 2. Initial Design Stage

**Character Concept Generation**:

- Model: 23 Niji 7, aspect ratio 1:1, quality "32K超清画质"
- Prompt structure:

  ```
  [Explicit character description: gender, age, hairstyle, clothing details, expression, body type]
  + 采用《千与千寻》《龙猫》《幽灵公主》的画风与光影美学,Studio Ghibli art style,Hayao Miyazaki visual style
  + 手绘水彩质感 watercolor hand-painted texture,可见铅笔线稿轮廓 visible hand-drawn pencil outlines
  + 色彩饱和度中低档(60-75%),纸张肌理感 paper grain texture
  + 角色立绘,纯白背景,无道具,无场景元素,character turnaround,plain white background
  + 禁止3D CG塑料感,禁止赛璐璐动漫风格
  ```
- **Critical**: Character appearance must be 100% originally described, NOT "参考某某角色造型" to avoid copyright issues
- **Critical**: Character concept image must have NO props, NO scene elements — pure character only

**User Confirmation Gate**: Show generated image, ask "A — Satisfied / B — Regenerate with adjustments". Only proceed after confirmation.

**Narrative Outline Design**:

- Ask: "Advertising emotion direction?" → Provide 3 preset options (healing/adventure/simple enjoyment) + 1 custom
- Generate time-segmented narrative table based on video duration:
  - 15s video: 3 segments (0-5s / 5-12s / 12-15s)
  - 30s video: 4 segments (0-5s / 5-15s / 15-23s / 23-30s)
- Each segment specifies: Camera action, character action, product appearance, emotional tone

**User Confirmation Gate**: Display narrative table with brand aesthetic summary, ask "A — Adjust narrative / B — Confirm, proceed to storyboard".

**Storyboard Generation**:

- 15s video: Generate **1 nine-panel storyboard grid**
- 30s video: Generate **2 nine-panel storyboard grids** (panels 1-9 and 10-18)
- Model: Lib Image, aspect ratio matching video (e.g., 16:9), quality "标准2K画质"
- Prompt structure:

  ```
  宫崎骏经典动画插画风格,32K超清画质,手绘质感,九宫格分镜草图,每格包含镜头号、场景描述、人物动作
  + [Narrative content from outline]
  + 参考《千与千寻》《龙猫》画面风格,Studio Ghibli animation storyboard
  + 水彩线稿质感,手绘铅笔轮廓线,柔和自然光影
  ```
- Include shot numbers, action descriptions, camera angles in each panel
- **Product Prominence Rule**: 60% of panels must feature product as visual focal point (close-ups, interaction shots)

**User Confirmation Gate**: Ask "A — Regenerate storyboard / B — Satisfied, proceed to video generation".

### 3. Video Generation & Composition Stage

**Main Video Generation**:

- Model: \[@tool:generate_video_seedance_v2_0:Seedance 2.0:https://a.lovart.ai/s/kc5fshyqm3jrs1ej/6762f0bfa58d5c36a6fcfb46\]
- Reference nodes: Character concept image node + storyboard node(s)
- Resolution: User-selected (480P/720P/1080P)
- Prompt structure:

  ```
  【核心参考】基于角色立绘 [node_key] 与分镜草图 [node_key],严格保持角色外形一致性
  
  【画面渲染】
  风格参考:宫崎骏动画电影风格,明确参考《千与千寻》《龙猫》《幽灵公主》《天空之城》《哈尔的移动城堡》画面质感,
  Studio Ghibli animation,Hayao Miyazaki visual style,
  手绘水彩质感 watercolor hand-painted texture,
  可见铅笔线稿轮廓 visible hand-drawn pencil outlines,
  色块边界柔和晕染(非锐利CG边界),
  色彩饱和度中低档(60-75%,非数码过饱和),
  纸张肌理感 paper grain texture,
  柔和漫射自然光 soft diffused natural lighting,
  黄金时段逆光轮廓光 golden hour rim light,
  暖黄橙色温 warm golden color temperature,
  慢节奏长镜头 slow-paced gentle camera movement,
  人物动作细腻小幅度(非夸张大动作),
  禁止3D CG塑料感,禁止赛璐璐动漫风格,禁止快切镜头
  
  【叙事内容】
  [Detailed shot-by-shot narrative from outline, emphasizing product close-ups and interaction]
  
  【音效】
  只允许出现与画面动作直接对应的物理音效。
  绝对禁止:背景音乐、BGM、旋律、配乐、铃声、魔法音效、任何带音调的声音、乐器声。
  no background music, no BGM, no melody, no bell sounds, no musical tones, no instrument sounds, sound effects only.
  仅保留以下动作音效:
  [List specific Foley sounds based on narrative, e.g., footsteps on grass / bottle cap opening / wing flapping / lightning crack / character voice]
  
  【镜头语言】
  [Camera movements, shot types, pacing instructions from storyboard]
  ```
- **Critical**: `need_bgm: false` must be set to prevent AI from generating background music that interferes with separately composed BGM

**BGM Generation**:

- Parallel task while video renders
- Prompt structure:

  ```
  纯器乐吉卜力风格治愈音乐,钢琴主旋律配弦乐与木吉他,
  温柔舒缓节奏,无人声,无歌词,
  [Emotional tone matching narrative, e.g., 平静悠远 / 温暖怀旧 / 轻快明亮],
  适合作为广告背景音乐,音乐在第[duration-5]秒进入收束,
  [Final instrument, e.g., 钢琴单音落下作为终止]
  ```
- Duration: Generate \~20s longer than video to allow for trimming flexibility

**Audio Post-Processing & Final Composition**:

Step 1: Trim BGM to exact video duration

```
trim audio [bgm_node] 0 [video_duration]
```

Step 2: Apply 3-second tail fade with volume boost

```
volume audio [trimmed_bgm_node] +6 --transition --transition-duration 3
```

Step 3: Composite video + processed BGM

```
composite video [video_node] audio [processed_bgm_node]
```

- **Critical**: Do NOT use `endTime` parameter — it calculates from BGM timeline and causes premature cutoff
- **Critical**: Video native audio remains at 0dB to preserve physical sound effects (not -60dB silence)

### 4. Iteration & Quality Control Stage

**Multi-Dimensional Quality Audit**:

**Dimension 1: Style Fidelity**

- \[ \] Hand-drawn watercolor texture visible (not CG-rendered plastic look)
- \[ \] Pencil outline strokes present in character/object edges
- \[ \] Color saturation 60-75% (not oversaturated digital colors)
- \[ \] Soft natural lighting (not harsh CG lighting)

**Dimension 2: Audio Architecture**

- \[ \] BGM starts at full volume (no noticeable head fade)
- \[ \] BGM fades out gradually over final 3 seconds
- \[ \] Physical sound effects (footsteps, object sounds, voices) audible throughout
- \[ \] No melodic tones or music in video native audio track
- \[ \] BGM does not cut off before video ends

**Dimension 3: Product Prominence**

- \[ \] Product appears in 60%+ of video duration
- \[ \] At least one close-up shot clearly showing product details
- \[ \] Character-product interaction conveys emotional connection
- \[ \] Brand logo visible in final 2-3 seconds

**Dimension 4: Narrative Coherence**

- \[ \] If multi-segment video: Segment transitions are visually continuous (last frame of Segment A connects logically to first frame of Segment B)
- \[ \] Character identity (face, body proportions) consistent across all shots
- \[ \] Pacing matches intended emotional tone (slow for healing, moderate for adventure)

**When to Regenerate**:

- Style fidelity fails 2+ checklist items → Regenerate video with reinforced style keywords
- Audio architecture fails → Redo BGM processing (check trim duration, fade parameters)
- Product prominence fails → Regenerate video with modified prompt emphasizing product close-ups
- Narrative coherence fails → Adjust storyboard and regenerate affected segments

## Key Constraints & Standards

### Immutable Rules (Never Violate)

1. **Copyright Protection**: Reference works (Spirited Away, Totoro, etc.) are used ONLY for "画风与光影美学" (art style and lighting aesthetics). Character designs must be 100% originally described. NEVER write "参考\[作品\]人物造型" in prompts.

2. **Audio Track Separation**: Video native audio must contain ONLY physical Foley sounds (footsteps, object interactions, voices). Background music, melodic tones, bells, magic effects, atmospheric music, instrument sounds are PROHIBITED in video track. These interfere with separately composed BGM.

3. **Single Character Concept**: Generate 1 character concept image per iteration, not 4 variations. This conserves points and reduces decision fatigue.

4. **BGM Fade Logic**: NEVER use `transition` parameter in composite (causes head fade volume loss). Instead, pre-process BGM with `volume --transition --transition-duration 3` before composition. NEVER use `endTime` parameter (calculates from BGM timeline and causes premature cutoff).

5. **Storyboard Product Focus**: 60% of storyboard panels must feature product as visual focal point. Close-ups and interaction shots are mandatory for commercial effectiveness.

### Fidelity Standards

**Visual Style Keywords** (must appear in all image/video prompts):

- Core: "宫崎骏经典动画插画风格 / Studio Ghibli animation / Hayao Miyazaki visual style"
- Texture: "手绘水彩质感 watercolor hand-painted texture / 可见铅笔线稿轮廓 visible hand-drawn pencil outlines / 纸张肌理感 paper grain texture"
- Color: "色彩饱和度中低档(60-75%) / 色块边界柔和晕染"
- Lighting: "柔和漫射自然光 soft diffused natural lighting / 黄金时段逆光 golden hour rim light"
- Negative: "禁止3D CG塑料感 / 禁止赛璐璐动漫风格 / 禁止快切镜头"

**Audio Mixing Standards**:

- Video native audio: 0dB (preserves physical sound effects)
- BGM: +6dB (ensures presence without overwhelming Foley sounds)
- BGM fade: 3-second `transition_duration` applied before composition
- BGM trim: Exact video duration (e.g., 15s video → trim BGM to 15s, not 20s)

**Narrative Pacing** (shots per second):

- 15s video: 9 shots → \~1.7s per shot average
- 30s video: 18 shots → \~1.7s per shot average
- Slow contemplative moments: 3-5s per shot
- Action/transition moments: 0.5-1s per shot

### Resolution Cost-Benefit Matrix

ResolutionVisual ClarityDetail RichnessPoint CostBest Use Case480PNoticeably blurryLow — fine textures lostLowestQuick preview, concept validation720PClear and smoothModerate — good for most platformsModerateSocial media, online ads ⭐Recommended1080PCrisp and sharpHigh — visible pencil strokes, fabric textureHighestOfficial release, large screen display

**Important**: Do NOT display exact point numbers to users. Describe cost magnitude (lowest/moderate/highest) and quality trade-offs only.

## Recommended Tools & Models

- **Video Generation**: Use \[@tool:generate_video_seedance_v2_0:Seedance 2.0:https://a.lovart.ai/s/kc5fshyqm3jrs1ej/6762f0bfa58d5c36a6fcfb46\] for all main advertisement video generation. This model excels at stylized animation with strong prompt adherence and smooth motion quality.

- **Character Concept Art**: Use 23 Niji 7 model for character design. This model specializes in hand-drawn anime aesthetics and produces clean character turnarounds suitable for video reference.

- **Storyboard & Props**: Use Lib Image model for storyboard grids and product/prop reference images. This model handles multi-panel layouts and detailed object rendering well.

## Common Pitfalls & Solutions

**Pitfall 1: BGM cuts off before video ends**

- **Cause**: Using `endTime=-5` in composite calculates from BGM timeline, not video timeline
- **Solution**: Pre-trim BGM to exact video duration, apply fade with `volume --transition`, composite without `endTime`

**Pitfall 2: BGM starts too quiet**

- **Cause**: `transition` parameter in composite creates head fade-in
- **Solution**: Apply `transition` in `volume` processing step (with +6dB boost), NOT in composite step

**Pitfall 3: Video native audio contains music that clashes with BGM**

- **Cause**: Insufficient negative keywords in video prompt's \[音效\] section
- **Solution**: Explicitly list prohibited audio types in both Chinese and English: "绝对禁止:背景音乐、BGM、旋律、配乐、铃声、魔法音效、任何带音调的声音、乐器声 / no background music, no BGM, no melody, no bell sounds, no musical tones, no instrument sounds"

**Pitfall 4: Product not prominent enough in final video**

- **Cause**: Storyboard lacks product-focused panels; video prompt doesn't emphasize product shots
- **Solution**: Allocate 60% of storyboard panels to product close-ups and interactions; in video prompt's \[叙事内容\] section, explicitly describe "产品特写镜头" (product close-up shots) with duration specifications

**Pitfall 5: Character looks different from concept art in final video**

- **Cause**: Video prompt doesn't strongly reference character concept node; style keywords overshadow character consistency
- **Solution**: In video prompt's \[核心参考\] section, write "基于角色立绘 \[node_key\],严格保持角色外形一致性:发型、服装、面部特征必须与立绘完全一致" (strictly maintain character appearance consistency: hairstyle, clothing, facial features must exactly match concept art)