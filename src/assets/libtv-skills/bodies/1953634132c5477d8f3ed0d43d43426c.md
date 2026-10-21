# Product Commercial Video Orchestration

## Core Methodology

### Sequential Confirmation Architecture

Never jump directly to execution. Break the process into mandatory confirmation gates:

**Gate 1 — Product Identity Layer**

- Product category and hero SKU selection (if multi-variant)
- Packaging structure analysis (form factor, materials, visual hierarchy)
- Brand signature elements extraction (logo placement, color system, typography)
- Product reference image anchoring (becomes immutable reference across all outputs)

**Gate 2 — Narrative Parameters**

- Video duration target (30s/60s/90s)
- Aspect ratio selection (16:9 horizontal for platforms like Bilibili/YouTube, 9:16 vertical for TikTok/Reels)
- Visual style direction (e.g., cyberpunk dark-tone × extreme color contrast × strobe cutting)
- Tone calibration (pure visual narrative vs. narration-supported)

**Gate 3 — Structural Blueprint**

- Chapter breakdown (typically 3-4 acts for 60s)
- Shot count per chapter (balance visual density vs. breathing room)
- Rhythmic pacing rules (establish fast/slow shot alternation pattern)
- Key visual moments identification (brand reveal, material close-up, usage scenario, final branding)

### Temporal Breathing Logic

Reject uniform shot duration. Apply rhythmic variance:

**Fast Shots (2s)** — Shock value moments

- Logo reveals with explosive light burst
- Rapid push-in to product frontal view
- Quick environmental establishing shots
- Transition bridges between chapters

**Medium Shots (3s)** — Information delivery

- Material texture scans (matte surface, embossed details)
- 360° product rotation with bullet-time effect
- Ingredient drop sequences
- Branding reinforcement moments

**Slow Shots (4-5s)** — Emotional peaks

- 1000fps/2000fps ultra-slow motion (package opening, liquid splash, compression deformation)
- Cinematic hero shots with dramatic lighting
- Color-split light effects (contrasting hues cutting through product)
- Final branding lockup with negative film flash

**Breathing Pattern Example** (15s chapter): 2s fast → 4s slow → 2s fast → 3s medium → 4s slow = Creates visual inhale/exhale rhythm that prevents fatigue

### Multi-Reference Synthesis Protocol

When generating video from storyboard images, always apply **product reference + chapter storyboard images** as compound input:

**Reference Stack Structure:**

1. **Anchor Image** (Product hero shot) — immutable, present in every video generation call
2. **Chapter Storyboard Images** (5 shots per 15s chapter) — variable, defines the chapter's visual narrative

**Why this matters:**

- Anchor image ensures product identity consistency (packaging design, color accuracy, logo fidelity)
- Storyboard images guide camera movement, lighting transitions, compositional flow
- Synthesis prevents "visual drift" where each chapter feels disconnected

**Execution Pattern:**

```
For Chapter 1 (S01-S05):
  generate_video(
    reference_images: [product_hero.jpg, S01.jpg, S02.jpg, S03.jpg, S04.jpg, S05.jpg],
    duration: 15s,
    model: Seedance 2.0 Fast,
    resolution: 1080p
  )

For Chapter 2 (S06-S10):
  generate_video(
    reference_images: [product_hero.jpg, S06.jpg, S07.jpg, S08.jpg, S09.jpg, S10.jpg],
    duration: 15s,
    model: Seedance 2.0 Fast,
    resolution: 1080p
  )
```

Note: product_hero.jpg appears in every call, maintaining visual continuity.

## Workflow

### 1. Preparation Stage

**Asset Inventory Checklist:**

- \[ \] Product reference images (minimum 1 hero shot, ideally 3-5 angles)
- \[ \] Brand style guide elements (if available: logo files, color codes, typography specs)
- \[ \] Competitive reference videos (analyze visual language in category)
- \[ \] Shot reference library (collect cinematography examples for desired techniques)

