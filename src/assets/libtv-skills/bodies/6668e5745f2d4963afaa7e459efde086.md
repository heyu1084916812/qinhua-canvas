# Chinese Xianxia Scene Generation with Rule-Based Validation

## Core Methodology

### Rule-Driven Prompt Framework (16-Layer Constraint System)

This skill encodes a highly specialized prompt generation methodology for Chinese fantasy (xianxia) architecture visualization. The core innovation is a **16-rule constraint lattice** that systematically prevents common AI image generation failures while maintaining creative flexibility.

**Framework Logic**: Each rule targets a specific failure mode observed through iterative testing:

- **Weathering paradox** (Rule 1): AI models over-interpret "aged" as "ruined". Counter-rule: describe pristine materials, confine aging marks to edges only.
- **Scale collapse** (Rule 2): Monumental structures lose grandeur if fully framed. Solution: architectural tops must exceed frame boundaries, forcing visual truncation.
- **Detail degradation** (Rule 3): AI defaults to smooth geometric abstraction for complex structures. Fix: explicitly enumerate architectural elements (tiles, brackets, lattice windows).
- **Reference object algebra** (Rules 4-5, 16): Remove all scale references → structure shrinks. Single tiny human figure (back-facing, 1/10 frame height) + countable lanterns (≤7) provide dual-axis scale calibration.

**Constraint Composition Pattern**:

```
Primary structure + Material specification + Detail enumeration + 
Spatial relationship definition + Human reference insertion + 
Fog layering + Light source separation + Negative space definition
```

### Layered Fog Architecture (3-Layer System)

Chinese landscape painting encodes atmospheric depth through fog stratification. Direct translation:

- **Layer 1 (foreground)**: Thin wispy mist — creates separation between viewer and main subject, prevents "sticker effect"
- **Layer 2 (midground)**: Dense cloud sea with **mandatory fissures** — reveals depth axis, breaks flatness
- **Layer 3 (background)**: Soft haze — depth gradient into infinity

**Critical implementation rule**: Cloud sea gaps must be **structurally described** ("visible fissures", "rifts revealing deeper layers"), not merely implied. Without explicit gap description, AI generates solid cloud blanket.

### Variable Isolation for A/B Testing

To enable systematic refinement, each generated batch includes:

- **Main prompt**: Complete rule-compliant baseline
- **Variant A**: Single variable change (typically lighting: moonlight → sunset)
- **Variant B**: Different single variable (typically atmospheric: standard fog → dramatic rifts)

**Isolation methodology**: Copy entire main prompt verbatim, perform surgical replacement of 1-2 phrases only. This creates **minimal edit distance variants**, allowing causal attribution of visual differences.

### Mechanical Validation Checklist

The 16 rules translate into a **binary validation matrix** — each rule becomes a testable constraint:

- "Is the building top cut off by frame edge?" (Y/N)
- "Are roof tiles, eaves, bracket clusters individually discernible?" (Y/N)
- "Does fog have 3 distinct layers?" (Y/N)

**Philosophy**: Validation checks structural compliance only. Subjective aesthetics ("does it feel mystical?") are explicitly excluded. The AI's role is rule enforcement, not taste-making.

## Workflow

### 1. Scene Input & Rule Mapping

**Required input**: Single-sentence scene description (e.g., "white jade palace floating above cloud sea", "cliff-edge hermit hut beside ancient pine")

**Optional input**:

- Aspect ratio (default 9:16 vertical)
- Color palette preference (default: white jade + celadon green + gold accents)

**Mapping process**:

1. **Identify main structural element**: palace/pavilion/altar/bridge/gate → determines architectural detail vocabulary (Rule 3)
2. **Determine spatial relationship**: floating/cliff-mounted/lake-centered → applies Rules 6, 10 (no ambiguous ground connection)
3. **Extract atmospheric requirements**: cloud sea/waterfall/forest → triggers fog layer rules (14), waterfall specification (15)
4. **Derive scale reference strategy**: Structure size → human figure placement (Rule 4), lantern count (Rule 16)
5. **Check for prohibited elements**: spiral clouds (Rule 13), depth repetition (Rule 8) → apply constraints

### 2. Prompt Assembly with Frozen Segments

**Segment structure** (order is critical):

