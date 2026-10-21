# Product Video Reference Analysis

## Core Methodology

### 1. Three-Layer Video Decomposition Framework

Analyze reference videos through three independent dimensions:

**Layer 1: Visual Style Parameters**

- Color grading (dominant hue, saturation level, temperature bias)
- Lighting setup (light direction, hardness/softness, key/fill ratio)
- Depth of field (shallow DOF for product isolation vs deep DOF for context)
- Atmospheric effects (smoke, dust particles, lens flare, bokeh)
- Aspect ratio and framing philosophy (9:16 vertical for mobile, cinematic crop)

**Layer 2: Camera Movement Logic**

- Movement type classification: push-in (focus reveal), pull-out (context reveal), orbit (360° showcase), static hold (stability/luxury)
- Speed parameters: slow crawl (0.5x-1x speed for luxury), medium pan (1x-2x for dynamic), fast whip (2x+ for energy)
- Transition structure: how movements connect between shots (hard cut, speed ramp, dissolve)
- Focal shift choreography: when focus changes (rack focus timing, depth transition)

**Layer 3: Narrative Arc Structure**

- Shot sequencing logic: Establish → Detail → Hero → Context → Resolution
- Duration allocation: opening hook (20-25%), product showcase (40-50%), atmospheric detail (15-20%), closing frame (10-15%)
- Visual hierarchy: which product features get screen time priority
- Pacing rhythm: beat timing between movement changes

### 2. Prompt Abstraction Hierarchy

Convert specific visual observations into three abstraction levels:

**Level 1: Shot-Specific Descriptors** (for single-shot generation)

- Concrete elements: "Deep brown pump bottle with 'DR CALMING ARGAN OIL' text"
- Exact camera action: "Camera slowly pushes forward 15cm while rack focusing from f/1.4 blurred foreground to f/2.8 sharp product"
- Precise prop placement: "Rattan woven mat 30cm beneath bottle, beige knit fabric folded to left side"

**Level 2: Scene Framework Templates** (for product category reuse)

- Abstracted structure: "\[Product container\] positioned on \[natural texture surface\], \[warm directional light\] from \[angle\], \[soft atmospheric element\] in frame"
- Movement pattern: "Starts \[depth state\] → transitions to \[depth state\] via \[camera verb\] at \[speed\]"
- Material palette: "\[Wood/stone/fabric texture\] + \[flower/foliage accent\] + \[warm/cool light quality\]"

**Level 3: Universal Style Rules** (for brand consistency)

- Mood keywords: "High-end, slow-paced, warm-toned, shallow DOF, natural props, no human presence"
- Forbidden elements: "No visible stitching, no hard shadows, no cold lighting, no fast cuts"
- Quality thresholds: "All shots maintain f/1.4-f/2.8 aperture range; all movements under 5cm/sec"

### 3. Multi-Shot Consistency Discipline

When generating video sequences (4+ shots), enforce strict dimensional locks:

**Immutable Dimensions** (never change across shots):

- Product container geometry and branding position
- Overall color temperature (measured in Kelvin reference)
- Light source angle (must stay within 15° cone)
- Prop material family (if using wood, all wood must be same tone)

**Controlled Variation Dimensions** (change within bounds):

- Camera angle: systematic coverage (front → 3/4 → side → overhead)
- Focus depth: alternate between f/1.4 (isolation) and f/2.8 (context)
- Composition scale: wide → medium → close-up → extreme close-up
- Atmospheric density: start clean → build smoke/particles → dissipate

**Transition Continuity Rules**:

- Shot duration consistency: all shots within ±1 second of target length
- Movement speed matching: if shot 1 is 0.5x speed, shot 2 must be 0.4x-0.6x
- Visual motif threading: if shot 1 ends on texture detail, shot 2 starts with related texture

## Workflow

### 1. Reference Analysis Stage

**Input Requirements:**

- Reference video file (minimum 10 seconds for pattern recognition)
- Product image (high-resolution, clean background preferred)
- Target output duration (10-20 seconds for single-take; 15-30 seconds for multi-shot)

**Analysis Checklist:**

1. **Timing Breakdown**: Mark every camera movement change with timestamp
2. **Color Sampling**: Extract 3-5 dominant hex codes from key frames
3. **Light Direction Mapping**: Sketch light source positions relative to product
4. **Prop Inventory**: List all visible materials and their spatial relationship to product
5. **Movement Classification**: Tag each shot segment with movement type + speed + focal shift

**Output Format**: Create structured prompt document with:

- Overall style summary (50-100 words)
- Per-shot detailed prompts (150-250 words each)
- Universal constraint list (10-15 rules)
- Keyword matrix table (organized by: Color / Light / Movement / Atmosphere / Props)

