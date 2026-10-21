# Product Commercial Video

## Core Methodology

### Five-Act Narrative Structure

Commercial video storytelling follows a standardized temporal rhythm that aligns with cognitive engagement curves:

**Act 1 (0-3s): Hero Introduction** — Product enters frame with controlled motion (slow push-in, orbit, or reveal). Establish primary brand elements: color palette, logo lockup, hero benefit claim. Visual anchor = product-centric composition with signature lighting (rim light, gradient highlight sweep).

**Act 2 (3-6s): Action Demonstration** — Core product functionality in slow-motion detail (spray mechanism, texture close-up, interaction moment). Micro-dynamics amplify product quality: droplet trajectory, light refraction, tactile surface detail. Copy reinforces benefit sequence.

**Act 3 (6-10s): Contextual Validation** — Rapid scene transitions across 2-4 usage scenarios. Each scene = product application + environmental context + result state. Transitions use motion continuity (particle trail, wipe direction, light sweep) to maintain flow.

**Act 4 (10-13s): Emotional Benefit Layer** — Abstract visualization of product's invisible value (protection shield, freshness particles, safety glow). Microscopic or metaphorical POV. This is where functional benefit elevates to emotional reassurance.

**Act 5 (13-15s): Brand Closure** — Return to product hero shot OR pure brand card (white background + logo + tagline). All visual elements converge. Final brand mark emphasis (shield pulse, logo scale, color intensification).

### Brand Consistency Framework

Every frame must encode 5 brand DNA dimensions:

1. **Color System Lock** — Extract 3-5 core brand colors from reference packaging. These colors must dominate every scene: product itself, scene props, lighting temperature, text overlays. Example: Asevi = blue (trust) + cyan-green (freshness) + white (purity) + red (efficacy badge).

2. **Product Fidelity Rules** — Physical product attributes are immutable: bottle shape, cap design, label layout, ingredient callouts, certification badges. If reference image shows "99.9% shield logo", it must appear in every product close-up with pixel-level accuracy.

3. **Typographic Hierarchy** — On-screen copy uses 2-tier system: Primary benefit (large, center, bold sans-serif) + Secondary descriptor (small, subtitle position). Never use color blocks, stroke outlines, or drop shadows — text floats cleanly over controlled backgrounds.

4. **Scene Aesthetic Coherence** — All usage scenarios share lighting quality (soft directional + fill), surface materials (clean modern textures), and spatial simplicity (minimal props, negative space dominant). Scenarios must feel like same "brand universe".

5. **Motion Language** — Camera moves at 15-25% speed (slow push/pull only). No handheld shake, no whip pans, no zoom punches. Product interactions use 50-75% slow-motion. Transitions = soft dissolves or motion-matched cuts.

### Cinematic Micro-Detail Logic

High-end commercial quality lives in the details invisible to untrained eyes:

**Highlight Choreography** — Every reflective surface (bottle, countertop, liquid) must have controlled specular highlights that "travel" across the surface (top-to-bottom sweep in 1-2 seconds). This signals premium production value.

**Particle Dynamics** — Spray mist, water droplets, dust motes, freshness sparkles — these must obey physics (gravity, air resistance, light scattering) while remaining visually clean (not chaotic). Particle count = 20-50 visible elements max per frame.

**Surface Interaction Realism** — When cloth wipes surface, show: pressure deformation, moisture trail, light reflection shift, dirt "melt" effect (dark area fades to clean with soft edge). Never instant erase.

**Depth Staging** — Every shot uses 3 depth planes: foreground element (product/hand), mid-ground (action), background (environmental context, slightly defocused). Shallow depth of field (f/2.8-f/4 equivalent) keeps focus on product.

## Workflow

### 1. Preparation Stage

**Reference Asset Analysis**

- Upload product reference image
- Extract brand color palette (use eyedropper on packaging)
- Identify mandatory visual elements (logos, certification marks, label text zones)
- List physical product attributes: dimensions, material finishes, component colors
- Note any text that must remain legible (ingredient names, benefit claims)