```
[Monumental descriptor + material] + 
[Architectural style + detail enumeration] + 
[Spatial relationship + void definition] + 
[Human reference with proportions] + 
[Fog layering with gaps] + 
[Water features (if applicable) with precision specs] + 
[Ornament distribution rules] + 
[Light source separation: cool vs warm] + 
[Negative space flow] + 
[Color accents] + 
[Technical parameters: --ar X:Y --style raw --v 6.1]
```

**Critical assembly rules**:

- Material must precede detail → "white jade" locks material before "glazed tiles" specifies roof detail
- Spatial relationship must include negative definition → "suspended above clouds, no mountains below" (not just "floating")
- Fog layers must be sequenced (foreground → midground → background)
- Light/color separation: "cool moonlight from above" + "warm amber glow from within" → never merge into single light description

**Frozen segment principle**: Once a segment is written for a scene type, it becomes a template. For batch generation (e.g., 10 variations of "snow mountain golden temple"), only the variable dimension changes (camera angle, time of day), core structure stays identical.

### 3. Variant Generation via Surgical Variable Swap

**Variable taxonomy**:

- **Lighting axis**: moonlight / sunset / dawn / midday (affects warm/cool balance, shadow hardness)
- **Atmospheric axis**: standard fog / dramatic rifts / minimal mist / dense shroud
- **Material axis**: white jade / celadon stone / dark wood (rarely changed, high-risk)
- **Scale axis**: human figure size, lantern count (dangerous to modify, avoid)

**Swap protocol for Variant A** (lighting change example):

```
Original: "cool blue-white moonlight from above casting sharp shadows, warm amber glow from within"
Variant A: "warm golden sunset light raking across facade, soft rose-tinted lantern light from within"
```

All other text stays frozen. Output note: "Changed variable: lighting (moonlight → sunset)"

**Swap protocol for Variant B** (atmospheric change example):

```
Original: "visible fissures revealing deeper cloud layers"
Variant B: "wide dramatic rifts and chasms revealing deep dark abyss far below"
```

### 4. Batch Execution Strategy

**Standard batch size**: 4-10 images per prompt (this is non-negotiable — AI image generation has inherent randomness, single-shot success is unreliable)

**Parallel generation workflow**:

- For 10 images: split into 2 batches of 5 (parallel API limit)
- For multi-scene projects: generate 1 image per scene first (validation pass), then expand promising scenes to 10-image batches

**Scene diversity protocol** (when user requests "10 different scenes"):

1. Define 10 distinct structural archetypes:
   - Floating palace (Rule 6: void below)
   - Cliff pavilion (Rule 10: anchored to vertical surface)
   - Bridge architecture (Rules 7-8: connection logic)
   - Mountain peak temple (Rule 2: cut-off principle)
   - Forest altar (Rules 11, 13: minimal ornamentation)
   - Waterfall grotto (Rule 15: water precision)
   - Lake island structure (Rule 6: reflection logic)
   - etc.
2. Generate 1 prompt per archetype, each applying full 16-rule set
3. Batch-produce in two waves (5+5)

### 5. Validation & Iteration

**Mechanical checklist application**:

- Load generated image
- Step through 16 binary checks in order
- Mark pass (☑) / fail (☐) for each
- **Acceptance threshold**: All structural rules (1-10, 16) must pass; aesthetic rules (11-15) allow 1-2 failures

**Iteration triggers**:

- **If 8+ images in batch pass validation**: Proceed to selection, no regeneration needed
- **If 5-7 images pass**: Regenerate failed slots only (preserving seed/prompt)
- **If &lt;5 images pass**: Prompt has systematic error → return to Rule Mapping stage, identify violated constraint, revise frozen segment

**Common failure patterns & fixes**:

- "Building top is fully visible" → Add "cut off by upper frame edge" explicitly
- "Figure is front-facing" → Change to "back fully facing viewer"
- "Cloud sea is solid" → Add "with visible fissures and rifts"
- "Waterfall is blurry" → Strengthen to "pencil-thin, sharp clean edges"

## Key Constraints & Standards

### Immutable Rules (Never Compromise)

**Rule 1 — Anti-Ruin Constraint**: Weathering descriptors ("aged", "ancient", "time-worn") trigger ruin generation. Counter-strategy: Use "pristine", "luminous", specify "white jade" material. Confine aging only to edge elements ("moss only at cliff ledges").

