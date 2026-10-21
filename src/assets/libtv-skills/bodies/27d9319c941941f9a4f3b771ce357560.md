# E-commerce Product Scene Replication

## Core Methodology

### Multi-Reference Processing Framework

When users provide multiple reference images, classify by intent:

**Fusion Mode**: Combine stylistic elements from all references into one unified scene

- Extract: color palette (dominant + accent), lighting direction (natural/artificial), material textures (wood/fabric/metal), prop categories (books/plants/ceramics)
- Merge: Create composite prompt merging all extracted elements while avoiding contradictions
- Output: Single coherent scene blending all reference aesthetics

**Independent Mode**: Treat each reference as a separate scene template

- Analyze: Each reference's unique composition (angle, depth of field, prop placement)
- Replicate: Generate one output per reference maintaining that specific scene structure
- Output: N distinct scene variations (where N = number of references)

### Proportion Lock System

**Critical constraint**: Product dimensions must remain pixel-accurate to source white-background image.

**Three-layer verification**:

1. **Aspect Ratio Lock**: Width:Height ratio extracted from product cutout must match output (e.g., wide cabinet = 16:9 source → maintain wide form in scene)
2. **Scale Calibration**: Product occupies consistent percentage of frame across all outputs (typically 40-60% of image area for hero product shots)
3. **Deformation Detection**: No stretching, squashing, or perspective distortion — product geometry stays orthogonal unless reference explicitly shows angled perspective

**Execution technique**:

- Parse product image for bounding box dimensions
- Encode as hard constraint in prompt: "product dimensions: W×H ratio EXACTLY as \[ratio\], no distortion"
- For detail shots: "zoom composition on \[specific element\], maintain original material texture and construction details EXACTLY as product shows"

### Reference Learning vs. Product Fidelity Separation

**What to extract from reference**:

- Scene architecture: room type, wall colors, floor materials
- Lighting setup: window positions, lamp types, color temperature
- Prop styling: furniture, decor items, accessory types
- Composition rules: camera angle, product placement, depth staging

**What to preserve from product**:

- Material textures: fabric weave patterns, leather grain, wood finish
- Construction details: stitching type, edge treatments, hardware finishes
- Color accuracy: exact product colorway (do NOT shift to match reference palette)
- Component proportions: cushion ratios, leg lengths, panel sizes

**Detail shot special rule**: When reference shows material closeup, learn ONLY the photographic approach (macro focus, lighting angle, background blur depth) — NEVER copy the reference's material onto the product. For example, if reference shows linen texture but product is velvet, output shows velvet in that closeup style.

### Character Handling Decision Tree

When reference contains human figures:

**Option 1 - Remove Character**:

- Retain all props/furniture character interacted with
- Fill space with environmental elements (plants, secondary furniture)
- Adjust composition to rebalance empty space

**Option 2 - AI-Generated Character**:

- Analyze reference for: age range, gender presentation, clothing style, pose/activity, ethnic features
- Generate new character matching demographic profile but different individual
- Maintain interaction logic (if reference shows reading, new character reads)

**Option 3 - Reference Character (Style Transfer)**:

- Attempt to preserve facial features, body proportions, skin tone
- Note: AI limitation — may result in similar but not identical appearance
- Best for: when character aesthetic matters more than exact identity

**Option 4 - User-Uploaded Character**:

- Accept separate character portrait/photo
- Composite into scene using reference pose/positioning
- Match lighting/color grading to scene environment

## Workflow

### 1. Preparation Stage

**Input Validation Checklist**:

- \[ \] Product image present (white/light neutral background)
- \[ \] At least one reference image present
- \[ \] Product clearly visible in source (not occluded/cropped)
- \[ \] Reference images show desired scene type (not unrelated content)

**If inputs missing**: Halt and request:

```
我的产品:[upload product white-background image]
参考为:[upload scene reference images]
```

**Multi-Reference Classification**:

- Count reference images
- If ≥2 references → Ask: "Fusion mode (merge styles) or Independent mode (separate scenes)?"
- Record user choice for batch processing

**Character Detection**:

- Scan references for human figures
- If detected → Ask: "Remove / AI-generate new / Use reference character / Upload custom character?"
- Record choice for scene generation

**Parameter Configuration** (ask in sequence):

*Q1: Output aspect ratio?*

- 3:4 (vertical product display)
- 4:3 (horizontal lifestyle)
- 9:16 (mobile/social vertical)
- 16:9 (wide desktop banner)
- 1:1 (square social)
- Custom (user specifies W:H)

*Q2: Text overlay handling?*

- Remove all text from references
- Generate AI copywriting (analyze product → create marketing text → overlay)
- User provides custom text (wait for input)

*Q3: Generation models?* (multi-select)

