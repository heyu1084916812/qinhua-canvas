# Furniture E-commerce Visual Campaign

## Core Methodology

### 1. Layered Visual Architecture

Every furniture campaign operates on independent layers that maintain identity consistency while allowing targeted variation:

- **Layer 1 (Product Core)**: Physical furniture structure — material grain, joinery details, proportions — NEVER changes. This becomes the source of truth for all derived scenes.
- **Layer 2 (Product Photography Foundation)**: Three-view reference captures (front/3-4 side/back) establish canonical angles. Macro details (wood grain, stitching, hardware) build material credibility.
- **Layer 3 (Scene Context)**: Environment styling (study/tea room/dining/living) — varies per lifestyle scenario but maintains tonal coherence (e.g., Nordic minimalism + Neo-Chinese fusion).
- **Layer 4 (Specification Graphics)**: Technical documentation (dimension annotations, exploded views, cross-sections) — uses line overlays, not full regenerations.
- **Layer 5 (Brand Narrative)**: Storytelling imagery (craftsmanship process, material sourcing, packaging) — reinforces premium positioning.

### 2. Model Selection Logic by Output Type

Different AI models exhibit specialized strengths. Task-model mapping:

Output TypeModel PriorityReasoningThree-view reference capturesSeedream 5.0 Pro &gt; General V2Preserves structural fidelity, minimizes distortion across anglesScene compositionLib Image &gt; Seedream 5.0 ProNatural atmosphere rendering, lighting coherenceMacro details (wood grain, leather)Seedream 5.0 ProHighest texture resolution, material realismDimension annotationsGeneral V2 &gt; Lib ImageClean backgrounds, accepts graphic overlays wellInfographic layoutsLib Image ≈ General V2Layout stability, typography integration

**Multi-model parallel generation strategy**: For critical outputs (hero images, key selling points), generate with ALL three models simultaneously, select best result per evaluation criteria.

### 3. Prompt Construction Framework

Structured multi-dimensional prompts prevent ambiguity:

**\[Product Identity Block\]**

- Material: "North American black walnut wood, FAS grade, visible mountain grain pattern"
- Structure: "Arc-bent continuous backrest, mortise-tenon joinery, no exposed nails"
- Finishes: "Matte wood wax oil coating, Nappa leather cushion with topstitching"

**\[Composition Block\]**

- Angle: "45° overhead view" / "eye-level front view" / "macro detail at 10cm focal distance"
- Framing: "Product centered, 30% background blur, clean white negative space top-left for text overlay"

**\[Scene Styling Block\]** (for lifestyle scenes only)

- Environment: "Nordic study with light oak desk, chevron glass bookcase, warm window light"
- Props: "Ceramic vase with dried pampas grass, linen curtains, handwoven beige rug"
- Lighting: "Soft natural window light from right, warm undertone, low saturation Morandi palette"

**\[Technical Constraints Block\]**

- Output: "9:16 vertical / 16:9 horizontal / 1:1 square"
- Quality: "2K/8K, photorealistic rendering, shallow depth of field"
- Style: "Product photography / lifestyle editorial / technical specification diagram"

**Negative prompts**: Always include material prohibitions ("no plastic sheen, no oversaturation, no cartoon rendering, no visible construction flaws like exposed nails or glue residue").

### 4. Quality Standards for Furniture Imaging

**Immutable product rules** (violations require regeneration):

- Wood grain direction must follow actual lumber orientation (parallel to structural lines, not perpendicular)
- Mortise-tenon joints must show NO gaps, screws, or nails
- Leather upholstery must show natural pore texture (not vinyl smoothness)
- Arc-bent components must have continuous grain flow (not segmented boards)

**Scene coherence rules**:

- Color temperature must stay within ±200K across all lifestyle images in a batch
- Background props must repeat motifs (same rug texture, same ceramic style) to establish visual continuity
- Model identity (if humans appear) must maintain pixel-level consistency in skin tone, body proportions, hair style

**Technical documentation rules**:

