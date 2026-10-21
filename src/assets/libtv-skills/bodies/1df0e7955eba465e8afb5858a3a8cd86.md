# Korean Beauty Model Generation

## Core Methodology

### 1. Model DNA Architecture — 12-Dimensional System

Every generated model must encode 12 independent visual dimensions. Designers input 10 simplified parameters; the AI auto-completes the remaining 2 dimensions plus underlying detail layers.

**Input Parameters (Designer Control):**

 1. Age range (e.g., 25-30, 35-40)
 2. Age state (youthful appearance vs mature appearance)
 3. Aesthetic temperament (natural affinity, sophisticated elegance, high-end maturity)
 4. Hairstyle (center-parted low ponytail, short bob, long waves)
 5. Makeup style (bare minimum, sheer foundation, clear glow)
 6. Clothing (beige knitwear, light silk blouse, simple dress)
 7. Expression (natural smile, subtle lip curve, confident gaze)
 8. Action (holding product naturally, hand-to-cheek, relaxed pose)
 9. Scene (minimalist home interior, solid color backdrop)
10. Composition/whitespace (left-aligned right whitespace, centered balanced, right-aligned left whitespace)

**Auto-Completed Dimensions (AI DNA Injection)**:11. Facial bone structure — Korean beauty standard: high cheekbones, defined jawline, almond eyes, moderate nose bridge 12. Photography parameters — natural window light, shallow depth of field (f/2.8), warm color grading (5000K), professional color separation

**DNA Detail Layers (Non-Controllable Brand Standards):**

- Skin texture: Glass skin ("yuri-pi-bu") with visible pore detail, natural highlight on cheekbones/T-zone, no over-retouching
- Facial features: Natural Asian proportions, slightly upturned eye corners, full lips with natural sheen
- Makeup baseline: Sheer foundation preserving skin texture, ultra-light blush, soft brown eyeshadow, root-defined lashes, nude-pink lips
- Body proportions: Medium height (\~165cm), slender but healthy build, upright natural posture
- Product interaction: Natural hand curvature (5 visible fingers, no deformities), product held at chest-to-face height

### 2. Korean Premium Beauty Visual Standards — Non-Negotiable Brand Rules

These constraints are **hard-coded** into every generation and cannot be overridden by designer input:

**Skin Quality Standards:**

- Glass skin (translucent luminous finish) with visible fine texture
- Cool-toned fair complexion (not yellow-based warm)
- Strategic highlighter: cheekbones, nose bridge, cupid's bow
- Natural color transitions (no harsh blush lines)
- Zero plastic/porcelain skin effect
- Eye area may show subtle fine lines for age authenticity (35+ only)

**Makeup Constraints:**

- Ultra-sheer base — foundation thickness must not obscure skin texture
- Blush/eyeshadow: barely-there intensity, Korean "saeng-meok" (no-makeup makeup)
- Lip finish: dewy/glossy (not matte), nude-pink to rose-nude spectrum
- Avoid: heavy contouring, smoky eyes, Instagram glam, over-lined lips

**Model Presence Standards:**

- Professional editorial model energy (not girl-next-door)
- Strong eye contact with camera, confident but not aggressive
- Refined bone structure (high cheekbones, defined jawline)
- Camera awareness — poses show intentionality, not candid snapshots

**Photography Quality:**

- Commercial beauty editorial standard
- Natural soft window light (never studio flash)
- Shallow bokeh background separation
- High-resolution skin detail capture
- Post-production friendly (clean composition for Photoshop overlay)

### 3. Composition Safety Zones — Layout Design Framework

Every composition must account for downstream graphic design use:

**Whitespace Mapping:**

- "Left-aligned, right whitespace" → 40% right-side clear zone for text/product info
- "Right-aligned, left whitespace" → 40% left-side clear zone
- "Centered, balanced whitespace" → 20% margins both sides

**Safety Margins:**

- Head clearance: minimum 10% frame height above head (never crop skull)
- Hand safety: if hands visible, show full fingers (no amputated hands at frame edge)
- Product display space: if holding product, ensure 30% clear backdrop behind product for design flexibility

**Shot Framing Standards:**