- Lib Image
- General image V2
- General image PRO
- Seedream 5.0 Pro

### 2. Initial Design Stage

**For each reference image**:

*Step A: Scene Analysis*

- Extract style tags: room type, color palette (hex codes if possible), lighting type (warm/cool/natural), material categories
- Identify props: list all furniture, decor, accessories visible
- Analyze composition: camera angle (eye-level/low/high), product placement (center/rule-of-thirds), depth of field

*Step B: Prompt Construction*

Framework structure:

```
[Scene setting] + [Product insertion] + [Proportion lock] + [Material fidelity] + [Composition rules] + [Quality standards]
```

Example:

```
Warm Japandi living room, cream walls, oak flooring, paper floor lamp, ceramic vase, woven basket.

[Product: beige fabric armchair with brown leather piping] placed as hero subject, occupying 50% of frame.

CRITICAL: Product width:height ratio EXACTLY 1:1.2 (as source), NO stretching or distortion. Fabric texture: boucle weave with visible loops. Leather trim: smooth aniline finish, natural edge.

Composition: Eye-level angle, product centered, shallow depth of field (f/2.8), natural window light from left.

Professional e-commerce photography, high resolution, color-accurate.
```

*Step C: Parallel Batch Execution*

- Submit same prompt to all selected models simultaneously
- Track generation with model labels (for later comparison)

**For detail shots specifically**:

- Identify detail type from reference (fabric closeup / hardware detail / edge treatment)
- Modify prompt:

  ```
  Macro photography of [product specific element], shallow depth of field.
  
  CRITICAL: Show ONLY product's actual material — [describe exact texture from product image]. Learn photographic approach from reference (lighting angle, focus depth, background blur) but DO NOT change product's material characteristics.
  
  [Material specification]: e.g., "velvet pile with directional nap, pearl white color, soft sheen under directional light"
  ```

### 3. Iteration Stage

**Quality Audit Checklist** (per output):

*Proportion Verification*:

- \[ \] Product aspect ratio matches source (measure if uncertain)
- \[ \] No stretching (check: are circles still circular? are vertical lines truly vertical?)
- \[ \] Scale appropriate (product not too small/large for scene)

*Material Fidelity*:

- \[ \] Fabric texture matches product (weave type, pile direction)
- \[ \] Color accuracy (compare to product source — should be identical)
- \[ \] Surface finish correct (matte/glossy/satin matches product)
- \[ \] Construction details visible (stitching, piping, legs, hardware)

*Scene Quality*:

- \[ \] Reference style captured (color palette, prop types, lighting mood)
- \[ \] Composition balanced (product clearly hero element)
- \[ \] No text artifacts (if removal requested)
- \[ \] Character handling correct (removed/generated/preserved per user choice)

**Regeneration Triggers**:

- Proportion distortion detected → Re-emphasize dimension lock in prompt
- Material changed → Add "CRITICAL: preserve \[exact material\] from product image"
- Scene style mismatch → Re-analyze reference, strengthen style keywords
- Multiple failures → Consider switching model

**Cross-Output Consistency Check** (for batch generations):

- Product should look identical across all scene variations
- Only scene elements (background, props, lighting) should vary
- If product appearance shifts between outputs → flag as error, regenerate failed outputs

**Approval Criteria**:

- User explicitly confirms satisfaction, OR
- Output passes all audit checklist items, OR
- Maximum 3 iteration rounds reached (then present best available)

## Key Constraints & Standards

### Immutable Product Rules

- **Proportion Lock**: Product width:height ratio from source image MUST remain exact in all outputs — no stretching, compression, or perspective distortion
- **Material Fidelity**: Fabric textures, leather grains, wood finishes, metal surfaces must match product source exactly — reference images inform scene only, NOT product materials
- **Color Accuracy**: Product colorway stays unchanged — do not shift product colors to match reference scene palette
- **Construction Details**: Stitching types, edge treatments, hardware, joinery visible in product source must remain visible and accurate in outputs

### Scene Composition Standards

- **Hero Product Framing**: Product occupies 40-60% of image area for standard shots, 70-90% for detail shots
- **Depth Staging**: Establish foreground/midground/background — product typically midground with shallow DoF isolating from background
- **Prop Hierarchy**: Supporting props should complement not compete — secondary objects smaller/defocused relative to product

### Detail Shot Special Constraints

- **Learning Scope**: Extract ONLY photographic technique from reference (camera angle, lighting setup, focus depth, background treatment)
- **Material Override Ban**: NEVER apply reference image's material to the product — if reference shows linen but product is velvet, show velvet in that photographic style
- **Texture Preservation**: Zoom compositions must reveal product's actual surface texture at high fidelity (weave patterns, grain direction, pile height)