**Scenario Selection**

- Choose 2-4 usage contexts matching product category (kitchen/bathroom/baby room for cleaning; living room/bedroom/car for electronics)
- Each scenario must demonstrate different product benefit OR user demographic
- Scenarios should share visual aesthetic (modern/minimal or rustic/warm — never mixed)

**Copy Strategy**

- Write 4-5 short copy phrases (3-6 words each) mapping to five-act structure
- Act 1: Hero benefit ("99.9% Germ Protection")
- Act 2: Action sequence ("Spray. Wipe. Protect.")
- Act 3: Scenario breadth ("For Every Family Surface")
- Act 4: Emotional payoff ("Clean Confidence, Every Day")
- Act 5: Brand name only ("\[Brand Name\]")

**Technical Specifications Lock**

- Duration: 15 seconds (strict)
- Aspect ratio: 16:9 (landscape) or 9:16 (vertical social)
- Resolution: 1080p minimum
- Frame rate: 24fps (cinematic) or 30fps (broadcast)
- Model selection: Use Minimax H3 or equivalent for commercial-grade video generation

### 2. Initial Generation Stage

**Unified Prompt Construction**

Structure prompt as: \[Product Identity\] + \[Visual System\] + \[Five-Act Breakdown\] + \[Cinematic Standards\] + \[Exclusion List\]

**Product Identity Block:**

```
Maintain [Product Name] consistency:
- [Component 1]: [color + material]
- [Component 2]: [color + material]
- [Mandatory visual elements]: [logo placement, certification badge, label zones]
- Packaging must remain legible and accurate throughout
```

**Visual System Block:**

```
Overall aesthetic: high-end [category] brand commercial
Environments: [scene 1], [scene 2], [scene 3] — all with [shared lighting quality]
Color palette: [color 1], [color 2], [color 3], [color 4]
Mood: [adjective 1], [adjective 2], [adjective 3]
```

**Five-Act Breakdown Block:**

```
15-second structure:
0-3s: [Act 1 description] + [camera move] + [lighting effect]. On-screen copy: [text].
3-6s: [Act 2 description] + [slow-motion detail] + [particle dynamics]. Copy: [text].
6-10s: [Act 3 description] + [scene transitions] + [result states]. Copy: [text].
10-13s: [Act 4 description] + [abstract benefit visual]. Copy: [text].
13-15s: [Act 5 description] + [brand closure]. Copy: [text].
```

**Cinematic Standards Block:**

```
Cinematography: commercial photography aesthetic, macro spray detail, slow-motion droplets, natural soft light, shallow depth of field, clean transitions, controlled highlights.
```

**Exclusion List Block:**

```
Avoid: split-screen, picture-in-picture, low-quality effects, cluttered backgrounds, subtitle bars, voiceover prompts, cartoon style, handheld shake, rapid cuts.
```

**Single-Pass Generation**

For 15-second commercial videos, generate as single unified output rather than stitching multiple clips. This ensures:

- Seamless transitions between acts
- Consistent lighting across entire duration
- Unified color grading
- Natural motion flow

If using multi-clip workflow, render 5 separate 3-second segments with strict anchor image continuity, then composite with frame-accurate transitions.

### 3. Iteration Stage

**Product Fidelity Audit**

Check frame-by-frame (0s, 3s, 6s, 10s, 13s keyframes):

- \[ \] Product shape/proportions match reference image
- \[ \] All mandatory visual elements present (logos, badges, labels)
- \[ \] Colors accurate to brand palette (no saturation drift)
- \[ \] Text legibility maintained in product close-ups
- \[ \] No hallucinated design elements (extra logos, wrong fonts)

**Motion Quality Checklist**

- \[ \] Camera movements stay within 15-25% speed range (no jarring motion)
- \[ \] Product interactions use appropriate slow-motion (spray = 50% speed)
- \[ \] Highlight sweeps complete within 1-2 seconds
- \[ \] Particle dynamics look physically plausible (not floating randomly)
- \[ \] Transitions between scenes feel motivated (not abrupt cuts)