- Close-up: face + shoulders (60% face fill)
- Half-body: waist-up (40% face fill)
- 3/4 body: knee-up (25% face fill)
- Model must not touch frame edges (breathing room on all sides)

## Workflow

### 1. Preparation Stage

**Input Collection Checklist:**

- \[ \] Age range specified
- \[ \] Aesthetic temperament defined (natural/sophisticated/mature)
- \[ \] Hairstyle type selected
- \[ \] Makeup intensity level (bare/sheer/clear)
- \[ \] Clothing style chosen
- \[ \] Expression keyword provided
- \[ \] Action/pose described
- \[ \] Scene type identified
- \[ \] Composition direction mapped
- \[ \] Aspect ratio confirmed (default: 4:5 vertical)

**Parameter Standardization:**

- Translate designer's colloquial input into precise visual descriptors
- Example: "young but mature" → "25-30 age range, youthful bone structure, sophisticated styling"
- Example: "clean hair" → "center-parted low ponytail, sleek finish, no flyaways"

**Brand Rules Injection (Auto-Applied):**

- Korean glass skin layer
- Ultra-sheer makeup baseline
- Premium model presence enhancement
- 4:5 aspect ratio lock (unless explicitly overridden)
- Natural lighting preset
- Solid/minimalist background default

### 2. Initial Generation Stage

**Prompt Architecture — 5-Layer Structure:**

```
[Layer 1: Model Foundation]
Asian woman, [age range], [aesthetic temperament], [bone structure keywords], [skin tone], editorial model presence

[Layer 2: Glass Skin + Makeup]
Korean glass skin, translucent luminous complexion, strategic highlighter on cheekbones/nose bridge, [makeup intensity], ultra-sheer foundation, [specific makeup details]

[Layer 3: Hair + Clothing + Expression]
[Hairstyle description], [clothing details], [expression keywords], confident eye contact

[Layer 4: Action + Product + Composition]
[Pose description], holding [product type] naturally, [composition direction], [whitespace allocation]

[Layer 5: Photography + Scene]
Natural soft window light, shallow depth of field f/2.8, [scene description], clean minimalist backdrop, professional beauty editorial photography, warm color grading
```

**Negative Prompt (Fixed):**

```
Plastic skin, over-retouched, influencer aesthetic, heavy makeup, smoky eyes, contoured face, matte lips, over-lined lips, studio flash, harsh shadows, Instagram filter look, deformed hands, extra fingers, amputated limbs, cropped head, messy background, product distortion, low resolution, artificial lighting, cluttered composition
```

**Generation Method:**

- **Always use text-to-image** (never image-to-image with reference photos)
- Reason: Prevents facial feature replication — each model must have a unique face
- Reference images inform the prompt description, not the generation input

### 3. Iteration Stage

**Quality Audit Checklist (12-Point Inspection):**

DimensionPass CriteriaCommon Failure ModesAspect ratio4:5 vertical (unless specified)Horizontal output, square cropGlass skinLuminous + textured, visible poresPlastic smoothing, yellow undertoneMakeup intensityBarely-there if "bare/sheer" specifiedVisible blush/eyeshadow, defined eyelinerHairstyle matchExact style from inputGeneric long hair when bob requestedClothing accuracyMatches color/style inputWrong garment type/colorModel presenceEditorial confidence, strong gazeTimid expression, unfocused eyesHand anatomy5 fingers, natural curvatureExtra fingers, fused digits, missing thumbCompositionWhitespace on correct sideModel centered when side-aligned requestedHead clearance10%+ space above headSkull cropped at frame topProduct visibilityClear, unobstructed if heldBlurred product, text hallucinationBackgroundClean, minimalCluttered, distracting elementsLightingSoft natural window lightHarsh shadows, studio flash look

**Optimization Dimensions:**

1. **If makeup too heavy:**

   - Keyword injection: "ultra-sheer", "barely-there", "Korean saeng-meok no-makeup makeup"
   - Negative reinforcement: "visible blush", "defined eyeshadow", "makeup layer"

2. **If model presence insufficient:**

   - Enhance: "professional editorial model", "refined bone structure", "high cheekbones", "strong eye contact"
   - Reference standard: "Korean luxury beauty brand campaign model"

