# Product Video Advertisement Design

## Core Methodology

### Multi-Reference Visual Anchoring System

Transform multiple product reference images into a unified video narrative by treating each reference as a visual constraint layer:

**Layer 1 (Product Identity)**: Package shape, color system, label proportions, text hierarchy — must remain pixel-consistent across all frames. Extract precise specifications: bottle shape (cylindrical/rectangular), cap type (flip/pump/screw), material finish (matte/glossy), dominant colors, brand name placement, product claim text, volume markings.

**Layer 2 (Scene Elements)**: Background props, textures, spatial arrangements from references. Catalog all elements: towels, baskets, botanicals, essential oil bottles, foam textures, water droplets, ingredient icons, molecular structures.

**Layer 3 (Visual Atmosphere)**: Lighting style, color palette boundaries, aesthetic mood. Define parameters: color temperature (warm/cool), saturation levels (pastel/vibrant), lighting direction (top/side/diffused), depth-of-field zones.

**Layer 4 (Motion Language)**: Camera movements, element animations, transition styles that maintain brand coherence. Establish motion vocabulary: push-in speeds, float dynamics, pour physics, particle behaviors.

### Staged Narrative Architecture

Structure commercial videos as discrete narrative blocks with specific communicative intent:

**Stage Anatomy**: Each stage = \[Duration\] + \[Scene Setting\] + \[Hero Element\] + \[Camera Action\] + \[Messaging Overlay\]

**Temporal Distribution Logic**:

- Opening stage (0-20%): Establish product context, ritual integration
- Benefit stages (20-60%): Feature-specific scenes showcasing claims
- Experience stage (60-80%): Sensory details, texture closeups
- Authority stage (80-95%): Ingredient credibility, scientific backing
- Hero ending (95-100%): Brand recall freeze frame

