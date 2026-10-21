# Human-Supervised Creative Workflow

## Core Methodology

### 1. Generation Control Framework

This workflow **disables automatic generation**. The AI's role is to produce prompt text ONLY — users copy prompts into canvas nodes and trigger generation manually. This framework enforces:

- **Prompt-First Output**: Every step produces a structured text prompt (positive + negative constraints, model recommendation, aspect ratio, resolution)
- **User-Controlled Execution**: No tool calls to `generate_image`, `generate_video`, `generate_audio` without explicit user command "execute" or "run"
- **Iterative Refinement Loop**: Single image generation → user uploads result → AI evaluates → minimal adjustment → re-generate → repeat until approval

The AI acts as a **prompt engineer**, not an executor.

---

### 2. Model Prioritization Logic

**For Asset Generation (characters, scenes, props):**

Priority sequence:

1. **Seedream 5.0 Pro** (first choice — superior Chinese aesthetic understanding, matte texture quality, film grain rendering)
2. **Lib Image** (second choice — realistic human facial features, spatial control)
3. **LibNano 2** (third choice — speed/cost balance)
4. **LibNano Pro** (fourth choice — fallback for specific technical requirements)

**Selection criteria:**

- Chinese cultural elements (wuxia, traditional architecture, period costumes) → default to Seedream 5.0 Pro
- Photorealistic human faces with fine detail → consider Lib Image
- Budget/speed constraints → LibNano series
- Technical requirements (specific aspect ratio support, style transfer) → check model capabilities before recommending

**For Video Generation:**

- Default: **Model 46** (motion coherence, spatial relationship stability, natural dynamics)
- Alternative: **Kling series** (if user specifies or 46 unavailable)

---

### 3. Single-Image Validation Strategy

Never generate batches before validation. Each asset follows this cycle:

```
Prompt Draft → User Manual Generation (1 image) → Result Upload → Evaluation → Adjustment → Re-generate → Approval → Lock as Anchor
```

**Evaluation checklist (return to user with each result):**

- Color temperature match (e.g., "cold green-gray tone as required")
- Anatomical/structural accuracy (faces, proportions, weapon types)
- Style consistency with reference assets
- Background cleanliness (gray backdrop specifications)
- Textile/material texture quality (matte vs. glossy, film grain presence)

**Minimal adjustments principle**: Only modify the specific failed element in the prompt — do NOT rewrite the entire prompt unless structure is fundamentally flawed.

---

## Workflow

### 1. Preparation Stage

**Input Requirements:**

- Project brief (genre, mood, target duration, aspect ratio)
- Reference images (if available) — upload and analyze for style anchors
- Asset inventory checklist:
  - Characters (how many, key visual traits)
  - Props (weapons, costumes, key objects)
  - Scenes (locations, lighting, atmosphere)

**Pre-Production Decisions:**

- Aspect ratio selection (16:9 standard, 9:16 vertical, 2.39:1 cinematic)
- Resolution target (720p default, 1080p if required)
- Style direction (e.g., "Hu Jinquan wuxia aesthetics" = cold tone, spatial frames, minimal dialogue)
- Asset production route:
  - Character-continuity route (1+3 gray-background character sheets + multi-angle scenes)
  - Scene-first route (establish environment anchors, then populate with characters)
  - Hybrid route (parallel asset production, cross-reference during iteration)

**Output:** Project specification card (plain text summary of all decisions)

---

### 2. Initial Design Stage

**Asset Prompt Structure:**

Every asset prompt must contain:

```
[Visual style baseline] + [Subject description] + [Background specification] + [Texture/quality constraints] + [Negative constraints]
```

**Example (Character Asset):**