**Rule 2 — Frame Truncation for Scale**: Monumental structures must exceed frame boundaries vertically. Describe as "top cut off by upper frame edge". If fully framed, structure loses grandeur.

**Rule 3 — Detail Enumeration**: AI cannot infer architectural complexity. Must explicitly list: "glazed roof tiles", "dougong bracket clusters", "carved lattice windows", "vermillion wooden doors". Absence → smooth geometric blob.

**Rule 4 — Human Reference Standard**: Exactly one figure, back-facing, occupying 1/10 of frame height. Front-facing figures draw viewer attention away from architecture. Multiple figures break scale reference.

**Rule 5 — Mandatory Human Presence**: Landscapes without figures lose scale anchoring → structures shrink. Even in "empty" scenes, insert tiny figure.

**Rule 6 — Void Definition for Floating Structures**: "Floating" alone is insufficient. Must specify: "suspended above clouds, no mountains below, no ground connection". Otherwise AI adds support structures.

**Rule 10 — Spatial Relationship Singularity**: A structure cannot simultaneously float and rest on ground. Choose one: "anchored to cliff face" OR "suspended in void". Hybrid descriptions cause visual ambiguity.

**Rule 16 — Countable Reference Objects**: Lanterns must be enumerated ("seven red lanterns"). "Many lanterns" → uncountable blur. Reference objects provide secondary scale calibration.

### Fidelity Rules (High Priority)

**Rule 7 — Anti-Sticker Prevention**: Floating elements without depth cues become flat cutouts. Solutions: (a) foreground mist layer creates separation, (b) connecting elements (bridges, walkways) provide depth, (c) three-edge negative space framing (not four-edge = sticker).

**Rule 8 — Repetition in Depth is Forbidden**: Nested depth (palace behind palace behind palace) creates visual clutter and scale confusion. Solution: horizontal arrangement ("side-by-side pavilions") not depth stacking.

**Rule 9 — Vertical Negative Space Flow**: In vertical compositions (9:16, 4:5), negative space (sky/void) must run full height uninterrupted. Compressed negative space (narrow strip) breaks composition.

**Rule 14 — Three-Layer Fog with Structural Gaps**: Fog must have distinct density layers: thin (foreground) / dense (midground cloud sea) / soft (background haze). Cloud sea must have "visible fissures" or "rifts" revealing lower layers. Solid cloud layer = flat depth.

**Rule 15 — Waterfall Precision Specification**: Waterfalls default to blurry mist. Fix: "pencil-thin", "straight drop", "sharp clean edges", "only dispersing into mist where it meets cloud sea". Each precision term is necessary.

### Consistency Rules

**Rule 11 — Ornament Zoning**: Large wall surfaces must be "smooth unadorned white jade". Decorative elements (carvings, paintings) confined to "eave undersides and door frames only". Distributed ornamentation → visual noise.

**Rule 12 — Light/Color Separation**: Describe lighting (cool/warm, directionality) and color (material hues) in separate clauses. Merged descriptions ("warm golden palace") confuse material vs illumination.

**Rule 13 — Background Element Restraint**: Dramatic sky features (spiral clouds, oversized moon) must be "barely suggested" or "in far distance". If described prominently, they dominate composition, pulling focus from main structure.

### Technical Parameters