**Transition Continuity**: Design seamless visual bridges between stages. Avoid hard cuts — use element persistence (product bottle travels through scenes), color fade-through (scene 1's lavender bleeds into scene 2), or motion continuation (pour action extends across stage boundary).

### Branded Messaging Overlay Framework

Text overlays must function as integrated design elements, not afterthoughts:

**Hierarchy System**:

- **Primary claim** (largest): Core brand promise, appears 1-2 times (e.g., "MAKE LUMO PART OF YOUR RITUAL")
- **Feature labels** (medium): Specific product benefits, appears 3-5 times (e.g., "SHINE & RADIANCE", "VOLUME & DENSITY")
- **Ingredient tags** (small): Technical credibility markers, appears 4-6 times (e.g., "BIOTIN", "COLLAGEN")
- **Brand lockup** (consistent): Logo + tagline in ending frame

**Placement Logic**: Position text to guide eye flow through the composition — lead-in text at frame entry points, benefit text adjacent to product, ingredient text near visual proof elements. Never obstruct the hero product.

**Temporal Pacing**: Display text 1.5-2.5 seconds per message. Shorter durations (1-1.5s) for simple ingredient tags, longer (2.5-3s) for complex claims. Stagger multi-line text with 0.3-0.5s delays between lines.

## Workflow

### 1. Preparation Stage

**Reference Image Analysis Checklist**:

- Identify the definitive product shot (clearest packaging view) as the master reference
- Extract all package text verbatim: brand name, product type, claims, ingredient callouts, volume
- Document package specifications: dimensions ratio, cap style, label layout zones, typography hierarchy
- Catalog scene elements by category: props (physical objects), textures (foam/liquid/fabric), atmospheric elements (droplets/bubbles/particles), ingredient graphics (icons/molecular chains)
- Define the visual system: color palette (hex values if possible), lighting quality (hard/soft), material finishes (matte/glossy/transparent)

**Narrative Stage Design**:

- Map user's intended message structure to temporal blocks
- Assign each stage a primary visual focus (wide scene / product closeup / detail macro / ingredient abstract)
- Define camera action per stage (static / slow push / orbit / vertical reveal)
- Plan transition mechanisms between stages (dissolve / element carry-through / motion continuation)

**Messaging Inventory**:

- List all text overlays by hierarchy tier (primary claim / features / ingredients / brand lockup)
- Assign each message to specific stage(s)
- Determine display duration per message based on word count and importance

### 2. Initial Design Stage

**Prompt Framework Structure**:

```
[@model:video_generation_model]
[@image:#1:master_product_reference:URL] [@image:#2:scene_element_A:URL] [@image:#3:scene_element_B:URL]...

Use image references 1-N as exact [product specifications], [scene elements], [visual system]. Create one continuous [duration]s [aspect_ratio] [language] product advertisement, not collage, not split screen, not slideshow.

Keep [package element A], [package element B], [text hierarchy] consistent: [verbatim package text].

Stage 1 ([time_range]): [scene description], [camera action], show "[messaging]".
Stage 2 ([time_range]): [scene description], [camera action], show "[messaging]".
...
Stage N ([time_range]): [scene description], [camera action], show "[messaging]".

[Audio direction, no voiceover].
```

**Multi-Reference Integration Strategy**:

- Lead with master product reference in prompt sequence
- Group related references (all scene props together, all texture details together)
- Use "exact" modifier for elements requiring pixel-perfect consistency (package, logo)
- Use "inspired by" modifier for atmospheric elements allowing artistic interpretation (foam patterns, lighting mood)

**Package Consistency Calibration**:

- Specify immutable elements explicitly: "lavender matte cylindrical flip-cap bottle", "label proportions", "package text"
- List all package text verbatim in the prompt to anchor text rendering
- Mention brand name multiple times throughout stages to reinforce visual consistency

### 3. Iteration Stage

**Product Identity Audit** (highest priority):

- \[ \] Package shape matches master reference (no morphing between stages)
- \[ \] Cap type consistent (flip/pump/screw remains same)
- \[ \] Label proportions preserved (logo size, text block ratios)
- \[ \] Brand text legible and correctly spelled in all appearances
- \[ \] Color system stable (no hue shifts beyond lighting variation)

**Narrative Pacing Optimization**:

- \[ \] Each stage duration feels complete (not rushed or dragging)
- \[ \] Transitions feel seamless (no jarring cuts)
- \[ \] Hero element clearly identifiable in each stage
- \[ \] Camera movements motivated and smooth
- \[ \] Final freeze frame provides strong brand recall

**Messaging Integration Check**:

- \[ \] All required text overlays present
- \[ \] Text hierarchy visually clear (size/weight/placement)
- \[ \] Text display durations adequate for readability
- \[ \] Text positioned to complement composition (not obstructing product)
- \[ \] Multi-line text properly staggered if needed

**Regeneration Triggers**:

- Package deformation or inconsistency across stages → regenerate with stronger product reference anchoring
- Missing or illegible text overlays → regenerate with explicit "show \[exact text\]" callouts per stage
- Disjointed stage transitions → regenerate with transition continuity instructions ("carry product through scenes", "maintain color palette")
- Unclear narrative flow → regenerate with revised stage sequence or simplified messaging

**Acceptance Criteria**:

- Product packaging recognizable and consistent throughout
- All narrative stages clearly delineated with appropriate pacing
- Text messaging fully integrated and legible
- Transitions feel continuous, not segmented
- Final frame provides strong brand lockup

## Key Constraints & Standards

### Immutable Product Rules

- **Package geometry**: Shape, proportions, cap style must never morph between frames
- **Brand text accuracy**: All package text must match reference spelling and layout exactly
- **Color identity**: Primary brand colors (e.g., lavender for LUMO) must persist within ±10% hue variance
- **Logo consistency**: Brand name size, font, placement must be frame-stable

### Narrative Structure Rules

- **No segmentation**: Explicitly state "not collage, not split screen, not slideshow" to prevent multi-panel layouts
- **Continuous flow**: Each stage must visually connect to the next (shared element, color bridge, motion continuation)
- **Stage duration minimum**: Each narrative block needs ≥2 seconds to register with viewer (shorter = rushed)
- **Hero ending requirement**: Final 10-15% of video must be a stable product showcase for brand recall

### Messaging Overlay Standards

- **Text hierarchy enforcement**: Primary claims 2-3× larger than feature labels, feature labels 1.5-2× larger than ingredient tags
- **Display duration by type**: Primary claims 2.5-3s, feature labels 1.5-2.5s, ingredient tags 1-1.5s
- **Readability threshold**: Text must be legible at 1080p resolution on mobile screens (minimum 32pt equivalent)
- **Non-obstruction rule**: Text overlays must never cover the product's brand name or key visual elements

### Visual Fidelity Rules

- **Reference count optimization**: 4-6 images provide sufficient visual anchoring without diluting consistency
- **Aspect ratio specification**: Always state aspect ratio explicitly (16:9 for landscape, 9:16 for vertical, 1:1 for social)
- **Language declaration**: State target language to ensure text rendering in correct script
- **Audio direction clarity**: Specify music style and explicitly state "no voiceover" if applicable to prevent audio mismatch

### Technical Quality Standards

- **Video duration precision**: State exact duration in seconds (not ranges) for predictable output length
- **Camera motion vocabulary**: Use industry terms (push-in, pull-out, orbit, tilt, static) for consistent movement interpretation
- **Transition style specification**: Define transition mechanisms (dissolve, fade-through, element carry) if critical to narrative
- **Final frame instruction**: Explicitly call out "final freeze on \[composition\]" to ensure clean ending

## Recommended Tools & Models

Use **MiniMax-Hailuo-H3** for high-fidelity commercial video generation with strong multi-reference image adherence and text overlay capabilities.

## Example

**Scenario**: 15-second LUMO shampoo advertisement with 6 reference images covering product packaging, spa scene props, foam textures, ingredient graphics.

**Stage Breakdown**:

- **0-3s**: Wide spa scene, product centered with props (towel, basket, botanicals), slow push-in, overlay "MAKE LUMO PART OF YOUR RITUAL"
- **3-6s**: Lavender background, product + foam elements, static composition, overlay "HAIR THAT HOLDS POWER" + feature list
- **6-9s**: Macro of open cap, foam/droplets in motion, subtle camera drift, overlay "FEEL THE PLEASURE OF USING IT" + texture descriptors
- **9-12s**: Product pouring lotion, ingredient icons float in, slight tilt up, overlay "INSPIRED BY THE SEA, POWERED BY SCIENCE" + ingredient tags
- **12-15s**: Hero ending on lavender science background, molecular chains, product centered, static, overlay "CLEAN SCIENCE FORMULA" + "LUMO" brand lockup

**Transition Logic**: Product bottle travels through all scenes (element persistence), lavender color bleeds between stages 2-5 (color bridge), pour motion extends from stage 4 into stage 5 background (motion continuation).

**Text Overlay Timing**: Primary claim (3s), feature list (3s total with 0.5s stagger per line), texture descriptors (3s total with 0.3s stagger), ingredient tags (3s total with individual 1s displays), brand lockup (3s freeze).