- Dimension annotation lines must use dashed strokes, not solid (reduces visual clutter)
- Measurement text must use Source Han Sans (思源黑体) at medium weight
- Specification diagrams require pure white backgrounds (#FFFFFF, no gradients)

## Workflow

### Stage 1: Pre-Production Asset Audit

**Input checklist**:

1. ✅ Do you have three-view reference images? (Front/3-4 side/back angles)

   - **YES**: Use existing references as `[@image:...]` inputs for all subsequent generations
   - **NO**: Generate three-view set first (16:9, white background, product centered)

2. ✅ Confirm model selection:

   - Single model workflow: Choose one model for entire campaign (faster, consistent style)
   - Parallel model workflow: Generate with Lib Image + General V2 + Seedream 5.0 Pro simultaneously, select best per category (slower, higher quality)

3. ✅ Define selling points & style:

   - **If client provides**: Extract 3-4 key features (e.g., "Arc-bent backrest, FAS walnut, mortise-tenon joinery, ergonomic 155mm lumbar support")
   - **If undefined**: Analyze product, propose options:
     - Option A: Premium craftsmanship focus (wood grain, joinery details)
     - Option B: Lifestyle integration focus (scene versatility, interior harmony)
     - Option C: Functional comfort focus (ergonomics, dimensions, use scenarios)

4. ✅ Collect reference images (optional):

   - **If provided**: Note specific layout elements to replicate (text placement, graphic style, color palette)
   - **If none**: Proceed with standard campaign templates

**Element inventory**: Before starting, catalog all required outputs:

- Brand hero image: 1 (9:16 or 16:9)
- Selling point breakdowns: 2-4 images (dimensions, materials, features)
- Ergonomic demonstrations: 3 images (human interaction, fit, comfort)
- Lifestyle scenes: 4 images (study/tea room/dining/living)
- Macro details: 3 images (wood grain, leather stitching, joinery)
- Material sourcing: 2 images (origin map, grade comparison)
- Specification table: 1 image (dimension diagram with annotations)
- Logistics & warranty: 2 images (packaging cross-section, service guarantee card)

**Total**: 18-20 images minimum for complete campaign.

### Stage 2: Systematic Image Generation

**2A. Foundation Captures** (Three-view + macro details)

*Three-view reference*:

- Prompt template: `[@image:#1:product_reference:URL] generate three-view technical diagram, 16:9 horizontal, white background, left-center-right arrangement: front view, 3/4 side view, back view`
- Generate with: Seedream 5.0 Pro (primary) or General V2 (backup)
- Validation: Check that wood grain continuity is visible across all three angles

*Macro detail captures* (wood/leather/joinery):

- Prompt template: `[@image:#1:three_view:URL] extreme macro closeup, focus on [DETAIL_TYPE], shallow depth of field, natural soft light, pure white background, 9:16 vertical`
  - \[DETAIL_TYPE\] examples: "walnut wood mountain grain texture" / "Nappa leather topstitching at 5mm intervals" / "mortise-tenon joint connection at armrest"
- Generate with: Seedream 5.0 Pro (highest material fidelity)
- Validation: Texture must be sharp in focus zone, background cleanly blurred

**2B. Lifestyle Scene Batch**

Generate 4 scenes in parallel (reduces waiting time):

*Scene 1: Study/Office*

- Environment: Light oak desk, Nordic minimalist decor
- Lighting: Window-side natural light
- Composition: 9:16 vertical, chair at desk, warm tones

*Scene 2: Tea Room*

- Environment: Neo-Chinese tea table, gray walls, zen plants
- Lighting: Soft ambient overhead + natural side light
- Composition: 9:16 vertical, chair beside tea setup

*Scene 3: Dining Area*

- Environment: Long wooden dining table, warm pendant lights
- Lighting: Mixed indoor warm light + daylight
- Composition: 9:16 vertical, chair at table edge

*Scene 4: Living Room*

- Environment: Floor-to-ceiling window corner, light-toned textiles
- Lighting: Abundant natural window light
- Composition: 9:16 vertical, chair by window

**Unified prompt structure for all scenes**:

```
[@image:#1:three_view:URL] place in [SCENE_ENVIRONMENT], [LIGHTING_SETUP], [COMPOSITION_ANGLE], Nordic minimalist + Neo-Chinese fusion aesthetic, low-saturation Morandi palette, natural materials throughout, life-styled product photography, 8K photorealistic, 9:16 vertical, clean composition with breathing room, no clutter
```

**Model recommendation**: Lib Image (best atmospheric coherence) or Seedream 5.0 Pro (best product fidelity)

**2C. Selling Point Graphics**

*With reference images*:

- Study reference layout (title placement, annotation style, graphic elements)
- Replicate structure: `[@image:#1:product_reference:URL] learn from [@image:#2:reference_layout:URL], create e-commerce detail page, add typographic text in Source Han Sans font, [KEY_SELLING_POINT], generate with [MODEL_NAME]`
  - Example selling points: "Arc-bent backrest, height 155mm" / "Solid walnut seat, depth 425mm" / "Mortise-tenon joinery, no nails"

*Without reference images*:

- Use standard templates:
  - **Dimension annotations**: White background, product side view, dashed measurement lines, metric labels
  - **Feature closeups**: Human hands interacting with feature (e.g., hands grasping arc backrest), annotation overlay
  - **Material comparisons**: Split-screen (left: inferior grade wood with defects, right: FAS grade walnut, clean grain)

**Model recommendation**: General V2 (cleanest backgrounds for graphic overlays) or Lib Image (best layout stability)

**2D. Brand Storytelling Pages**

*Material sourcing infographic*:

- World map with North America highlighted → connecting line → walnut cross-section with growth rings
- Prompt: `North American black walnut origin infographic, left side world map with Appalachian region highlighted, dotted line connecting to right side walnut log cross-section closeup with visible annual rings, bottom space reserved for text, minimalist infographic design, warm walnut + off-white palette, 8K, clean professional science communication aesthetic`

*Craftsmanship process flowchart*:

- Vertical 5-step sequence: forest logging → lumber cutting → natural air drying → hand sanding & mortise assembly → finished product
- Prompt: `Furniture craftsmanship process vertical flowchart, 5 steps with small icons and text labels: (1) forest logging scene, (2) lumber cross-section with rings, (3) wood air-drying, (4) hand sanding and mortise joinery closeup, (5) finished chair display, minimalist flat illustration + photorealistic elements, warm walnut tones, 8K, narrative flow with professional science communication quality`

*Packaging & warranty*:

- 5-layer corrugated cardboard cross-section (outer kraft paper, double corrugation, inner EPE foam) with chair component inside
- Service guarantee card (7-day return, 5-year warranty, lifetime maintenance) with icons

**Model recommendation**: Lib Image (best for infographic layouts) or General V2 (clean graphic integration)

### Stage 3: Quality Audit & Iteration

**Cross-batch consistency check**:

1. **Color temperature audit**: Load all lifestyle scenes side-by-side. Verify warm tone consistency (no sudden cold/blue tints). If &gt;200K deviation detected, flag outlier images for regeneration.

2. **Product identity audit**: Compare furniture structure details across all outputs:

   - Wood grain pattern direction must align with lumber orientation
   - Arc-bent backrest curvature must be identical (no flattening or over-bending)
   - Black leather cushion must maintain same topstitching pattern
   - Mortise-tenon joints must never show nails/screws

3. **Compositional balance audit**: Check negative space distribution. Hero images and key selling points must have 20-30% clean area for text overlays (typically top-left or top-right quadrants).

**Regeneration criteria**:

- **Mandatory regeneration**: Product structure defects (wrong grain, exposed nails, distorted proportions)
- **Recommended regeneration**: Lighting inconsistency, cluttered composition, low detail resolution in macro shots
- **Accept as-is**: Minor background variations (different plant species, slight prop differences) — these add natural variety

**When to accept batch**: When 80%+ of images pass all three audits. The remaining 20% can be selectively regenerated or post-processed.

**Optimization dimensions**:

- **Atmosphere refinement**: If scenes feel sterile, add "life-styled details" — coffee cup steam, open book pages, soft textile folds
- **Detail enhancement**: For macro shots, if texture isn't sharp enough, switch to Seedream 5.0 Pro or add "extreme macro 10cm focal distance, shallow DOF" to prompt
- **Text overlay preparation**: If graphic overlays look crowded, regenerate with explicit "reserve top 30% as clean negative space for text" instruction

## Key Constraints & Standards

### Immutable Product Rules

- Wood grain direction MUST follow actual lumber cutting patterns (parallel to structural lines)
- Mortise-tenon joinery MUST show zero gaps, nails, screws, or glue residue
- Arc-bent components MUST have continuous grain flow (not segmented boards with visible joints)
- Leather upholstery MUST show natural pore texture (not vinyl smoothness or plastic sheen)
- Product dimensions MUST remain proportionally consistent across all outputs (no stretched or compressed distortions)

### Scene Coherence Rules

- Color temperature variance across lifestyle batch ≤ ±200K (warm undertones maintained)
- Background prop families must repeat (same rug texture style, same ceramic aesthetic, same plant types) for visual continuity
- Lighting direction must stay consistent within scene categories (e.g., all study scenes use right-side window light)
- If human models appear, skin tone + body proportions + hair style must be pixel-level identical across batch

### Technical Documentation Rules

- Dimension annotation lines: dashed strokes only (not solid), 1-2pt weight, dark gray (#333333)
- Measurement text: Source Han Sans Medium, 14-18pt, positioned outside product silhouette with leader lines
- Specification diagrams: pure white background (#FFFFFF), no gradients or textures
- Comparison graphics: split-screen with vertical divider line, clear "BEFORE/AFTER" or "GRADE A/GRADE B" labeling

### Material Fidelity Rules

- Walnut wood: Mid-tone brown with visible dark/light grain striations, matte finish (no glossy sheen)
- Nappa leather: Fine pore texture visible at macro range, soft matte appearance (not patent leather gloss)
- Brass hardware: Warm gold tone, subtle patina acceptable, no mirror-polished chrome look
- Wood wax oil finish: Satin sheen (not glossy, not completely matte), brings out grain depth without plastic coating appearance

### Batch Production Standards

- Campaign minimum: 18-20 images (covers all content categories)
- Lifestyle scene batch: 4-6 images (minimum to show product versatility)
- Macro detail batch: 3-5 images (enough to establish material credibility without redundancy)
- Parallel model generation: For critical outputs (hero image, key selling points), generate with 2-3 models, select best result

## Recommended Tools & Models

- **Lib Image**: Best for lifestyle scene atmosphere, infographic layouts, natural lighting coherence
- **General image V2**: Best for clean specification diagrams, stable product proportions, accepts graphic overlays well
- **Seedream 5.0 Pro**: Best for three-view references, macro material details, highest structural fidelity

## Example

**Input**:

- Product: Black walnut wood president chair with arc-bent backrest and Nappa leather cushion
- Style: Nordic minimalist + Neo-Chinese fusion
- Selling points: FAS grade walnut, mortise-tenon joinery, ergonomic lumbar support

**Execution**:

1. Generate three-view reference with Seedream 5.0 Pro (16:9, white background)
2. Batch-generate 4 lifestyle scenes (study/tea room/dining/living) with Lib Image
3. Create 3 macro details (wood grain/leather stitching/mortise joint) with Seedream 5.0 Pro
4. Generate 2 selling point graphics (backrest height dimension + seat depth dimension) with General V2, learn from provided reference layouts
5. Create material sourcing infographic (origin map) and wood grade comparison with Lib Image
6. Audit batch for color consistency and product structure accuracy
7. Regenerate 2 images with lighting inconsistencies
8. Final output: 20 campaign-ready images

**Result**: Complete e-commerce campaign with consistent brand aesthetic, product fidelity maintained across all contexts, ready for platform upload with minimal post-processing.