**Copy Integration Check**

- \[ \] Each text phrase appears at correct timestamp
- \[ \] Text positioning = clean (center or lower-third, not overlapping product)
- \[ \] Text styling = minimalist (no color blocks, no heavy strokes)
- \[ \] Final frame = brand name only OR pure white brand card

**Scene Cohesion Verification**

- \[ \] All scenarios share same lighting quality (soft directional + fill)
- \[ \] Usage contexts feel like "same universe" (not random stock footage mix)
- \[ \] Color palette consistent across all scenes
- \[ \] Surface materials aligned with brand tier (premium brands = marble/glass, mass brands = laminate/tile)

**Regeneration Triggers**

Regenerate if:

- Product shape/color deviates noticeably from reference
- Mandatory visual elements missing or altered
- Motion feels rushed (camera too fast) or static (no dynamics)
- Copy timing misaligned with action beats
- Scene aesthetic clashes (e.g., rustic kitchen → futuristic bathroom)
- Final brand closure lacks impact (weak logo presence)

For minor fixes (copy positioning, color grading, single scene replacement), use video editing tools. For structural issues (wrong motion rhythm, product inconsistency), regenerate from prompt.

## Key Constraints & Standards

### Product Representation Rules

**Immutable Product Attributes:**

- Physical dimensions and proportions must match reference image within 5% tolerance
- Component colors must use exact brand palette (no hue/saturation drift)
- Logo lockup, certification badges, ingredient callouts must appear in their reference positions
- Label text zones must remain legible in close-ups (no blur, no occlusion)
- Product material finishes must match reference (matte vs glossy, transparent vs opaque)

**Packaging Integrity:**

- If reference shows a shield badge with "99.9%" text, it must appear in every product close-up
- Label hierarchy must be preserved (brand name largest → product variant → ingredient/cert text smallest)
- No invented design elements (extra logos, fake certification marks, altered color schemes)

### Temporal Structure Standards

**Five-Act Rhythm Enforcement:**

- Act 1 (0-3s): Must establish product + hero benefit
- Act 2 (3-6s): Must show action/interaction in slow-motion detail
- Act 3 (6-10s): Must include 2-4 scenario transitions
- Act 4 (10-13s): Must deliver emotional/abstract benefit layer
- Act 5 (13-15s): Must return to product hero OR brand card

Any deviation from this structure breaks commercial narrative convention.

**Copy Timing Precision:**

- Each copy phrase must appear within ±0.5 seconds of its designated timestamp
- Copy should fade in over 0.3-0.5s, hold for 1.5-2s, fade out over 0.3-0.5s
- Final brand name must hold until video end (no premature fade)

### Cinematic Quality Thresholds

**Camera Motion Limits:**

- Maximum camera speed: 25% of normal walking pace (slow push/pull only)
- No handheld shake, no whip pans, no zoom punches, no Dutch angles
- Orbit moves must complete 15-30° arc maximum (not full 360°)

**Lighting Standards:**

- Primary light source: soft directional (simulated window light or softbox)
- Fill ratio: 2:1 to 3:1 (gentle shadows, no harsh contrast)
- Backlight/rim light on product edges to separate from background
- No visible light sources in frame (lamps, windows) unless part of scene context

**Depth of Field Rules:**

- Product shots: f/2.8-f/4 equivalent (background soft but recognizable)
- Scene shots: f/4-f/5.6 equivalent (environment readable but not competing with product)
- Never use f/1.4-equivalent (background too blurred, looks amateurish)
- Never use f/8+ (everything sharp, no depth, looks flat)

**Particle Dynamics Limits:**

- Maximum 20-50 visible particles per frame (spray droplets, dust motes, sparkles)
- Particles must obey gravity and air resistance (no floating randomly)
- Particle lifespan: 0.5-1.5 seconds (not lingering indefinitely)
- Particle size variation: 50-150% of median (not uniform)

### Copy & Typography Constraints

**Text Styling Prohibitions:**