**Pre-Production Decisions:**

1. **Chapter segmentation rule**: For 60s video, use 4 chapters × 15s each. This creates natural act breaks and allows phased approval.
2. **Shot density calibration**: 5 shots per 15s chapter = 20 total shots for 60s. This balances visual variety with shot clarity (avoid overwhelming rapid cuts).
3. **Stylistic constraints from user corrections**: When user says "按照参考手法" (follow reference techniques), extract specific techniques mentioned (e.g., bullet-time 360° rotation, strobe frequency flashing, ultra-slow motion material destruction).

### 2. Storyboard Generation Stage

**Chapter-by-Chapter Approval Flow**:NEVER generate all storyboard images at once. Use iterative approval:

1. Generate Chapter 1 storyboards (5 images) → await user confirmation
2. Generate Chapter 2 storyboards (5 images) → await user confirmation
3. Generate Chapter 3 storyboards (5 images) → await user confirmation
4. Generate Chapter 4 storyboards (5 images) → await user confirmation

**Why phased generation:**

- User can course-correct visual style early (vs. regenerating 20 images at once)
- GPU resource management (avoid parallel generation failures)
- Maintains continuity (each chapter builds on approved previous chapter's aesthetic)

**Storyboard Image Prompt Framework:**

```
[Product placement] + [Camera technique] + [Lighting setup] + [Visual style modifiers] + [Color palette] + [Composition rule]

Example for S01 (Logo Explosion):
"Green potato chip packaging bag, Brand Name logo in deep blue oval, pure black background, green light explosion burst radiating from logo center, cyberpunk dark-tone aesthetic, extreme color saturation, centered composition with explosive radial symmetry, professional product photography, 8K ultra-detailed"

Example for S07 (Ultra-Slow Motion Opening):
"Macro close-up of green chip bag top seal being torn open, 1000fps ultra-slow motion effect, green foil fragments and chip crumbs suspended mid-air with motion blur trails, dramatic side lighting creating rim light on floating particles, dark gradient background transitioning from black to deep green, cinematic depth of field, photorealistic 3D render quality"
```

**Critical Constraints for Storyboard Consistency:**

- Product identity elements (logo design, color scheme, packaging shape) MUST remain pixel-identical across all 20 storyboard images
- Lighting color temperature can vary per shot (cool blue for material shots, warm gold for ingredient shots) but must maintain overall dark-tone baseline
- Camera angles must systematically cover visual space: frontal (S02), 360° rotation (S03), macro texture (S05), overhead pour (S08), mirror split (S16)

### 3. Video Generation Stage

**One Chapter = One Video Node**Do NOT generate 5 separate videos per chapter. Generate ONE video per chapter with multi-image reference:

**Generation Parameters:**

- Model: Seedance 2.0 Fast (balances quality and generation speed)
- Resolution: 1080p (industry standard for web video)
- Duration: 15s per chapter (matches storyboard duration allocation)
- Reference images: Product hero image + 5 storyboard images from that chapter (6 images total)

**Parallel Processing Strategy**:Generate all 4 chapter videos simultaneously (not sequentially) to minimize total production time.

**Quality Audit Checklist per Chapter Video:**

- \[ \] Product packaging design matches reference image (logo readable, colors accurate)
- \[ \] Camera movements follow storyboard sequence (no random motion deviations)
- \[ \] Shot transitions feel natural (no abrupt cuts within chapter)
- \[ \] Lighting aesthetic maintains chapter theme (e.g., material decode chapter keeps blue/green color split lighting)

### 4. Audio Integration Stage

**BGM Necessity Decision Tree:**

- IF generated videos contain NO native audio (AI video generation default) → BGM is MANDATORY
- IF video style is "explosive/rhythmic" (strobes, rapid cuts, slow-motion) → BGM is CRITICAL for emotional pacing
- IF target platform is social media (Bilibili, YouTube) → BGM significantly impacts completion rate

**BGM Generation Prompt Framework:**

```
[Genre] + [Tempo] + [Mood] + [Instrumentation] + [Structure]

Example for Cyberpunk Product Video:
"Electronic industrial music, 120-130 BPM, dark-tone with explosive crescendos, heavy bass drops + metallic percussion + synthesizer glitch effects, 60-second structure with 4-act progression: mysterious intro (0-15s) → tension build (15-30s) → climax burst (30-45s) → brand lockup outro (45-60s), no vocals"
```

**BGM-to-Video Sync Considerations:**

- BGM duration MUST exactly match final video duration (60s BGM for 60s video)
- Identify BGM beat drop moments and align with visual climax shots (e.g., beat drop at 30s aligns with ingredient explosion chapter start)
- If BGM has distinct intro/outro, ensure video starts/ends don't feel abrupt

### 5. Final Assembly Stage

**Video Concatenation Order**:Chapter 1 (0-15s) → Chapter 2 (15-30s) → Chapter 3 (30-45s) → Chapter 4 (45-60s)

**Assembly Parameters:**

- Transition type: Direct cut (no crossfade, maintains commercial film aesthetic)
- Audio mixing: BGM as single continuous track (not chapter-spliced)
- Output resolution: Maintain 1080p from chapter videos
- Output format: MP4 H.264 (universal compatibility)

**Pre-Delivery Quality Check:**

- \[ \] Total duration matches target (60s)
- \[ \] No black frames at chapter boundaries (indicates concatenation error)
- \[ \] Audio sync maintained throughout (no drift after 30s mark)
- \[ \] Product branding visible in first 3 seconds (critical for social media algorithms)
- \[ \] Final shot is definitive lockup (logo + product, static hold for 2-3s)

## Key Constraints & Standards

### Immutable Product Fidelity Rules

- **Logo integrity**: Brand name, logo shape, logo color NEVER distort across any frame. If AI generation introduces logo mutations, that shot must be regenerated.
- **Packaging color accuracy**: Use product reference image as color truth source. Cyberpunk lighting effects can add color washes, but base packaging color (e.g., green bag) must remain recognizable.
- **Aspect ratio discipline**: User-selected aspect ratio (16:9 or 9:16) must be enforced at storyboard generation stage. Do NOT generate square storyboards for horizontal video.

### Chapter Cohesion Standards

- **Visual style continuity**: While each chapter has thematic variation (e.g., Chapter 1 = explosive reveal, Chapter 2 = material intimacy), overall aesthetic (dark-tone, high-contrast, cyberpunk) must remain constant.
- **Camera language consistency**: Use named camera techniques consistently (e.g., "bullet-time 360° rotation" must show slow-motion orbital camera path, not a simple pan).
- **Lighting logic**: Establish lighting rules per chapter and enforce them. Example: Chapter 2 (material decode) uses split-screen color contrast lighting (blue left / green right), so all 5 shots in that chapter should reference this lighting setup.

### Shot Duration Discipline

- **Minimum shot duration**: 2 seconds (below this, shots become subliminal and confusing)
- **Maximum shot duration**: 5 seconds (beyond this, single static shots feel sluggish in commercial pacing)
- **Duration variance mandate**: Within a 15s chapter, shot durations MUST vary. Avoid five 3-second shots in a row (monotonous rhythm).

### Temporal Pacing Rules

- **Fast-slow alternation**: After a 2s fast shock shot, follow with 4-5s slow emotional shot. This creates perceptual "breathing."
- **Chapter boundary differentiation**: First shot of each new chapter should have distinct visual signature (e.g., Chapter 2 starts with dramatic light-split shot to signal tonal shift from Chapter 1's explosive opening).
- **Climax placement**: Peak visual intensity (ultra-slow motion, color explosion, mirror split effects) should occur at 30-45s mark (third chapter), not evenly distributed.

### Multi-Reference Generation Standards

- **Reference image count per video**: Product hero image + chapter storyboard images = 6 total references (1 anchor + 5 guides).
- **Reference image resolution**: Storyboard images must be generated at minimum 1024×1024 to provide sufficient detail for video synthesis.
- **Reference image consistency**: Product hero image MUST be identical file across all 4 chapter video generations (not regenerated variants).

### Audio Integration Standards

- **BGM genre alignment**: BGM style must match video aesthetic (electronic/industrial for cyberpunk, orchestral for luxury products, pop/upbeat for snack foods).
- **BGM structure requirement**: 60s BGM should have 4-act structure mirroring video chapters (intro/build/climax/outro).
- **No audio clipping**: When merging BGM with silent video, ensure BGM volume peaks do not exceed -3dB to prevent distortion.
- **Fadeout duration**: If BGM has natural fadeout, ensure it completes within final 2s of video (not cut off abruptly).

### User Correction Integration

- **Phrase-to-constraint mapping**: When user says "错误了" (wrong), immediately ask for specificity. Convert their correction into testable rule.
  - User: "需要按照我要求" (need to follow my requirements) → Extract: user specifies chapter duration structure (15s blocks) as immutable constraint
  - User: "产品页需要链接进去参考" (product page needs to be linked as reference) → Extract: product hero image must be included in every video generation reference stack
- **Workflow correction memory**: If user corrects workflow (e.g., "一个视频节点" - one video node, not multiple), this becomes permanent workflow rule for remainder of project.

## Recommended Tools & Models

**Video Generation**: Use Seedance 2.0 Fast for all chapter video generation. This model balances photorealistic quality with generation speed, critical for iterative production workflows. The "Fast" variant reduces generation time from 5-10 minutes to 2-3 minutes per 15s video while maintaining commercial-grade output.

**Image Generation**: For storyboard frame generation, use high-resolution models (minimum 1024×1024 output) with strong prompt adherence. Product packaging details (logo text, nutritional info, barcode) require models with fine-detail rendering capability.

**Audio Generation**: For BGM synthesis, use music generation models that support structural control (intro/chorus/outro markers) and genre-specific instrumentation. Avoid generic "background music" prompts — specify tempo (BPM), mood descriptors, and instrument palette.

## Advanced Techniques

### Dynamic Shot Density Adjustment

For different product categories, calibrate shot density:

- **High-detail products** (tech gadgets, luxury goods): 3-4 shots per 15s chapter (longer shot durations allow detail absorption)
- **Fast-moving consumer goods** (snacks, beverages): 5-6 shots per 15s chapter (maintain energetic pacing matching consumption speed)
- **Service/concept products**: 4 shots per 15s chapter with more abstract visual metaphors

### Color Psychology Integration

Map product attributes to lighting color choices:

- **Fresh/natural products**: Green/yellow warm tones for ingredient shots
- **Premium/luxury products**: Gold/deep blue cold tones with high contrast
- **Tech/innovation products**: Cyan/magenta with neon accents
- Ensure color transitions between chapters follow complementary color theory (not random shifts)

### Narrative Arc Structuring

For 60s videos, apply classic dramatic structure:

- **Act 1 (0-15s)**: Establish world + introduce product (explosive reveal)
- **Act 2 (15-30s)**: Explore product (material intimacy, structural details)
- **Act 3 (30-45s)**: Product in context (ingredient showcase, usage implication)
- **Act 4 (45-60s)**: Emotional resolution (branding lockup, aspirational final image)

This maps to story structure: setup → exploration → climax → resolution.

### Reference Image Hierarchy

When multiple product images exist, establish reference priority:

1. **Tier 1 (Immutable anchor)**: Product hero shot with best lighting/angle
2. **Tier 2 (Variant references)**: Additional angles for specific shots (back panel for nutritional info shot, side profile for thickness emphasis)
3. **Tier 3 (Contextual references)**: Lifestyle images showing product in use (only for chapter 3 context shots)

Always include Tier 1 in every video generation. Include Tier 2/3 selectively per chapter theme.