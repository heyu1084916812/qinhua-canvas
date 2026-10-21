# Ancient Fantasy Cinematic Series Generator

## Core Methodology

### Five-Dimensional Feature Extraction Framework

Every reference image is analyzed across five independent dimensions:

**Dimension 1: Character Identity** (immutable across series)

- Facial structure: oval/heart-shaped face, jawline flow
- Eye shape: double eyelids, eye corner angle
- Age perception: 18-25 year old East Asian female
- Skin texture: natural pores, no over-smoothing
- Makeup style: red/orange lips, extended eye corners, forehead mark/teardrop, battle damage when applicable

**Dimension 2: Costume & Styling** (varies per scene)

- Garment type: white martial hanfu / gold-silver palace robe / ice-crystal sheer dress / crimson embroidered gown / dark metallic armor
- Hair configuration: high bun with ornaments / flowing loose hair / half-bound hair
- Accessories: jade pendant / phoenix crown / pearl tassels / weapon props

**Dimension 3: Photographic Language** (systematic variation)

- Focal length: 20mm wide / 35mm standard / 50mm portrait / 85mm close / 135mm telephoto
- Shot type: extreme close-up / close-up / medium / full body / wide establishing
- Camera position: low-angle upward tilt / eye-level / high-angle downward / bird's-eye overhead
- Depth control: shallow DOF with bokeh / deep focus layered space
- Foreground occlusion: weapon/branch/prop blur masking

**Dimension 4: Color & Light System** (unified anchor)

- Color foundation: cool blue-silver cinematic grade + teal shadow undertone + warm gold accent
- Light source: rim light with silver-gold halo / god rays / Tyndall effect / water surface caustics / moonlight top light
- Particle system: golden light particles drifting + luminous dust bokeh (mandatory across all outputs)

**Dimension 5: Scene Space** (realistic to surreal spectrum)

- Realistic environments: bamboo grove / snow field / flower meadow / waterside / courtyard
- Surreal spaces: celestial palace floating on clouds / inverted galaxy river / ice cave with giant statues / underwater dreamscape

### Prompt Character Budget Management

Midjourney v8 enforces 1024-character hard limit. Apply five-tier compression:

**Tier 1: Core Description** (350-400 chars) — Character + Costume + Primary Action

```
Photorealistic cinematic portrait, graceful East Asian woman early 20s, oval face, double eyelids, red lips, wearing deep celadon Song-dynasty beizi over white inner robe, jade pendant, holding oiled paper umbrella, turning back glancing over left shoulder, faint warm smile
```

**Tier 2: Scene Context** (200-250 chars) — Environment + Spatial Layers

```
Misty rain-soaked stone alley, wet cobblestones grey reflections, ink-wash rooftops in fog, rain droplets foreground bokeh
```

**Tier 3: Photographic Specs** (120-150 chars) — Lens + Angle + Depth

```
Low 45-degree medium shot, slight upward tilt, 50mm lens, shallow DOF, film grain, natural skin texture
```

**Tier 4: Visual Anchors** (100-120 chars) — Unified Color/Light/Particle

```
cool blue-silver cinematic grade, teal shadow undertone, warm gold accent, silver-gold rim light halo, golden light particles drifting
```

**Tier 5: Parameters** (20-30 chars)

```
--ar 4:5 --style raw
```

Total: 790-950 characters (safe margin below 1024)

### Reference Image Integration Protocol

Image references use `{{node_key}}` placeholders. Three critical rules:

**Rule 1: Inline Insertion** — Insert `{{node_key}}` at the corresponding description position, NOT stacked at prompt end

```
❌ ...warm amber rim light --ar 4:5 {{i-abc123}} {{i-def456}}
✅ ...East Asian woman early 20s {{i-abc123}}, oval face... wearing celadon beizi {{i-def456}}, jade pendant...
```

**Rule 2: Dimensional Separation** — Multiple references must cover different dimensions (avoid same-dimension stacking)

```
❌ {{i-bamboo-scene-1}} + {{i-bamboo-scene-2}} (both same scene type → conflict)
✅ {{i-character-face}} + {{i-costume-detail}} (character + styling → complementary)
```

**Rule 3: Truncation Prevention** — Keep total prompt ≤800 chars when using multiple `{{node_key}}` to leave buffer