- No colored background blocks behind text
- No heavy stroke outlines (max 1px subtle outline if needed)
- No drop shadows (breaks premium aesthetic)
- No animated text effects beyond fade in/out (no fly-in, no typewriter)

**Typographic Hierarchy:**

- Primary benefit text: 48-72pt equivalent, bold sans-serif, center-aligned
- Secondary text: 24-36pt equivalent, regular sans-serif, subtitle position
- Brand name: 60-90pt equivalent, brand font if custom, center-aligned

**Copy Placement Zones:**

- Primary text: lower-third center (never overlapping product silhouette)
- Secondary text: directly below primary OR upper-third if scene requires
- Final brand card: exact center (both horizontal and vertical)

### Exclusion List (Never Include)

- Split-screen or picture-in-picture layouts (breaks immersive narrative)
- Low-quality stock effect overlays (lens flares, light leaks, film grain)
- Cluttered backgrounds with competing visual elements
- Subtitle bars or closed-caption styling
- Voiceover waveform visualizations
- Cartoon or illustrative style (unless brand identity requires it)
- Handheld camera shake or documentary-style motion
- Rapid cuts (&lt;1 second per shot in main acts)
- Visible crew/equipment reflections
- Temporal inconsistencies (lighting direction changes mid-scene)

### Scene Aesthetic Coherence

**Environment Selection Logic:**

- All scenarios must share same design era (modern/minimal OR rustic/traditional — never mixed)
- Surface materials must align with brand tier:
  - Premium brands: marble, granite, glass, brushed metal
  - Mass brands: laminate, ceramic tile, stainless steel, painted wood
- Props must be minimal and color-coordinated (no random objects)

**Lighting Consistency Across Scenes:**

- All scenes share same time-of-day feel (morning soft light OR afternoon warm light)
- Color temperature must remain constant (5500K neutral OR 3200K warm)
- Shadow direction must be consistent (light always from same relative angle)

## Recommended Tools & Models

Use **Minimax H3 (Seedance 2.0)** for video generation. This model excels at:

- Controlled camera motion with slow-motion capabilities
- Product consistency across frames
- Realistic material rendering (glass, liquid, reflective surfaces)
- Clean particle dynamics
- Commercial-grade lighting simulation

For multi-clip workflows requiring compositing, use standard video editing tools with frame-accurate timeline control.

## Advanced Techniques

### Anchor Image Strategy for Multi-Clip Workflows

When generating 5 separate 3-second clips:

1. **Generate Product Hero Anchor** — Create single image of product in neutral lighting, front-facing, all labels visible. Use this as reference anchor for clips 1, 2, and 5.

2. **Generate Scene Anchors** — Create 2-4 images of usage scenarios (kitchen, bathroom, etc.) with product placed naturally. Use these as reference anchors for clip 3.

3. **Generate Abstract Benefit Anchor** — Create single image showing metaphorical product benefit (shield glow, freshness particles, protection aura). Use as reference for clip 4.

4. **Strict Anchor Adherence** — Each video clip prompt must explicitly reference its anchor image and demand pixel-level consistency for product appearance.

### Copy Animation Micro-Timing

For maximum professional feel:

- Copy fade-in starts 0.2s after shot begins (not instant)
- Copy holds on screen for exactly 1.8-2.2s (human reading comfort zone)
- Copy fade-out completes 0.3s before next shot begins (clean transition)
- If copy must appear over motion, delay fade-in until motion settles (0.5s into shot)

### Transition Motion Matching

When cutting between scenes:

- Match motion direction across cut (if camera pushes left in scene A, start scene B with leftward motion)
- Use particle trails or light sweeps to "carry" viewer's eye across transition
- Maintain consistent screen position for product (if bottle exits right, next shot starts with bottle entering right)

### Color Grading Micro-Adjustments

If generated output's colors drift from brand palette:

- Preserve product color accuracy as absolute priority
- Allow scene colors to shift slightly warmer/cooler to match product
- Never grade product to match scene (product dictates color, not environment)
- Maintain consistent saturation across all scenes (no vibrant scene → muted scene jumps)