### 2. Prompt Engineering Stage

**Single-Shot Generation Approach:**

- Use Level 1 (Shot-Specific) prompts when generating one continuous 15-20 second video
- Embed entire narrative arc into single prompt: "Opens with \[state A\], transitions through \[state B\], \[state C\], culminates in \[state D\]"
- Specify exact timing: "First 0-5 seconds: \[action\]; 5-10 seconds: \[action\]; 10-15 seconds: \[action\]"
- Include explicit continuity instructions: "Camera never cuts; all movements are smooth speed transitions"

**Multi-Shot Sequence Approach:**

- Use Level 2 (Framework) prompts for 4-6 individual shots, then composite
- Each shot prompt follows template: "\[Shot type\] of \[product framework\] where \[camera action\] reveals \[visual payoff\], maintaining \[style consistency keywords\]"
- Shot duration formula: Total duration ÷ Number of shots = Base duration; then adjust ±20% for narrative pacing
- Bridge shots with transitional elements: End shot 1 with element X, begin shot 2 with element X in different context

**Product Substitution Protocol:**

- Replace all product-specific nouns with bracketed placeholders: \[product container\], \[brand text\], \[container color\]
- Preserve all spatial relationships: "\[product\] positioned \[location\] relative to \[prop\]"
- Maintain material consistency: If reference uses "warm wood," substitute product should use "\[warm natural texture surface\]"
- Keep lighting geometry identical: "\[warm directional light\] from \[specific angle in degrees\]"

### 3. Generation & Refinement Stage

**Initial Generation Strategy:**