## Workflow

### 1. Preparation Stage

**Input Checklist:**

- \[ \] 3-10 reference images covering style/color/character/scene dimensions
- \[ \] Target scene descriptions for each output (written in natural language)
- \[ \] Desired batch size (5-10 images recommended for consistency)
- \[ \] Output format requirements (image only / image + video / video only)

**Analysis Process:**

1. **Character DNA Lock** — Extract immutable facial features from reference images showing characters:

   - Face shape, eye shape, skin tone, age perception
   - Create character description template reused across all prompts

2. **Style System Inventory** — Categorize reference images by type:

   - Costume styles: white martial / gold palace / ice-crystal / dark armor
   - Scene types: realistic outdoor / surreal celestial / underwater / architectural
   - Color families: cool blue-silver / warm amber-gold / deep dramatic / desaturated film

3. **Consistency Anchor Definition** — Identify elements that MUST repeat:

   - Visual anchor formula: \[base color tone\] + \[shadow undertone\] + \[accent color\] + \[particle system\] + \[light quality\]
   - Example: "cool blue-silver cinematic grade, teal shadow undertone, warm gold accent, golden light particles drifting, silver-gold rim light halo"

### 2. Initial Design Stage

**Series Architecture Design:**

For N outputs, design systematic variation across dimensions:

OutputCharacterCostumeSceneShot TypeColor BaseSpecial Element1\[Locked DNA\]Style ARealisticMediumAnchorRain + umbrella2\[Locked DNA\]Style BRealisticClose-upAnchorMusical instrument3\[Locked DNA\]Style CSurrealWide low-angleAnchorFloating palace...\[Locked DNA\]\[Rotate\]\[Mix R/S\]\[Vary\]\[Constant\]\[Unique prop\]

**Prompt Framework Construction:**

Each prompt follows five-tier structure:

```
[Tier 1: Core Description with {{character-ref}}]
  + [Tier 2: Scene Context]
  + [Tier 3: Photographic Specs]
  + [Tier 4: Visual Anchors (IDENTICAL across series)]
  + [Tier 5: Parameters]
```

**Pre-Generation Validation:**

- \[ \] Character description identical in all prompts
- \[ \] Visual anchor formula copy-pasted identically in all prompts
- \[ \] Each prompt ≤800 characters (if using `{{node_key}}`)
- \[ \] `{{node_key}}` placed inline at corresponding description points
- \[ \] No duplicate scene/costume combinations

### 3. Iteration Stage

**Consistency Audit Checklist:**

After initial generation, inspect outputs for:

**Character Consistency Failures:**

- \[ \] Face shape changed (different person)
- \[ \] Skin tone variation (lighting OK, but base tone must match)
- \[ \] Age perception shift (teenager vs mature woman)
- Solution: Strengthen character description + add more specific facial feature keywords

**Color Consistency Failures:**

- \[ \] Base tone deviated (warm image in cold series)
- \[ \] Particle system missing in some outputs
- \[ \] Light quality inconsistent (hard light vs soft diffused)
- Solution: Verify visual anchor formula was copied identically; increase anchor keyword weight

**Prompt Technical Failures:**

- \[ \] Generation failed/error (likely character limit or `{{node_key}}` placement issue)
- \[ \] Image truncated or missing scene elements (description got cut off)
- Solution: Apply five-tier compression + move `{{node_key}}` inline + reduce to ≤800 chars

**Optimization Dimensions:**

When outputs are acceptable but need refinement:

**Dimension A: Surreal Intensity Control** (0-100%)

- 0%: Pure realistic photography
- 30%: Subtle particle glow + enhanced rim light
- 60%: Anti-gravity elements + nebula sky fusion
- 100%: Full physics-defying surreal space

Implementation: Add/remove surreal keywords progressively:

```
Level 0: [no surreal keywords]
Level 30: + "golden light particles drifting"
Level 60: + "flowers levitating upward" + "petals transform into particles"
Level 100: + "nebula sky merging horizon" + "inverted waterfall" + "floating architecture"
```

**Dimension B: Scene Type Balance**

- Realistic : Surreal ratio should follow narrative arc
- Example 5-image series: R-R-S-S-R (grounded start/end, surreal peak middle)
- Example 10-image series: R-R-R-S-S-S-S-R-R-R (gradual escalation and resolution)