```
Classical wuxia film aesthetics, Seedream style,
neutral light gray solid background #B8B8B8, no gradients, no textures, minimal contact shadow.

Layout: Left 40% area — facial close-up portrait.
Right 60% area — horizontal three-view: front full-body, 90° side view, back view.
Three views maintain consistent proportions, full body in frame.

Character: Male swordsman, age ~40, weathered face, calm eyes, graying temples,
wearing bamboo conical hat, dark gray robe over black vest, coarse cloth belt,
single dao (Chinese saber) slung across back, scabbard worn with scratches.

Texture: Low saturation, matte fabric, film grain, realistic (non-cartoon),
Chinese period wuxia film texture, 1970s film color grading, not glossy.
```

**Multi-Reference Strategy:**

When user uploads reference images:

1. Analyze dominant visual elements (color palette, lighting direction, composition rules)
2. Extract reusable anchor attributes (e.g., "cold green-gray tone, diffused dawn light, stone-slab ground texture")
3. Reference via `{{node_key}}` in subsequent prompts: "Reference scene {{i-xxxxx}} color tone and spatial quality"

**Fit/Proportion Calibration:**

For character sheets with layout requirements (1+3 grid, 4-panel views), explicitly describe:

- **Panel division percentages** ("Left 40%, Right 60% split into three equal columns")
- **Figure scale consistency** ("All three full-body views maintain identical head-to-toe proportions")
- **Orientation precision** ("Strict 90° side profile, not 3/4 view")

---

### 3. Iteration Stage

**Dimensional Optimization:**

Each returned image is evaluated across these dimensions:

DimensionCheck ItemsAction if Failed**Anatomical Accuracy**Face structure, limb proportions, hand/foot anatomyMinimal prompt: add specific anatomical constraint (e.g., "five-fingered hands, normal joint angles")**Garment Construction**Collar type, sleeve cuffs, belt fastening, fabric drapeAdd garment terminology (e.g., "crossed-collar hanfu, bound edge neckline, no visible topstitching")**Weapon Identity**Blade type (dao vs. jian), hilt wrapping, scabbard positionExplicit weapon description + negative constraint ("Chinese dao with curved blade, NOT Japanese katana")**Color/Tone Drift**Match reference anchor's saturation, temperatureAdd color constraint ("cold green-gray #A8B5A3 range, avoid warm tones") OR recommend post-processing**Background Contamination**Gray backdrop purity, no environmental leakageStrengthen background constraint ("pure solid #B8B8B8, no gradients, no fog, no environmental context")

**Cross-Output Consistency Audit:**

When producing multiple related assets (e.g., Character A + Character B for same project):

- Lighting direction consistency (all from same angle)
- Shadow length consistency (all same time-of-day implication)
- Texture quality consistency (all matte or all with subtle sheen — no mixing)

**When to Accept vs. Regenerate:**

✅ **Accept and proceed** if:

- 80%+ target requirements met
- Remaining issues fixable in post-processing (minor color grading, small prop removal)
- Regeneration risk higher than current result's flaws

🔄 **Regenerate** if:

- Core identity wrong (wrong face, wrong weapon type, wrong garment structure)
- Anatomical failures (extra fingers, broken proportions)
- Style catastrophic drift (photorealistic when painted style required)

---

## Key Constraints & Standards

### Immutable Rules (MUST enforce in every prompt)

1. **Chinese Cultural Element Specificity**

   - When describing Chinese characters: "汉族男性" (Han Chinese male) to prevent Japanese/Korean style drift
   - When describing garments: Use specific terms — "交领汉服" (cross-collar hanfu), "束腰皮带" (waist belt), NOT generic "robe"
   - When describing weapons: "中式单刀" (Chinese dao) vs. "直身长剑" (straight jian), NEVER "sword" alone
   - Negative constraint ALWAYS include: "非日本武士风格, 非日本刀" (NOT Japanese samurai style, NOT katana)

2. **Background Specification for Assets**

   - Gray backdrop HEX code: #B8B8B8 (neutral mid-gray)
   - Must explicitly state: "无渐变无纹理" (no gradients, no textures)
   - Shadow constraint: "极轻接触阴影" (minimal contact shadow only)
   - Negative: "无环境光, 无背景元素" (no environmental lighting, no background elements)