### Multi-Reference Processing Rules

- **Fusion Mode Limit**: Maximum 3 references for style fusion — beyond 3, stylistic conflicts become irreconcilable
- **Independent Mode Batch**: Generate separate output per reference, maintain product consistency across all
- **Conflict Resolution**: When references contradict (warm vs cool lighting), default to first reference unless user specifies priority

### Character Handling Standards

- **Removal**: Retain all props character interacted with, rebalance composition with environmental elements
- **AI Generation**: Match demographic profile (age/gender/ethnicity/clothing style) but create distinct individual — never claim exact replication
- **Reference Preservation**: Best-effort similarity — acknowledge AI cannot guarantee pixel-perfect facial matching
- **Custom Upload**: Composite seamlessly — match lighting direction, color temperature, depth of field, scale to scene

### Text Treatment Rules

- **Removal**: Erase all text while preserving underlying scene elements — if text overlaid on wall, regenerate clean wall texture
- **AI Copywriting**: Generate concise marketing text (5-15 words) highlighting product category and key benefit, overlay in legible sans-serif font
- **Custom Text**: Accept user input, apply professional typographic hierarchy (headline + subhead if needed), ensure contrast/readability

### Model Selection Guidelines

- **Lib Image**: Best for lifestyle scenes with natural props, softer aesthetic
- **General image V2**: Balanced realism, good for product-forward compositions
- **General image PRO**: Highest detail fidelity, best for closeups and material textures
- **Seedream 5.0 Pro**: Superior lighting and atmospheric effects, ideal for mood-driven scenes
- **Parallel Testing**: When uncertain, select 2-3 models for side-by-side comparison

### Quality Thresholds

- **Batch Size**: 5-10 outputs per reference maintains style coherence — larger batches risk drift
- **Iteration Limit**: Maximum 3 regeneration rounds per output before accepting best available or switching approach
- **Acceptance Criteria**: Output passes all audit checklist items OR user explicitly approves despite minor imperfections

## Recommended Tools & Models

This skill references multiple AI generation models optimized for different visual qualities:

- **Lib Image**: Ideal for natural lifestyle scenes with warm, organic aesthetics — excels at soft lighting and atmospheric props
- **General image V2**: Balanced all-purpose model with reliable product rendering and scene composition — good baseline choice
- **General image PRO**: Highest detail fidelity and material texture accuracy — preferred for closeups, fabric details, and precision product shots
- **Seedream 5.0 Pro**: Superior lighting simulation and atmospheric depth — best for mood-driven scenes requiring complex light interactions

Recommend selecting 2-3 models for parallel generation to compare stylistic approaches and choose optimal output.

## Example

**Scenario**: User provides white-background image of beige boucle armchair with brown leather piping + 3 reference images (Japandi living room with paper lamp, modern loft with brick wall, minimalist studio with plants).

**Execution**:

1. **Preparation**:

   - Detect 3 references → Ask: "Fusion or Independent?"
   - User selects: "Independent"
   - No characters detected → Skip character handling
   - Configure: Ratio 3:4, Remove text, Models: General image PRO + Seedream 5.0 Pro

2. **Generation** (3 references × 2 models = 6 outputs):

   *Reference 1 (Japandi)*:

   - Prompt: "Warm Japandi living room, cream walls, oak floor, paper floor lamp, ceramic vase. \[Beige boucle armchair, brown leather piping\] centered, 50% frame. CRITICAL: Aspect ratio 1:1.2 exact, boucle texture with visible loops, leather smooth aniline. Eye-level, f/2.8, natural window light."
   - Output: 2 versions (Pro + Seedream)

   *Reference 2 (Loft)*:

   - Prompt: "Industrial loft, exposed brick wall, concrete floor, Edison bulbs, metal shelving. \[Beige boucle armchair, brown leather piping\] hero subject, 55% frame. CRITICAL: Same dimensions as source, boucle weave preserved, leather natural edge. Three-quarter angle, dramatic side light."
   - Output: 2 versions

   *Reference 3 (Minimalist)*:

   - Prompt: "Minimalist studio, white walls, light wood floor, potted monstera, simple pendant light. \[Beige boucle armchair, brown leather piping\] centered, 45% frame. CRITICAL: No distortion, fabric pile direction visible, leather sheen under soft light. Straight-on angle, even diffused lighting."
   - Output: 2 versions

3. **Review**:

   - All 6 outputs maintain armchair proportions ✓
   - Boucle texture and leather trim consistent ✓
   - Each scene captures respective reference style ✓
   - User selects 2 favorites for final delivery

**Result**: 6 distinct e-commerce scenes, each faithful to a different reference aesthetic while maintaining absolute product accuracy across all variations.