3. **If glass skin fails:**

   - Emphasize: "translucent luminous skin", "strategic highlighter cheekbones nose bridge", "visible fine pore texture"
   - Negative: "matte skin", "powdered finish", "over-retouched"

4. **If composition incorrect:**

   - Explicit instruction: "model positioned \[left/right/center\] of frame, \[X\]% whitespace on \[opposite side\]"
   - Add: "breathing room on all sides, never touching frame edge"

**Iteration Decision Tree:**

- **Hard reject (regenerate immediately):** Wrong aspect ratio, cropped head, deformed hands, plastic skin
- **Soft reject (tweak prompt, regenerate):** Makeup too heavy, model presence weak, composition off
- **Accept with note:** Minor product text hallucination (fixable in Photoshop), slight whitespace imbalance (acceptable variance)

## Key Constraints & Standards

### Immutable Rules (Never Compromise)

1. **Aspect ratio discipline:** 4:5 vertical is the default and must be maintained unless explicitly changed by designer
2. **Facial uniqueness:** Every generation must produce a new face — never replicate reference image features
3. **Hand anatomy accuracy:** If hands visible, all 5 fingers must be anatomically correct and fully in-frame
4. **Head clearance:** Skull must never be cropped — minimum 10% headroom
5. **Glass skin non-negotiable:** Korean translucent luminous skin with visible texture is mandatory for all outputs

### Fidelity Rules (Brand Visual Identity)

1. **Makeup intensity ceiling:** Even "clear glow" makeup must stay below 30% opacity — foundation cannot obscure skin texture
2. **Model presence floor:** Every model must exhibit editorial-level camera awareness — no "candid snapshot" energy
3. **Lighting signature:** Natural soft window light only — studio flash/ring light is prohibited
4. **Background simplicity:** Minimalist solid colors or subtle home interiors — never busy/cluttered environments
5. **Color temperature:** Warm color grading \~5000K — avoid cool clinical tones or overly warm golden hour

### Consistency Rules (Batch Production)

1. **Visual DNA persistence:** When generating multiple models for one campaign, maintain glass skin + Korean bone structure + ultra-sheer makeup standards across all outputs
2. **Whitespace allocation:** If a campaign uses mixed compositions (left/right/center), ensure each direction has the specified clear zone percentage
3. **Product interaction:** If multiple models hold the same product, hand position and product angle should vary while keeping hand anatomy consistent
4. **Scene coherence:** If using "minimalist home interior", maintain the same color palette (beige/white/grey) across all shots in a batch

### Post-Generation Standards

1. **Photoshop-ready composition:** All outputs must have clean backgrounds suitable for text overlay without masking
2. **Product placeholder treatment:** AI-generated product labels/text are acceptable — client will replace in post-production
3. **Resolution requirement:** High-resolution output for print-quality skin detail (implied by prompt, not explicitly controlled)
4. **Batch size recommendation:** Generate 5-10 variations per parameter set to account for random variation in model presence/expression

## Example

**Input Parameters:**

- Age range: 25-30
- Aesthetic: High-end maturity
- Hairstyle: Short bob
- Makeup: Bare minimal
- Clothing: Simple dress
- Expression: Subtle smile
- Action: Hand-to-cheek
- Scene: Solid color backdrop
- Composition: Centered, balanced whitespace
- Ratio: 4:5

**Expected Output Description**:A 25-30 year old Asian woman with refined Korean bone structure (high cheekbones, defined jawline, almond eyes) featuring translucent glass skin with strategic highlighter on cheekbones and nose bridge. Ultra-sheer bare minimal makeup — barely-there blush, soft brown eyeshadow, root-defined lashes, dewy nude-pink lips. Clean short bob hairstyle, sleek finish. Wearing a simple beige dress. Subtle lip curve smile with confident eye contact showing editorial model presence. One hand gently placed on cheek in elegant pose. Shot against a pure white minimalist backdrop with natural soft window light from the left, shallow depth of field (f/2.8), warm color grading. Model centered in frame with 20% breathing room on both sides, head clearance visible above. 4:5 vertical aspect ratio. Professional Korean luxury beauty brand campaign quality.