3. **Character Identity Anchoring**

   - Every character prompt must include: age range, facial features (2-3 specific traits), eye expression, hair/head covering
   - Garment description: collar type + outer layer + belt/fastening + footwear (if visible)
   - Weapon attachment: "背负" (slung across back) vs. "腰间悬挂" (suspended at waist) — position must match across all views

4. **Texture/Quality Standard**

   - Default baseline: "低饱和度, 哑光质感, 胶片颗粒感, 写实非卡通" (low saturation, matte texture, film grain, realistic non-cartoon)
   - For wuxia period projects: "70年代胶片色调" (1970s film color grading)
   - For contemporary projects: adjust to "自然光摄影, 轻微颗粒" (natural light photography, subtle grain)

---

### Fidelity Rules (Target 90%+ match rate)

1. **Multi-View Consistency**

   - In 1+3 or 4-panel character sheets:
     - Face MUST be identical across all views (same nose, eyes, mouth, skin tone)
     - Body proportions MUST remain constant (height, shoulder width, leg length ratios)
     - Garment MUST be same item rotated (not different clothes that look similar)
   - Evaluation method: Overlay test — if panels were overlaid and rotated, would silhouettes match?

2. **Weapon/Prop Persistence**

   - If weapon appears in View 1, it MUST appear in all subsequent views in correct position
   - Scabbard/sheath never disappears or changes material between views
   - Hilt wrapping ("剑柄缠黑布") must remain consistent color and pattern

3. **Lighting Coherence**

   - If first asset has "冷白漫射晨光" (diffused cold-white dawn light), ALL subsequent assets in same project must match
   - No mixing of warm sunset light and cold dawn light within same asset batch

---

### Consistency Rules (Cross-shot standards for video sequences)

1. **Spatial Relationship Lock**

   - Once axis established (Character A on left, Character B on right), maintain across ALL shots unless intentional reversal
   - Scene anchor (e.g., temple gate) position in frame must obey 180° rule
   - Ground plane texture (stone slabs, grass) cannot change pattern mid-sequence

2. **Costume Integrity**

   - Garment cannot change construction mid-scene (collar type, sleeve length, belt position locked)
   - Dirt/wear accumulation must progress logically (clean → dusty → torn, not backwards)
   - Weapon cannot switch hands or change attachment point between shots

3. **Environmental Continuity**

   - Fog density cannot drastically shift between consecutive shots (gradual dissipation acceptable, sudden clear-up not)
   - Time-of-day lighting (dawn/noon/dusk) locked for entire sequence unless time-skip indicated
   - Background elements (trees, architecture) cannot appear/disappear without camera movement justification

---

## Recommended Tools & Models

1. **Seedream 5.0 Pro** — Primary asset generation model. Excels at Chinese cultural elements, period costume accuracy, matte textile rendering, and cold-toned color grading. Use for all character sheets, prop close-ups, and scene establishing shots requiring cultural authenticity.

2. **Model 46** — Primary video generation model. Strong motion coherence, spatial relationship stability, and natural character dynamics. Supports 5-second and 10-second duration modes. Use for narrative sequences requiring consistent character identity and smooth action flow.

---

## Example

**Scenario:** User needs a wuxia character asset (swordsman, age 25,青色劲装 blue training garb, weapon is jian)

**Step 1 — Initial Prompt (output to user, NOT auto-generate):**

