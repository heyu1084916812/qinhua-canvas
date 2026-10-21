# AI Video Prompt Engineering for Kling Model

## Core Methodology

### 1. Anchor-Based Visual Consistency Framework

Kling models exhibit frame-to-frame instability. The solution is a **global anchor system** that locks immutable elements across all shots:

- **Character Anchors (A1, A2)**: Face structure, clothing, body proportions — generate once, reference every shot
- **Environment Anchor (A3)**: Base scene setting (e.g. autumn street, lighting direction) — defines spatial continuity
- **Style Anchor (A4)**: Film grain, color palette, depth of field — enforces aesthetic coherence
- **Composition Anchor (A5)**: Relative positioning (e.g. character distance) — maintains spatial relationships

**Why it works**: Anchors act as visual locks. Each shot prompt must reference relevant anchors explicitly (e.g. "matching A1 character appearance, A4 warm amber tones") to prevent model drift.

### 2. Prompt Constraint Isolation Logic

Kling processes prompts as **concrete visual elements + motion instructions**, NOT abstract concepts. Structure prompts in 4 isolated layers:

**Layer 1 — Physical Objects**: Specific nouns only ("young Japanese woman in cream knit sweater", never "elegant person") **Layer 2 — Action Verbs**: Precise motion description ("slowly turning head left", never "reacting")\
**Layer 3 — Camera Operation**: Explicit cinematography ("camera pushes in from medium to close-up at 0.3 speed", never "emotional zoom") **Layer 4 — Lighting/Texture**: Quantifiable visual properties ("warm amber backlight, 16mm film grain, shallow depth of field", never "atmospheric mood")

**Critical rule**: Abstract emotion words ("nervous", "tender") MUST be converted to physical observables:

- "nervous" → "shoulders tense, breathing visible as white vapor, fingers clenching inside pocket"
- "tender gaze" → "eyes slightly glistening, soft eye contact, chin slightly lowered"

### 3. Negative Prompt Hierarchical Defense

Kling's defects follow predictable patterns. Build negative prompts in 3 priority tiers:

**Tier 1 — Model Defects** (highest priority, copy verbatim every shot):\
`distorted faces, blurry details, morphing artifacts, frame tearing, flickering, inconsistent lighting, unnatural body proportions, extra fingers, missing limbs`

**Tier 2 — Style Drift** (adjust per global tone):\
For warm-toned projects: `cold blue tones, oversaturated colors, digital sharpness, CGI look`\
For minimalist projects: `cluttered background, excessive decoration, busy composition`

**Tier 3 — Shot-Specific Exclusions** (tailored per scene):\
For non-speaking shots: `open mouth, talking, lip movement, speech, dialogue`\
For natural snow: `golden snow, yellow snow, colored snowflakes, tinted snow`\
For heavy snowfall: `light snow, sparse snow, few snowflakes, clear sky`