- **Aspect ratio**: 9:16 (vertical) for pavilions/towers, 16:9 (horizontal) for bridges/valleys, 1:1 for symmetrical structures
- **Midjourney version**: `--v 6.1` or `--v 8.1` (V6.1 has better architectural detail retention, V8.1 has superior atmospheric rendering)
- **Style flag**: `--style raw` (disables Midjourney's auto-beautification, gives more control)
- **Batch size**: Minimum 4 per prompt, recommended 10 for important scenes
- **Negative prompt**: Always append standardized negative terms to filter common failures

### Negative Prompt (Standard Template)

```
ruins, broken walls, overgrown moss everywhere, smooth sci-fi geometry, missing eaves and brackets, multiple people, front-facing figures, mountain beneath floating structure, sticker-like cutout, cluttered depth, narrow vertical negative space, both floating and grounded, excessive ornamentation, grey flat lighting, monochrome warm wash, dominant spiral clouds, flat fog without layers, blurry waterfall, no human reference, uncountable lanterns
```

## Recommended Tools & Models

This skill was developed for and optimized with **Midjourney V6.1** and **Midjourney V8.1**. V6.1 excels at architectural precision and detail retention (Rules 2-3 compliance), while V8.1 provides superior atmospheric effects (Rules 14-15 fog/water rendering). For production workflows, run critical prompts on both versions and select best results.

Alternative models (DALL-E 3, Stable Diffusion XL) were tested but showed poor compliance with Rules 3 (detail enumeration), 6 (void definition), and 15 (waterfall precision). Not recommended without extensive prompt adaptation.

## Example

**Input**: "Snow mountain golden temple, vertical composition"

**Generated Main Prompt**:

```
A colossal golden-roofed temple perched atop a snow mountain peak, traditional Chinese xianxia architecture, the structure top cut off by the upper frame edge to emphasize monumental scale. White jade base walls with carved lattice windows, glazed golden roof tiles, intricate dougong bracket clusters beneath every eave. A single tiny figure in pale robes stands on a lower terrace, back facing viewer, occupying approximately one-tenth of image height. The mountain peak drops into pure void below, no foothills, only layered clouds with visible fissures revealing deeper darkness. Three fog layers: thin snow mist in foreground, dense cloud sea at mid-altitude with gaps, soft haze dissolving the distant horizon. Six golden lanterns hang from the eaves, countable. Large wall surfaces are smooth white jade, decorative carvings confined to eave undersides and door frames only. Lighting: cool blue-white daylight from above casting sharp shadows on snow, warm amber glow from within temple windows. Negative space runs full height of composition. 
--ar 9:16 --style raw --v 6.1
```

**Variant A** (lighting change): Replace "cool blue-white daylight" with "warm golden sunset light raking across the facade", replace "warm amber glow from within" with "soft rose-tinted lantern light from within".

**Variant B** (atmospheric change): Replace "visible fissures revealing deeper darkness" with "wide dramatic rifts and chasms revealing a deep abyss far below".

**Validation Checklist** (abbreviated):

- ☐ Temple top cut off by frame? (Rule 2)
- ☐ Tiles, eaves, brackets individually visible? (Rule 3)
- ☐ One figure, back-facing, 1/10 height? (Rule 4)
- ☐ No mountains below temple, only void? (Rule 6)
- ☐ Cloud sea has gaps/fissures? (Rule 14)
- ☐ Six lanterns countable? (Rule 16)

## Advanced Techniques

### Multi-Stage Scene Composition

For complex environments (e.g., "mountain valley with multiple pavilions"), use staged generation:

1. **Stage 1**: Generate base environment (mountain/valley/lake) without architecture, focusing on fog layers and spatial depth
2. **Stage 2**: Use image-to-image mode, overlay architectural elements with explicit spatial anchoring ("pavilion on left cliff face", "bridge connecting right peaks")
3. **Stage 3**: Refinement pass for detail enhancement (zoom into specific structures, regenerate at higher resolution)

This prevents the "everything at once" complexity overload that causes Rule 8 violations (depth clutter).

### Color Palette Encoding

The default "white jade + celadon green + gold accents" palette derives from Song Dynasty landscape painting color theory:

- **White jade** (primary): Symbolizes purity, provides high luminance contrast against clouds
- **Celadon green** (secondary): Roof tile color, creates cool-tone balance, references ancient ceramic glazes
- **Gold** (accent): Bracket clusters, lanterns, trim — provides warm highlights, signals divine/imperial status

To shift palette (e.g., toward darker "demonic sect" aesthetics), maintain the three-tone hierarchy:

- Primary: Dark wood or black stone
- Secondary: Deep crimson or midnight blue
- Accent: Silver or cold white light

Never use more than three core colors — additional hues break the composition's clarity (violates Rule 12 implicitly).

### Video Generation Adaptation

When using generated images as video seed frames (e.g., for Seedance or Runway), apply additional constraints:

- **Lock camera motion**: "Camera slowly orbits structure" or "static camera, clouds drift past" — never "camera flies through scene" (breaks spatial consistency)
- **Minimize small detail motion**: Lanterns, banners, water should have motion, but architectural details must remain frozen (prevents warping artifacts)
- **3-second minimum hold**: First and last frames of video should be static for 1 second each (allows clean loop points)

The 16-rule system translates directly to video keyframe generation — each frame must individually pass validation.