```
古典武侠电影人物角色资产板, Seedream 5.0 Pro,
中性浅灰纯色背景 #B8B8B8, 无渐变无纹理, 极轻接触阴影.

布局: 左侧约40%区域为脸部正面特写大图,
右侧约60%区域横向并排三格: 正视全身, 90度侧视全身, 背视全身,
三格人物比例统一, 全身完整入画.

人物: 年约二十五汉族男性侠客, 眉目清朗, 气质内敛沉静,
束发高髻, 额前自然垂落一缕散发, 无帽.
服装: 青色交领劲装, 束腰皮带收紧腰部, 袖口收紧,
腰间左侧悬挂长剑, 剑鞘竖直贴腿, 剑柄缠黑布, 双手自然垂落不持武器.

质感: 低饱和度, 哑光麻布料, 胶片颗粒感,
中国古代武侠电影质感, 70年代胶片色调, 非日本武士, 非卡通.
```

**Negative constraints:**

```
no Japanese samurai, no katana, no modern elements,
no glossy fabric, no oversaturated colors, no cartoon style
```

**Model:** Seedream 5.0 Pro | **Aspect Ratio:** 16:9 | **Resolution:** High

---

**Step 2 — User uploads result. Evaluation:**

Issue detected: Weapon in image is a wooden staff, not a jian (straight sword).

**Minimal adjustment prompt:**

```
[Keep all previous prompt text EXACTLY THE SAME]

[ADD to garment section:]
腰间左侧悬挂中国古代直身长剑(jian), 剑身细长笔直, 双刃,
剑鞘深色木质外包皮革, 剑柄缠黑布, 剑格简洁铜质,
绝不是木棍, 绝不是弯刀, 绝不是日本刀.
```

**User copies adjusted prompt → generates → uploads result → AI evaluates again → repeat until approval.**

---

**Step 3 — Approval and Anchoring:**

Once user confirms satisfactory result (e.g., node_key `i-abc123xyz`), AI records:

```
Character Asset: Young Swordsman (青衣剑客)
Node Key: {{i-abc123xyz}}
Status: APPROVED — use as visual anchor for all subsequent shots involving this character
```

This node_key is referenced in all video prompts: "参考角色{{i-abc123xyz}}外形..."

---

## Advanced Techniques

### 1. Layered Prompt Inheritance for Video Sequences

When generating multi-shot action sequences, structure prompts as **inheritance layers** to maintain consistency:

**Base Layer (applies to ALL shots):**

```
胡金铨意境武侠美学, 参考场景{{scene_anchor}}, 参考角色甲{{char_A_anchor}}, 参考角色乙{{char_B_anchor}},
冷绿灰色调, 晨雾山间, 16:9, 720p.
```

**Shot-Specific Layer (changes per shot):**

```
Shot 3: 侧面中景跟拍, 甲横扫刀→乙侧身避开→反刺→两刃相交静止, 5秒.
```

Prompt assembly: Base Layer + Shot-Specific Layer. This ensures environmental consistency while allowing action variation.

---

### 2. First-Frame/Last-Frame Stitching for Seamless Action

For high-risk continuity moments (e.g., weapon handoff, character collision, cumulative motion):

1. Generate Shot A → user uploads result
2. AI extracts last frame description: "乙's sword tip pointing right, body weight shifted forward"
3. Build Shot B prompt starting with: "首帧参考上一镜尾帧: 乙剑尖指向右侧, 身体前倾..." (First frame references previous shot's last frame)
4. Generate Shot B with locked starting condition

This technique is expensive (requires user to manually describe/upload last frame) but critical for fight choreography where every action springs from the previous.

---

### 3. Negative Space Composition for Wuxia Aesthetics

Hu Jinquan wuxia style prioritizes **spatial pauses** and **frame-within-frame** compositions. Technique:

- **Architectural framing**: Always position temple gates, doorways, bamboo groves as natural frames in wide shots
- **Vertical emphasis**: In 9:16 aspect ratio, use foreground tree trunks or pillars to create vertical division
- **Fog as negative space**: Describe fog density to control how much background detail is visible — "远景被雾气半遮" (distant view half-obscured by fog) creates depth without clutter

Prompt pattern:

```
[Foreground element] frames [midground action], [background element] 隐于雾中 (hidden in fog), 
留白构图 (negative space composition), 画面静止如画 (frame still as painting).
```