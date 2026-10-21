# Luxury Product Advertisement Video Production

## Core Methodology

### Temporal Narrative Architecture

Luxury product videos follow a 4-act emotional crescendo structure compressed into 15 seconds:

- **Act 1 (0-3s): Atmospheric Establishment** — Defocused ambient opening that establishes color palette and emotional tone before revealing the product. The viewer enters a "dream space" rather than a commercial.
- **Act 2 (3-7s): Product Hero Moment** — Isolated product showcase with extreme attention to material texture (metal engravings, velvet finish, liquid gloss). Product reveals itself through slow mechanical motion (rotation, opening, emerging).
- **Act 3 (7-12s): Human Connection** — Model interaction that transfers product qualities to human emotion. The model becomes the "living demonstration" of the product's promise (elegance, confidence, desire).
- **Act 4 (12-15s): Brand Crystallization** — All elements (product + model + environment) freeze into a composed tableau. Brand identity materializes as typographic overlay. The commercial becomes a poster.

### Cinematic Continuity System

The differentiator between amateur and luxury-grade product videos is **unbroken visual flow**:

- **No Hard Cuts Rule** — Every transition must use spatial continuity (camera drift, focus pull, element wipe) or temporal dissolve. The 15 seconds feel like one breath.
- **Transition Bridge Technique** — When shifting between product and model, use shared visual elements as bridges:
  - **Color Echo**: Product's metal finish matches model's jewelry
  - **Shape Rhyme**: Product's curves pre-echo model's facial contours
  - **Motion Handoff**: Product rotation speed = model's head turn speed
  - **Element Wipe**: Falling petals/fabric naturally obscure one subject while revealing another

### Texture Fidelity Framework

Luxury brands live or die by material authenticity. Every surface must encode its physical properties:

- **Metal**: Brushed directionality, anisotropic reflections, micro-engraving depth
- **Matte Velvet**: Light absorption with slight nap texture, zero specular highlights
- **Glossy Liquid**: Subsurface scattering, curved light catchments, meniscus edge
- **Skin**: Pore-level detail at close-ups, natural oil sheen (not artificial wetness), blood circulation glow

When a model applies lipstick, the texture transition (waxy solid → creamy film → settled matte) must be frame-accurate.

## Workflow

### 1. Preparation Stage

**Asset Inventory**:

- Product reference image (必选): Capture all physical details — material finish, brand markings, color accuracy under neutral lighting
- Model reference image (可选): Face, skin tone, body proportions. If absent, define target demographic aesthetic (e.g., "elegant Asian woman, early 20s, porcelain skin, reserved expression")
- Brand assets (可选): Logo vector, tagline, approved color palette, typography rules

**Scene Design Decisions**:

- **Color Palette Extraction**: Derive 3-4 core colors from product (e.g., rose gold packaging → rose gold #D4A0A0, velvet red #8B3A3A, champagne #E8D5B7). All lighting, props, and backgrounds must exist within this palette.
- **Thematic Element Selection**: Choose symbolic props that reinforce campaign theme (e.g., Qixi → rose petals + silk ribbons; Christmas → evergreen + snow; minimalist → geometric crystals).
- **Texture Hierarchy**: Define which textures dominate each act (Act 1: fabric, Act 2: metal+glass, Act 3: skin, Act 4: typography).

**Technical Parameters Checklist**:

- Aspect ratio: 9:16 vertical (social media standard)
- Duration: Exactly 15 seconds (platform algorithm optimization)
- Camera motion: Continuous slow drift (no handheld shake, no fast whips)
- Lighting: Soft key light at 45° (no harsh shadows), rim light for edge separation

### 2. Initial Design Stage

**Prompt Framework Structure**:

```
[Format + Duration] + [Color Palette] + [Atmospheric Opening] +
[Act 1: 0-3s Scene] + [Act 2: 3-7s Product] + [Act 3: 7-12s Model] + [Act 4: 12-15s Brand] +
[Transition Instructions] + [Texture Specifications] + [Negative Constraints]
```

**Act-by-Act Execution**:

**Act 1 Prompt Block**:

```
"0-3s: Video opens with soft-focus [palette color] glow. [Thematic elements] drift slowly into frame from top. Camera pulls focus gradually, revealing [product] on [surface material]. [Product] reflects [light quality]."
```

**Act 2 Prompt Block**:

```
"3-7s: Camera pushes slowly toward [product]. Details emerge: [material finish], [brand engraving], [design feature]. [Product action: twist/open/rotate]. [Texture type] becomes visible as [lighting interaction]."
```

**Act 3 Prompt Block**:

```
"7-12s: Camera drifts to model's face. [Model description]. She [action: gazes off-screen/turns toward camera]. Her [feature: lips/eyes/hands] display [product effect]. Focus tightens to [body part] close-up. [Thematic element] drifts past, briefly veiling then revealing [detail]."
```

**Act 4 Prompt Block**:

```
"12-15s: Camera pulls back to wide shot. Model and product coexist in frame. [Product] [spatial relationship: floats near/rests beside] model. Model [gesture: touches lips/extends hand]. Brand name '[NAME]' appears center frame in [font style] as [animation: fade/emboss]. [Elements] freeze mid-motion. Light intensifies, frame fades to [palette color]."
```

**Transition Directives**:

- Between Act 1→2: "Focus pull from soft to sharp"
- Between Act 2→3: "Model's \[feature\] drifts into frame edge as product recedes, then camera pivots to follow model"
- Between Act 3→4: "Camera drift outward while maintaining focus lock"

**Critical Texture Callouts**:

- Lipstick: "\[matte velvet/glossy sheen/satin pearl\] with \[light behavior\]"
- Skin: "Natural pore texture, subtle oil sheen on T-zone, no artificial glow"
- Fabric: "Silk with directional light catchment, micro-wrinkles visible"

### 3. Iteration Stage

**Transition Quality Audit**:

- **Spatial Continuity Check**: Pause at each act boundary. Does the viewer's eye have a clear path from Subject A to Subject B? If the model "teleports" into frame, the transition failed.
- **Motion Consistency**: Measure camera drift speed. It should be constant (e.g., 5% frame width per second) across all acts. Sudden speed changes break immersion.
- **Focus Pull Smoothness**: When shifting focus from product to model, the defocused subject should remain recognizable (not a blur blob).

**If Transition Feels "Hard"**:

1. Add a bridge element that appears in both acts (e.g., rose petal falls past product in Act 2, same petal lands near model's face in Act 3)
2. Extend overlap duration — model's silhouette should appear in Act 2's final 0.5s as a foreground defocused shape
3. Use color-matched dissolve: product's highlight color bleeds into model's background lighting

**Texture Fidelity Check**:

- **Product Close-Up (Act 2)**: Zoom to 200% and verify:
  - Brand text is sharp (not AI-hallucinated gibberish)
  - Material finish matches reference image (matte vs glossy)
  - Geometric precision (straight edges stay straight)
- **Model Makeup (Act 3)**: Verify:
  - Lipstick color matches product exactly (compare RGB values)
  - Application looks physically plausible (even edge, no bleeding)
  - Texture type matches product (velvet lipstick = matte lip finish)

**Model Consistency Verification**:

- If user provided model reference, compare face structure, skin tone, eye shape frame-by-frame
- Expression range: Luxury aesthetic requires restraint — smile should be "Mona Lisa subtle" not "toothpaste commercial wide"
- No sudden movements: Head turns must take ≥2 seconds, no quick glances

**Brand Integration Check**:

- Typography appears in final 3 seconds (not earlier — don't interrupt the narrative)
- Font style matches brand guidelines (serif for heritage luxury, sans-serif for modern minimalism)
- Text placement: Never obscures product or model's face, typically center or lower-third
- Animation: Text should "materialize" (fade-in, emboss effect) not "arrive" (slide-in, bounce)

**When to Regenerate vs. Composite Fix**:

- **Regenerate if**: Transition structure is fundamentally broken (hard cuts), texture is wrong (glossy instead of matte), model's face changed
- **Composite fix if**: Only one act has issues (replace that 3-5s segment and re-composite), text timing is off (re-edit), minor color grading needed

## Key Constraints & Standards

### Immutable Technical Rules

- **Duration Lock**: Exactly 15 seconds (not 14.7s, not 15.3s). Social media algorithms penalize duration variance.
- **Aspect Ratio Lock**: 9:16 vertical. No black bars, no pillarboxing.
- **Continuous Motion**: Camera must always be in gentle motion (static shots feel cheap). Minimum drift speed: 3% frame width per second.
- **No Jump Cuts**: Every act transition must use spatial continuity or temporal dissolve.

### Color & Lighting Standards

- **Palette Constraint**: All colors must derive from product's physical appearance. No arbitrary "pretty colors" — if the lipstick is rose gold, the scene is rose gold + analogous hues.
- **Lighting Quality**: "Soft key at 45°, rim light for separation" — this creates the signature "luxury glow" (ambient but sculpted).
- **Shadow Rule**: Shadows exist but are never "crushed black" (details must remain visible in darkest areas).
- **Highlight Rule**: Specular highlights are small and controlled (not blown-out white blobs).

### Texture Fidelity Rules

- **Product Material Accuracy**: If reference image shows "brushed metal", output must show parallel micro-scratches with anisotropic reflections.
- **Lip Texture Matching**: Lipstick product texture (matte/glossy/velvet/pearl) must match model's lip finish in Act 3 exactly.
- **Skin Realism**: Visible pores at close-up range (7-12s), natural oil sheen (not sweat), blood circulation warmth (not artificial pink).
- **Fabric Behavior**: Silk must show directional light catchment and micro-wrinkles; satin must show soft sheen without specular highlights.

### Model Consistency & Expression Standards

- **Identity Lock**: If user provides model reference, facial structure (bone structure, eye shape, nose bridge, lip contour) must remain pixel-consistent.
- **Expression Restraint**: Luxury aesthetic = subtle emotion. Smile intensity max 30% (corners lift slightly, teeth barely visible or hidden).
- **Motion Speed**: All human motion is slow — head turns ≥2s, hand gestures ≥1.5s, eye blinks at natural 0.3s.
- **Gaze Direction**: Model looks "past" the camera (creates aspiration) or "into" camera with soft focus (creates intimacy). Never looks "around" frantically.

### Brand & Typography Standards

- **Timing Rule**: Brand text appears only in final 3 seconds (12-15s). Earlier appearance interrupts emotional buildup.
- **Font Selection**: Serif fonts for heritage/elegance (Didot, Bodoni), sans-serif for modern/minimalism (Futura, Helvetica Neue).
- **Animation Style**: Text materializes (fade-in with slight scale, emboss effect) — never slides, bounces, or spins (these feel "promotional" not "luxury").
- **Placement Rule**: Center frame or lower-third. Never top-third (blocks model's face in wide shots). Never overlays product or model's key features.

### Thematic Element Rules

- **Quantity Limit**: 2-3 symbolic props maximum (e.g., rose petals + silk ribbon + crystal). More = cluttered.
- **Motion Constraint**: All props move slowly (falling petals drift at ≤10% frame height per second).
- **Size Discipline**: Props never occupy &gt;15% of frame area. They accent, not dominate.
- **Continuity Requirement**: If a petal falls in Act 1, the same petal (or visually identical one) should be visible in Act 4's final tableau.

## Recommended Tools & Models

### Video Generation

- **MiniMax-Hailuo-H3**: Primary model for luxury product video generation. Strengths include:
  - Superior texture rendering (metal, fabric, skin) compared to other text-to-video models
  - Stable camera motion (consistent drift speed, smooth focus pulls)
  - Better understanding of lighting direction and material interaction
  - Reliable brand text rendering (less AI hallucination in typography)

### When to Use Composite Workflow vs. Single-Shot Generation

**Single-Shot Generation (Recommended for First Pass)**:

- Use one 15-second prompt with all 4 acts described sequentially
- Advantages: Natural transitions, consistent color grading, unified motion rhythm
- Disadvantages: If one act fails, must regenerate entire video
- Best for: When product and model are both clearly defined, and you have high confidence in prompt accuracy

**Multi-Shot Composite Workflow (Use for Iteration)**:

- Generate each act separately (S1: 3.5s, S2: 4s, S3: 4.5s, S4: 3s), then composite
- Advantages: Granular control (replace only failed segments), higher per-act quality
- Disadvantages: Transitions require manual bridge generation (extract end frame of S2 + start frame of S3 → generate 1s transition)
- Best for: When single-shot output has one weak act, or when you need pixel-perfect product accuracy in Act 2

### Transition Repair Technique

If generated video has jarring transition between Act 2 (product) → Act 3 (model):

1. Extract final frame of Act 2 as image anchor
2. Extract first frame of Act 3 as image anchor
3. Generate 1-2s "bridge video" using both anchors with prompt: "Camera drifts smoothly from \[product description\] to \[model description\], maintaining \[color palette\], \[thematic element: petal/fabric\] passes through frame as natural wipe"
4. Composite: \[Act 2 minus last 0.5s\] + \[bridge 1-2s\] + \[Act 3 from 0.5s onward\]

## Example

### Input

- **Product**: Naralis luxury lipstick (black matte casing, gold band, rose-red velvet finish)
- **Model**: Not provided (use default elegant Asian woman, early 20s)
- **Campaign Theme**: Qixi Festival (Chinese Valentine's Day)
- **Brand Assets**: "Naralis" + "七夕限定" tagline

### Generated MiniMax H3 Prompt

```
9:16 vertical, 15-second seamless luxury lipstick advertisement for Qixi Festival. One continuous slow camera movement, no cuts. Color palette: rose gold (#D4A0A0), velvet red (#8B3A3A), champagne gold (#E8D5B7), soft blush pink (#F5E6E8). Romantic, intimate, high-end atmosphere with soft film grain and slight diffusion filter.

0-3s: Opens with soft-focus rose-gold glow. Deep red and blush pink rose petals drift slowly downward from top of frame. Camera gradually pulls focus, revealing champagne satin-draped surface. Naralis lipstick stands elegantly on crystal pedestal at center, black matte casing reflecting warm soft light.

3-7s: Camera pushes gently toward lipstick. Casing details emerge: brushed matte black finish, gold band with subtle engraving, squared silhouette. Lipstick slowly auto-twists upward, revealing perfectly shaped rose-red velvet bullet. Soft side light glides across lipstick surface, highlighting its velvety matte texture with zero gloss.

7-12s: As product recedes into soft focus, model's lips drift into frame edge as visual bridge. Camera pivots smoothly to model's face—elegant Asian woman, porcelain skin, dark hair, soft reserved expression. She gazes gently off-screen with subtle content smile, then slowly turns toward camera. Her lip makeup is flawless rose-red velvet, exact match to lipstick. Camera pushes to lip close-up. Single rose petal drifts diagonally across frame, briefly veiling then revealing her lips in soft light.

12-15s: Camera drifts back to wider shot. Model and lipstick product coexist in frame—product floats gently near her extended hand above bed of rose petals and silk. Model lifts fingertips to lightly touch corner of lips, eyes meeting camera with warm gentle gaze. Brand text "Naralis / 七夕限定" appears center frame in elegant gold foil serif font (subtle emboss effect, fade-in over 0.8s). Drifting rose petals freeze mid-air. Entire scene holds as perfect still life. Soft light intensifies slightly, frame fades to warm blush tone.

Throughout: No harsh shadows, no rapid movements, no cuts. Lipstick color and velvet matte texture remain accurate. Model features consistent and natural. Skin shows natural pore texture at close-up with subtle T-zone sheen. Camera drift speed constant at ~4% frame width per second.
```

### Iteration Note

First generation showed hard transition from product to model (model "teleported" into frame). Regenerated with added transition bridge instruction: "As product recedes into soft focus, model's lips drift into frame edge as visual bridge. Camera pivots smoothly..." This created smooth handoff using shared visual element (lips in both shots).