**Expansion strategy**: Every user correction = new negative keyword. If user says "雪花不应该是金色" (snow shouldn't be golden), immediately add `golden snow / yellow-tinted snowflakes / warm-colored snow` to Tier 3.

### 4. Multi-Shot Temporal Coherence Strategy

For narrative videos &gt;20s, split into 5-8s segments with **overlap anchoring**:

- **Segment handoff**: Last frame of Shot N must match first frame of Shot N+1 in character position, lighting angle, and environmental state
- **State inheritance**: If snow begins in Shot 5, ALL subsequent shots must maintain snow presence (add "snow already falling" to prompts)
- **Motion continuity**: For action spanning shots (e.g. character walking), specify exit/entry motion explicitly ("character exits frame right" → "character enters frame right")

## Workflow

### 1. Preparation Stage

**Input Checklist**:

- \[ \] Complete narrative outline with shot breakdown (specify duration per shot)
- \[ \] Global visual constraints (color palette, film aesthetic, aspect ratio, frame rate)
- \[ \] Character descriptions with wardrobe details
- \[ \] Environment references (time of day, weather, lighting mood)
- \[ \] Audio plan (dialogue timing, whether characters speak on-screen vs. voiceover)

**Anchor Generation Sequence**:

1. Generate 1 representative image per character (front-facing, neutral pose, clear lighting) → save as A1, A2...
2. Generate 1 environment establishing shot → save as A3
3. Generate 1 color/style reference frame with desired film grain/DoF → save as A4
4. Generate 1 composition template for multi-character shots → save as A5
5. Write anchor manifest documenting each anchor's immutable properties

**Critical decisions before generation**:

- Which shots require character speaking? Plan lip sync approach (Kling cannot generate synced audio)
- Which elements must remain pixel-identical vs. slightly variable? (e.g. model's face = identical, pose = variable)
- Where do major scene changes occur? Plan transition strategies (cut vs. dissolve vs. motion-based)

### 2. Initial Generation Stage

**Per-Shot Prompt Construction**:

Format:

```
[Anchor references] + [Physical scene] + [Character action] + [Camera movement] + [Lighting/texture]
```

Example:

```
正向提示词:  
Matching A1 character (cream knit sweater, long black hair), A4 warm amber tones, close-up shot, young Japanese woman's face, expression shifting from casual smile to quiet focused gaze, slowly realizing something important, warm orange street lamp light on her face, golden ginkgo leaves behind her slightly blurred, slight film grain, natural skin texture, eyes becoming still and attentive, 16mm film look.

镜头运动:  
Fixed frame, locked camera position, no movement, capturing subtle facial expression changes.

负向提示词:  
[Tier 1 全局] + cold lighting, exaggerated surprise, cartoonish expression, frozen face [Tier 3 场景特定]
```

**Model Parameter Settings** (Kling 3.0 optimal):

- Mode: Standard (standard mode for shot &lt;10s, professional mode for complex motion)
- Duration: 5s baseline (adjust per shot pacing needs)
- Aspect ratio: 16:9 (or per project requirement)
- Frame rate: 24fps (cinematic standard)
- Creativity: 0.5 (medium — higher values increase variation risk)
- Camera motion intensity: 0.3 (subtle — Kling tends to over-interpret camera movements)

**Batch Generation Strategy**:

- Generate all shots in parallel when possible to reduce wait time
- For dependent shots (e.g. reaction to previous action), generate sequentially

### 3. Iteration Stage

**Quality Audit Dimensions**:

**A. Visual Consistency Audit**:

- \[ \] Character face/clothing/proportions match anchors across all shots
- \[ \] Color grading remains consistent (no sudden cold/warm shifts)
- \[ \] Film grain intensity uniform throughout
- \[ \] Environmental state continuity (e.g. if it's snowing in Shot 5, must snow in Shot 6-10)

**B. Motion Fidelity Audit**:

- \[ \] Camera movement matches specified instruction (e.g. "slow push-in" not "rapid zoom")
- \[ \] Character actions align with narrative (no unintended gestures)
- \[ \] Lip sync correctness: For voiceover shots, lips MUST stay closed; for dialogue shots, mouth movement should appear natural (note: Kling cannot generate accurate lip sync, plan for post-production dubbing)

**C. Defect Detection**:

- \[ \] No facial distortion (eyes/mouth morphing, asymmetry)
- \[ \] No limb errors (extra fingers, unnatural bending)
- \[ \] No temporal glitches (flickering, sudden cuts, frame tearing)
- \[ \] No style contamination (e.g. CGI-like rendering when aiming for film aesthetic)

**Regeneration Decision Matrix**:

Issue TypeThreshold for RegenerationFix StrategyAnchor mismatchCharacter face differs significantlyAdd more specific descriptors to prompt (e.g. "exact same facial structure as A1, identical hairstyle")Wrong motionCamera movement contradicts instructionReduce camera motion intensity parameter to 0.2, add negative keywords like `rapid zoom, handheld shake`Lip sync errorCharacter's mouth moves during voiceoverAdd to negative prompt: `open mouth, lip movement, talking, speaking, any mouth action` + positive: `lips tightly closed, mouth completely still`Style contaminationCold blue tones appear in warm-toned projectStrengthen Tier 2 negatives: `cold blue tones, blue cast, cool lighting, any blue color`Insufficient effectSnow is sparse when "heavy snowfall" specifiedAmplify positive descriptors: `extremely dense white snowflakes, blizzard-like heavy snow, visibility reduced, background almost covered by snow` + negative: `light snow, sparse snow, few snowflakes, clear sky`

**Correction Accumulation Strategy**: Every user correction must be immediately encoded into the prompt framework. If user says "男生紧张但态度诚恳" (nervous but sincere attitude), translate to physical observables and ADD to all future similar shots:

- Positive: `shoulders slightly tense, body leaning forward slightly, chin tucked, steady eye contact, slow deliberate speech`
- Negative: `exaggerated nervousness, shifty eyes, looking away, rapid speech`

## Key Constraints & Standards

### Immutable Rules (Never Violate)

1. **Anchor Reference Mandate**: Every shot prompt MUST explicitly reference applicable anchors (A1, A2, A3...). Omitting anchors = consistency failure.

2. **Abstract-to-Concrete Translation**: Emotion/mood words are FORBIDDEN in raw form. Always convert:

   - ❌ "character feels nervous" → ✅ "character's hands tremble slightly, visible breath in cold air, eyes darting"

3. **Motion Sequencing for Multi-Step Actions**: When user specifies action order (e.g. "先说话再拥抱" — speak first, then hug), encode as time-gated sequence:

   - Positive: `character speaks full dialogue with visible lip movement, finishes speaking, THEN slowly raises arms to hug`
   - Negative: `hugging while speaking, hugging before speaking, simultaneous hug and speech`

4. **Voiceover vs Dialogue Distinction**:

   - Voiceover shots: `lips tightly closed throughout, mouth completely still, no lip movement` + negative: `open mouth, speaking, talking, lip action`
   - Dialogue shots: Allow natural mouth movement but note that audio must be dubbed in post

### Fidelity Standards

5. **Color Grading Lockdown**: If project uses "warm amber + golden yellow" palette, EVERY shot must include `warm amber tones, golden yellow highlights` in positive + `cold blue tones, cool colors, blue cast` in negative. Single shot deviation breaks visual coherence.

6. **Film Aesthetic Consistency**: If using "16mm film grain, shallow depth of field" aesthetic, ALL shots must include these exact descriptors. Never mix film-look shots with digital-sharp shots.

7. **Weather/Environmental State Inheritance**: If snow begins falling in Shot N, ALL shots N+1 onward must maintain `snow falling, snowflakes in air, snow-covered ground` until narrative indicates weather change.

8. **Camera Motion Discipline**: Avoid vague motion terms. Always specify:

   - Direction: `push in` / `pull out` / `pan left` / `tilt up`
   - Speed: `slow` / `medium` / `rapid` (Kling default is too fast, always specify `slow`)
   - Extent: `from medium shot to close-up` / `slight pan 15 degrees left`

### Negative Prompt Construction Standards

 9. **Tier 1 Global Negatives** (copy to every shot):

    ```
    distorted faces, blurry details, fast motion, morphing artifacts, frame tearing, flickering, inconsistent lighting, unnatural body proportions, extra fingers, missing limbs, distorted jaw, asymmetric eyes
    ```

10. **Defect-Specific Negatives** (add when issue observed):

    - For facial distortion: `distorted facial features, unnatural skin texture, CGI-like face`
    - For motion jitter: `handheld camera shake, rapid zoom, jittery movement, unstable footage`
    - For over-saturation: `oversaturated colors, neon colors, artificial colors, color bleeding`

11. **Negative Expansion Protocol**: When user identifies unwanted element (e.g. "雪花不应该是金色"), immediately expand negatives with 3-5 related terms:\
    User: "snow shouldn't be golden"\
    → Add: `golden snow, yellow snow, orange snow, warm-tinted snowflakes, colored snow`

### Consistency Audit Rules

12. **Character Identity Pixel-Lock**: Face structure, skin tone, hairstyle must be IDENTICAL across shots. If variance detected, regenerate with stronger anchor reference (e.g. `exact same facial features as A1, identical bone structure, same hairstyle with no variation`).

13. **Wardrobe Continuity**: Clothing (color, style, layering) must match unless narrative indicates change. For jacket scenes, specify `navy blue trench coat, collar shape matching A2, same button configuration`.

14. **Action Sequence Handoff**: For actions spanning multiple shots:

    - Shot N ends: `character exits frame right, walking motion`
    - Shot N+1 begins: `character enters frame right, continuing walking motion, same pace`

## Recommended Tools & Models

Use **Kling 3.0** for video generation. Optimal for character-driven narrative shorts with controlled camera motion and cinematic aesthetics.

## Example

**Scenario**: 35-second Japanese confession short film, warm autumn tones, 7-shot structure, voiceover + dialogue mix.

**Anchor Setup**:

- A1: Female lead (cream knit sweater, long black hair, specific facial structure)
- A2: Male lead (navy trench coat, reserved expression)
- A3: Autumn street (ginkgo trees, warm orange street lamps)
- A4: Visual style (16mm film grain, warm amber palette, shallow DoF)
- A5: Composition (male half-step behind female, 16:9 medium shot)

**Shot 2a (Voiceover shot — male character does NOT speak on screen)**:

正向提示词:

```
Matching A2 character appearance (navy trench coat), A4 warm amber tones and 16mm grain, close-up shot, young Japanese man's face, lips tightly closed throughout, mouth completely still with no movement, nervous but controlled expression visible in eyes, deep in thought, watching someone off-screen, subtle micro-expressions of hesitation in eyebrows, shallow depth of field blurring golden ginkgo background, slight winter breath visible in cold air, eyes slightly glistening.

Voiceover audio (added in post-production): "さっきからずっと考えてた。いつ切り出そうかって。" (Character does not speak these words on screen — lips remain closed, audio is external narration)
```

镜头运动:

```
Camera slowly pushes from medium shot to close-up at 0.3 speed, then locks position.
```

负向提示词:

```
[Tier 1] distorted faces, blurry details, morphing artifacts, unnatural body proportions  
[Tier 2] cold blue tones, oversaturated colors, digital sharpness  
[Tier 3 Voiceover-specific] open mouth, talking, speaking, lip movement, mouth moving, any lip action, dialogue, words coming from mouth, lips parting, mouth opening
```

**Result**: Character's internal monologue plays as voiceover while his face shows silent contemplation. Lips stay closed throughout. Audio added in post-production.

---

**Shot 5 (Heavy snowfall scene)**:

正向提示词:

```
Matching A1 and A2 characters, A4 warm amber tones, medium shot, both characters standing face-to-face under warm orange street lamp, extremely dense white snowflakes falling heavily, blizzard-like heavy snow filling entire frame, visibility reduced, background almost completely covered by white snow, snowflakes landing on hair and shoulders, ground already covered in thick white snow, natural pure white snow (not golden or tinted), warm orange lamp creating soft glow through heavy snowfall, 16mm film grain, magical atmosphere.
```

镜头运动:

```
Fixed frame, locked camera, no movement, capturing the moment.
```

负向提示词:

```
[Tier 1] distorted faces, blurry details, morphing artifacts  
[Tier 2] cold blue tones, oversaturated, digital sharpness  
[Tier 3 Snow-specific] light snow, sparse snow, few snowflakes, small amount of snow, clear sky, golden snow, yellow snow, orange snow, colored snowflakes, tinted snow, warm-colored snow
```

**Result**: Intense snowfall effect with natural white snow, maintaining warm amber lighting on characters.

## Advanced Techniques

### Temporal Defect Prevention

Kling may introduce flickering when scene has high contrast or rapid motion. Mitigation:

- Reduce creativity parameter to 0.4
- Add `stable lighting, consistent exposure, no flickering` to positive
- Add `flickering, frame tearing, sudden brightness changes, exposure fluctuation` to negative
- For extreme cases, generate at professional mode with extended duration, then trim

### Lip Sync Workaround Strategy

Since Kling cannot generate accurate lip sync:

- **Option A (Voiceover)**: Keep lips closed, add dialogue in post as voiceover
- **Option B (Natural dubbing)**: Generate with generic mouth movement, dub in post with matched audio
- **Never** write exact dialogue text in prompt expecting sync — model will generate random mouth motion

### Anchor Drift Recovery

If character appearance shifts between shots despite anchor references:

1. Regenerate the drifted shot with DOUBLE anchor descriptors (e.g. "exactly matching A1 character: same facial structure, identical hairstyle, same clothing as previous shot")
2. If drift persists, generate a new anchor image from the best existing shot, update anchor manifest, regenerate all remaining shots with new anchor
3. As last resort, use consistent seed value across shots (if model supports) to force visual coherence