- For single-shot: Generate once with complete prompt, assess if narrative arc is fully realized
- For multi-shot: Generate all shots in parallel to detect consistency breaks early
- Always generate at target duration (don't generate long and trim; timing affects motion quality)

**Quality Verification Checklist:**

*Visual Consistency Audit:*

- \[ \] Product container maintains same lighting direction across all shots
- \[ \] Color temperature variance under 200K across shots
- \[ \] No props appear/disappear between shots without motivation
- \[ \] Depth of field remains within f/1.4-f/2.8 range (or specified range)

*Motion Quality Audit:*

- \[ \] All camera movements complete their intended action (no truncated push-ins)
- \[ \] Speed feels consistent with reference (use side-by-side playback test)
- \[ \] No unintended camera shake or jitter in "static" shots
- \[ \] Focus transitions are smooth (no sudden snap-focus)

*Narrative Flow Audit:*

- \[ \] Opening shot establishes product identity within 2 seconds
- \[ \] Middle shots explore product details without redundancy
- \[ \] Closing shot provides satisfying visual resolution
- \[ \] Total duration matches target ±1 second

**Iteration Decision Rules:**

*When to regenerate entire shot:*

- Product appears in wrong position (spatial layout failed)
- Camera movement type is incorrect (push-in became orbit)
- Lighting direction contradicts other shots
- Duration is off by &gt;3 seconds

*When to regenerate sequence:*

- Color grading inconsistency across 3+ shots
- Props change identity between shots (wood becomes metal)
- Overall pacing feels rushed/dragged when played in sequence

*When to accept and composite:*

- Minor prop position variations (within 10cm tolerance)
- Slight color temperature drift (under 200K)
- Duration variance under 2 seconds (can be trimmed)

**BGM Integration:**

- Generate BGM length = video length + 2 seconds (fade buffer)
- Style matching: "Warm" video → "Soft piano and strings"; "Energetic" video → "Upbeat acoustic guitar"
- Volume mixing: BGM at 60-70% volume relative to video (allows product focus)
- Sync test: Play composite and verify no BGM transients clash with visual transitions

## Key Constraints & Standards

### Immutable Rules (Never Violate)

1. **Product Identity Consistency**: If reference shows a pump bottle, generated video must show pump bottle in same orientation across all shots. Container shape, cap type, label position cannot change.

2. **Light Direction Lock**: Establish primary light source angle in shot 1 (e.g., 45° top-right warm light). All subsequent shots must maintain this angle within ±15° tolerance.

3. **No Mid-Shot Hard Cuts**: In single-take videos (one continuous prompt), never specify "then cut to" or "transition to new angle." All changes must be camera movements (push/pull/orbit).

4. **Aspect Ratio Consistency**: Reference video's aspect ratio dictates output. 9:16 vertical → all shots must be 9:16. Never mix aspect ratios in a sequence.

### Fidelity Rules (Match Reference Quality)

5. **Depth of Field Matching**: If reference uses shallow DOF (blurred background), measure approximate f-stop range (typically f/1.4-f/2.8 for product videos). Generated shots must stay within this range — no sudden deep focus shots.

6. **Movement Speed Calibration**: Reference video's slowest movement sets baseline. If slowest push-in takes 5 seconds to travel 10cm, maintain this 2cm/sec speed in generated videos. Use "slow," "very slow," or "glacial" descriptors.

7. **Color Temperature Precision**: Sample reference video's warmest and coolest frames. Generated video's color range must stay within this boundary. If reference is 3000K-3500K, avoid 4000K+ cool tones.

8. **Atmospheric Density Control**: If reference uses smoke/particles, specify density level: "Light wisps of smoke" (low), "Moderate haze" (medium), "Dense atmospheric smoke" (high). Match reference's peak density.

### Consistency Rules (Multi-Shot Sequences)

 9. **Prop Material Continuity**: If shot 1 uses "rough weathered wood," shot 2 cannot use "smooth polished wood." Material family (wood/stone/fabric) and finish (rough/smooth, matte/glossy) must match.

10. **Duration Balance**: In 4-shot sequences, no single shot should be &lt;15% or &gt;40% of total duration unless reference shows extreme imbalance. Standard distribution: 25% / 25% / 25% / 25% or 20% / 30% / 30% / 20%.

11. **Focal Point Progression**: Shot sequence must follow logical focal hierarchy. Typical pattern: Wide (context) → Medium (product) → Close-up (detail) → Extreme close-up (texture) → Pull-out (resolution). Never jump from extreme close-up directly to wide without intermediate shot.

12. **Transition Element Threading**: Last frame of shot N should contain visual element that appears in first frame of shot N+1. Example: Shot 1 ends on product bottle cap → Shot 2 starts with bottle cap in frame, then camera moves to show full product.

### Prompt Engineering Standards

13. **Temporal Specificity Requirement**: When generating single-take videos, always divide duration into time blocks with explicit actions: "0-3 seconds: \[action A\]; 3-7 seconds: \[action B\]; 7-12 seconds: \[action C\]; 12-15 seconds: \[action D\]."

14. **No Generic Quality Descriptors**: Never use "high quality," "professional," "cinematic" without specific technical terms. Replace with: "Shallow depth of field f/1.8, anamorphic bokeh, color graded to 3200K warm tone, shot on 50mm lens."

15. **Negative Space Specification**: If reference shows product occupying left 40% of frame with right 60% negative space, specify: "Product positioned in left third of frame, right two-thirds show blurred \[background element\]."

### Abstraction Guidelines (Template Creation)

16. **Product-Agnostic Placeholder Syntax**: When creating reusable prompts, use bracketed placeholders: \[product container type\], \[brand text\], \[container color\], \[primary material\], \[accent prop\]. Never hardcode specific product details.

17. **Material Category Vocabulary**: Group props into swappable categories:

- Natural wood family: \[weathered driftwood / smooth bamboo / rough bark\]
- Stone family: \[marble slab / river rock / concrete\]
- Fabric family: \[linen / cotton knit / silk\]
- Botanical family: \[dried flowers / fresh greenery / seed pods\]

18. **Lighting Angle Standardization**: Define light positions in clock notation: "3 o'clock warm key light" (right side), "10 o'clock soft fill" (left-front), "6 o'clock rim light" (bottom backlight). This allows precise replication across products.

## Recommended Tools & Models

Use **Minimax H3** for high-fidelity product video generation with precise camera control and shallow depth of field rendering.

## Example

### Reference Video: Luxury Skincare 20s Commercial

**Analysis Output:**

- Style: Warm-toned (3200K), shallow DOF (f/1.8), natural wood props, slow-motion movements
- Structure: 4 shots — (1) Defocus-to-focus reveal 5s, (2) Close-up pull-out 5s, (3) Texture detail 5s, (4) Static wide hold 5s
- Key constraint: Light always from 45° top-right; all shots under 3cm/sec movement speed

**Generated Prompt (Shot 1):**

```
Deep brown pump bottle with brand text initially out of focus in warm blurred foreground,
camera slowly pushes forward while rack focusing from f/1.4 to f/1.8, bottle text gradually
becomes sharp and legible, warm 3200K sidelight from 45° top-right creates soft highlight
on bottle curve, background is defocused beige gradient, shot duration 5 seconds, movement
speed 2cm/sec, 9:16 vertical frame, no cuts.
```

**Template Abstraction:**

```
[Product container] with [brand text] initially out of focus in [warm/cool] blurred foreground,
camera slowly pushes forward while rack focusing from f/1.4 to f/1.8, [brand text] gradually
becomes sharp and legible, [warm/cool] [color temperature]K sidelight from [angle] creates
soft highlight on [product feature], background is defocused [color] gradient, shot duration
[N] seconds, movement speed [X]cm/sec, 9:16 vertical frame, no cuts.
```