## Key Constraints & Standards

### Immutable Rules (NEVER Violate)

**Character Identity Lock:**

- Once character DNA is defined from reference images, facial description must be IDENTICAL in every prompt
- Skin tone, face shape, eye shape, age perception are pixel-level consistent
- Only expression and hair styling may vary

**Visual Anchor Enforcement:**

- The anchor formula (color base + shadow undertone + accent + particle + light) must be copy-pasted IDENTICALLY in every prompt
- Do not paraphrase or "improve" the anchor — exact repetition ensures model consistency

**Character Budget Ceiling:**

- When using `{{node_key}}` references: ≤800 characters total
- When not using references: ≤950 characters total
- Midjourney v8 hard limit is 1024; exceed = generation failure

### Fidelity Rules (Maintain Unless Explicitly Varied)

**Photographic Quality Standards:**

- Always include: "photorealistic", "film grain", "natural skin texture", "shallow DOF" (or "deep focus" if architectural)
- Always specify: focal length (20-135mm), shot type (close-up/medium/wide), camera angle (low/eye/high)
- Avoid: "3D render", "cartoon", "illustration", "smooth CGI", "over-smoothing"

**Particle System Standards:**

- Golden light particles are the series signature — must appear in EVERY output
- Particle descriptors: "golden light particles drifting" + "luminous dust bokeh"
- Particle density varies by scene: sparse in realistic outdoor, dense in surreal spaces

**Color Grading Standards:**

- Base tone: cool blue-silver (provides neutral foundation)
- Shadow undertone: teal (prevents muddy blacks)
- Accent color: warm gold (creates visual interest without breaking cold base)
- This combination works across both realistic and surreal scenes

### Consistency Rules (Cross-Output Audit)

**Batch Generation Protocol:**

- Generate first 2-3 images → pause → audit character/color consistency
- If consistent: proceed with remaining batch
- If inconsistent: revise character description + anchor formula → regenerate failed outputs

**Reference Image Placement Audit:**

- For each `{{node_key}}` in prompt, verify:
  - \[ \] It appears inline within the relevant description section
  - \[ \] It does NOT appear in a stack at prompt end before `--ar`
  - \[ \] The corresponding reference image URL exists in conversation context

**Series Narrative Arc:**

- First image: establish character + setting (realistic preferred)
- Middle images: explore variation (surreal elements intensify)
- Final image: climax or resolution (maximum surreal OR return to grounded)

## Image-to-Video Adaptation

When converting series images to video segments:

**Per-Segment Structure (3-5 seconds each):**

```
[Duration]-second seamless photorealistic video. [Character description {{node_key}}] [performing micro-action]. [Scene element movements]. [Camera movement]. [Copy full visual anchor formula from image prompt]. Film grain, natural skin texture. No cuts, one continuous shot.
```

**Camera Movement Palette:**

- Static hold with imperceptible slow push-in (contemplative scenes)
- Low-angle slow upward tilt (heroic/celestial scenes)
- Slow pull-back (revealing environment gradually)
- Gentle orbit/arc (360° character reveal)
- Bird's-eye slow rotation (surreal floating scenes)

**Micro-Action Catalog:**

- Fabric/hair sway in breeze (always include for dynamism)
- Subtle finger movement on instrument/prop
- Eyelid blink + slight head turn
- Particle drift direction (upward/swirl/horizontal)
- Environmental elements: rain falling, leaves drifting, water rippling

**Full-Series Video Compilation:**

Option A: Generate 10× 3-second segments → merge into 30-second compilation Option B: Single prompt for 30-second multi-scene video using model Prime (maximum length support)

Option B prompt structure:

```
30-second seamless video journey through 10 ancient fantasy scenes, 3 seconds each, unified by [visual anchor formula]:

Scene 1 (0-3s): [description] + [camera movement]
Scene 2 (3-6s): [description] + [camera movement]
...
Scene 10 (27-30s): [description] + [camera movement]

Transitions: smooth cuts maintaining [particle system] continuity. [Full anchor formula]. Film grain, natural skin texture throughout.
```

## Recommended Tools & Models

Use Midjourney v8 for image generation with strict 1024-character prompt limit awareness. For video generation, use models supporting 30-second duration when creating multi-scene compilations.