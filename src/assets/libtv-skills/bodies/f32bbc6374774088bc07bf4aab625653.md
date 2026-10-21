# Cinematic 3D Ink-Wash Rendering

## Core Methodology

### Dimensional Fusion Architecture — Physical Geometry + Traditional Ink Aesthetics

3D ink-wash rendering merges digital 3D modeling physics with traditional Chinese ink painting aesthetics through four integrated layers:

- **Layer 1 (Geometric Foundation)**: True volumetric 3D models — cliff faces as polygonal meshes, fabric as simulated cloth physics, wood as cylindrical structures with edge definition
- **Layer 2 (Surface Materiality)**: Replace smooth CG surfaces with matte physical textures — carved stone, raw linen, mineral pigment granularity. Eliminate reflective plastic sheen entirely
- **Layer 3 (Ink Stroke Integration)**: Apply traditional calligraphy brushwork as 3D surface details — dry-brush side-scratching (侧锋皴擦) for rock faces, flying white (飞白) for fabric edges, controlled ink diffusion for atmospheric perspective
- **Layer 4 (Cinematic Lighting Rig)**: High-contrast lighting system — rim lighting for subject edge definition, volumetric atmosphere for depth separation, cold diffuse overhead for dramatic moodiness

Critical insight: The 3D aspect must provide structural volume and lighting physics, while the ink-wash aesthetic supplies textural language and tonal restraint. Neither dominates — they coexist as integrated material properties.

### Controlled Environmental Dynamics — Wind Force Stratification

Wind dynamics are the primary differentiation factor between 2D illustration and physically plausible 3D. Establish a three-tier wind force system:

- **Tier 1 (Gentle Mountain Breeze)**: Hair strands shift 5-15 degrees from vertical, robe hems lift slightly at edges, natural draping weight preserved. Use for contemplative or solemn scenes
- **Tier 2 (Gusting Wind)**: Hair fully horizontal, fabric reveals body silhouette beneath, visible tension in held objects like staffs. Use for dramatic emotional peaks
- **Tier 3 (Prohibited: Hurricane Force)**: Fabric vertical or skyward, flag-like flapping, loss of weight physics. This destroys the aesthetic — explicitly forbid in all prompts

Key constraint: Default to Tier 1 unless narrative context demands Tier 2. The user's correction "过于2D" was NOT requesting more wind — it was requesting better lighting and material definition.

### Tri-Layer Depth Architecture — Spatial Separation Through Focus Gradient

Cinematic depth requires three distinct focal planes:

- **Foreground (Z-depth 0-30%)**: Environmental framing elements (cliff edges, tree branches) rendered with subtle defocus blur, darker tonal values, serves as compositional anchor
- **Midground (Z-depth 30-60%)**: Subject positioning plane — sharpest focus, highest contrast, primary lighting concentration. This is where character action occurs
- **Background (Z-depth 60-100%)**: Atmospheric perspective layers (distant mountains, cloud banks) progressively desaturated toward grey-blue, increasing blur gradient, cold diffuse backlighting

Execution method: Explicitly specify depth relationships in prompts using distance-based language ("foreground cliff edge blurred", "midground figure in sharp focus", "distant mountains fading into grey mist").

## Workflow

### 1. Preparation Stage

**Subject & Historical Accuracy Specification**

- Define historical period costume details (Tang Dynasty: cross-collar robe, topknot hairstyle)
- Identify held objects and their material properties (wooden staff: rough grain, cylindrical form, specific diameter)
- Document forbidden elements from the start (text, seals, warm lighting, plastic textures)

**Environmental Architecture Blueprint**

- Scene type: cliff edge, mountaintop, riverbank, bamboo forest interior
- Rock formation characteristics: jagged, weathered, stratified layers
- Atmospheric conditions: overcast sky (preferred), breaking clouds, distant fog banks

**Wind Force & Pose Decision**

- Select Tier 1 or Tier 2 wind intensity based on emotional tone
- Define static pose foundation (standing, sitting, back-turned)
- Decide fabric interaction points (where wind contacts robe)

### 2. Initial Design Stage

**Prompt Framework Structure**

\[Aspect Ratio Declaration\] + \[Core Rendering Style\] + \[Material Override Instruction\] + \[Subject Description with Costume Detail\] + \[Environmental Setting with Depth Layers\] + \[Wind Physics Specification\] + \[Lighting Configuration\] + \[Color Palette Constraint\] + \[Prohibition List\]

Example execution:

```
Cinematic ultrawide 2.35:1, film-grade 3D ink-wash rendering, high-contrast cold grey-blue monochrome.
Completely remove Xuan paper texture overlay, apply matte 3D miniature diorama physical materials.

Liu Zongyuan in dark grey cross-collar robe, loose topknot, holding rough wooden staff, standing on jagged grey cliff edge.
Gentle mountain breeze: hair strands shift 10 degrees, robe hem lifts slightly at edges, natural draping weight preserved.

Foreground cliff edge with sharp dry-brush side-scratching texture, slightly defocused.
Midground figure in sharp focus with rim light defining silhouette edges.
Background distant grey mountains fading into cold mist, strong diffuse backlight breaking through clouds.

Extremely cold tone, no warm colors.
Strictly forbidden: any text, calligraphy, seals, AI garbled characters, plastic CG sheen, exaggerated billowing fabric.
```

**Critical Calibration Points**

- Verify material language appears early in prompt ("matte 3D miniature diorama materials" before subject description)
- Confirm wind description includes specific physics constraints ("natural draping weight preserved")
- Ensure depth layer separation is spatially explicit ("foreground", "midground", "background" labels)
- Double-check prohibition list completeness (text, seals, warmth, plastic, Xuan paper)

### 3. Iteration Stage

**Dimensional Quality Audit Checklist**

Evaluate generated output across these specific criteria:

✓ **Light-to-Shadow Transition Lines**: Do fabric folds, cliff edges, and cylindrical objects show clear light/dark boundaries? (The user's "过于2D" correction indicates this was missing) ✓ **Material Specular Response**: Are surfaces matte with mineral/stone/fabric granularity? Zero plastic highlights? ✓ **Depth Focus Gradient**: Can you visually distinguish three separate depth planes by sharpness? ✓ **Wind Physics Believability**: Does fabric movement respect gravity while showing air pressure? ✓ **Rim Light Edge Definition**: Is the subject's silhouette clearly separated from background by edge lighting? ✓ **Stroke Texture Integration**: Do rock surfaces show calligraphic brushwork as physical relief, not flat texture overlay?

**Problem-Specific Corrections**

If output appears flat (2D):

- Add explicit "chiaroscuro lighting" language
- Strengthen "volumetric rim light" specification
- Increase depth layer separation distance
- Emphasize "matte physical relief texture" in material description

If wind dynamics are excessive:

- Replace generic "wind" with "gentle breeze" or "light mountain wind"
- Add explicit prohibition: "no flag-like flapping, no typhoon-level force"
- Specify physics constraints: "fabric retains natural weight and drape"

If material quality is too smooth/plastic:

- Front-load material override: place "matte 3D miniature materials" in first sentence
- Add surface texture vocabulary: "carved stone", "raw linen", "mineral pigment granularity"
- Explicitly prohibit: "no smooth CG surfaces, no reflective sheen"

**Batch Production Consistency Strategy**

When generating series of images (different angles, different scenes):

- Lock immutable elements: color palette (cold grey-blue), material system (matte physical), prohibition list
- Systematically vary: camera angle (eye-level, low-angle, overhead), depth composition (close-up vs wide), wind intensity tier
- Maintain identity anchors: costume style, character proportions, rock formation aesthetic
- Generate 3-5 variations per angle type before changing environmental setting

## Key Constraints & Standards

### Immutable Aesthetic Rules

- **Color Palette Constraint**: Strictly black, white, grey, cold grey-blue. Zero warm tones (no yellow fog, no orange light, no sunset hues). Violation of this rule breaks the entire ink-wash aesthetic.
- **Material System Override**: All surfaces must be matte physical materials (carved stone, raw fabric, mineral pigment). Eliminate smooth CG surfaces and reflective plastic sheen. This is the primary differentiator between "3D" feeling and "2D" flatness.
- **Text Prohibition**: Absolutely no Chinese characters, calligraphy, seals, signatures, or AI-generated garbled text anywhere in frame. Historical scenes should never include written language overlays.

### Wind Physics Fidelity Standards

- **Default Wind Force**: Tier 1 (Gentle Mountain Breeze) — hair shifts 5-15 degrees, robe hems lift slightly, natural draping weight preserved
- **Maximum Wind Force**: Tier 2 (Gusting Wind) — hair horizontal, fabric reveals body silhouette, no skyward flapping
- **Prohibited Force Levels**: Hurricane, typhoon, flag-like flapping, fabric pointing skyward, loss of gravity physics
- **Constraint Trigger**: If prompt uses word "wind" without qualifier, default to Tier 1. Escalate to Tier 2 only if narrative context explicitly demands drama.

### Dimensional Depth Requirements

- **Three-Layer Spatial Separation**: Every composition must have distinguishable foreground (blurred environmental frame), midground (sharp subject focus), background (atmospheric perspective fade)
- **Focus Gradient Specification**: Sharpness must decrease progressively from midground to background. No uniform focus across all depth planes.
- **Lighting Depth Cues**: Rim lighting must create edge separation between subject and background. Volumetric atmosphere should be visible in background layers.

### Historical Costume Accuracy (When Applicable)

- **Tang Dynasty Specification**: Cross-collar robe (交领), topknot hairstyle (束发), no buttons (use fabric ties)
- **Material Plausibility**: Rough-woven linen or hemp texture for robes, not silk sheen unless specifically noble character
- **Held Object Materiality**: Wooden staff must show grain and roughness, not smooth dowel rod

### Texture Integration Standards

- **Dry-Brush Calligraphy Strokes**: Rock surfaces must show sharp side-scratching strokes (侧锋皴擦) as physical relief texture, not flat painted pattern
- **Flying White Technique**: Fabric edges and hair strands should have broken, feathered quality (飞白) showing brush lift-off, not continuous solid lines
- **Surface Granularity**: Close-up surfaces require visible mineral or fiber texture at pixel level — test by checking if texture holds up under 200% zoom

### Cinematic Format Standards

- **Aspect Ratio**: Default to 2.35:1 ultrawide for cinematic drama, use 16:9 for standard compositions, avoid square formats
- **Lighting Contrast Ratio**: Maintain high contrast (dark shadows vs bright highlights) for sculptural volume, avoid flat even lighting
- **Atmospheric Density**: Background layers should have visible atmospheric haze or fog for depth, not sharp clarity extending to horizon

## Example

**Scenario**: Generate a Tang Dynasty poet standing at mountain cliff edge, back to camera, in cinematic 3D ink-wash style

**Preparation Decisions**:

- Historical period: Tang Dynasty (618-907 CE) → cross-collar dark grey robe, loose topknot
- Emotional tone: Contemplative solitude → Tier 1 wind (gentle), back-turned pose
- Environment: Cliff edge with jagged rocks, distant mountains, breaking cold light
- Prohibitions: No text, no seals, no warm colors, no plastic materials

**Initial Prompt**:

```
Cinematic ultrawide 2.35:1, film-grade 3D ink-wash rendering, high-contrast cold grey-blue monochrome. Completely remove Xuan paper texture, apply matte 3D miniature diorama physical materials.

Liu Zongyuan in dark grey cross-collar robe, loose topknot, holding rough wooden staff, standing on jagged grey cliff edge, back to camera. Gentle mountain breeze: hair strands shift 10 degrees, robe hem lifts slightly, natural draping weight preserved.

Foreground cliff edge with sharp dry-brush side-scratching, slightly defocused. Midground figure in sharp focus with strong rim light defining silhouette. Background distant grey mountains fading into cold mist, diffuse backlight breaking through clouds.

Extremely cold tone. Strictly forbidden: text, seals, plastic sheen, exaggerated wind.
```

**First Generation Result**: Output appears too flat, lacks 3D volume

**Diagnosis**: Insufficient lighting specification for volumetric definition, material override language too weak

**Iteration Prompt**:

```
[Keep all previous elements, modify these sections:]

Strong chiaroscuro lighting with clear light-to-shadow transition lines on fabric folds and cliff edges. Volumetric rim light carving out figure silhouette from background. Robe shows physical drapery weight with deep shadow cores in fold valleys. Cliff rock surface displays carved stone relief texture with dry-brush calligraphy strokes as actual 3D geometry, not flat painting.

Matte physical materials: carved stone for rocks, raw linen weave for robe, mineral pigment granularity. Zero smooth surfaces, zero reflective highlights.
```

**Second Generation Result**: Volume improved significantly, wind dynamics appropriate, depth separation clear

**Acceptance Criteria Met**: ✓ Clear shadow transition lines, ✓ Matte material granularity, ✓ Three-layer depth separation, ✓ Rim light edge definition, ✓ Controlled Tier 1 wind physics

## Advanced Techniques

### Volumetric Atmospheric Perspective Control

For long-distance mountain scenes, create atmospheric depth through progressive tonal desaturation:

- **Near mountains (30-50% depth)**: Medium grey, 60% detail retention, soft edges
- **Mid mountains (50-75% depth)**: Light grey-blue, 30% detail retention, very soft edges
- **Far mountains (75-100% depth)**: Pale blue-grey, &lt;10% detail (silhouette only), dissolved edges

Implementation: Specify "three-layer mountain range" in prompt with explicit tonal progression language.

### Dynamic Camera Angle Vocabulary

**Low-Angle (Heroic Framing)**: "Camera positioned at waist height looking upward, subject towers against sky, cliff edge creates dramatic diagonal leading line, strong underlight rim on figure"

**High-Angle (Contemplative Isolation)**: "Overhead crane shot looking down 45 degrees, subject small in frame surrounded by vast cliff environment, emphasizes spatial isolation"

**Over-Shoulder Depth**: "Camera behind subject's left shoulder, face partially visible in three-quarter profile, gaze directed toward distant mountains, foreground shoulder defocused"

### Stroke Texture Hybrid Technique

For maximum ink-wash authenticity while preserving 3D volume:

1. Generate base image with strong 3D lighting and materials (matte, physical)
2. In prompt, specify "dry-brush calligraphy strokes as surface relief texture" — this makes the AI apply brushwork as geometric detail rather than flat overlay
3. Add negative prompt: "flat painted texture, 2D ink illustration, watercolor paper overlay" to prevent decorative texture application
4. Result: Brushwork appears as carved or embossed surface variation that responds to lighting like true 3D geometry

### Batch Angle Expansion Strategy

When producing multiple views of same scene:

- **Base Anchor (1 image)**: Establish the canonical view — usually back-turned or three-quarter profile at eye level
- **Angle Variations (2-3 images)**: Front view (rare, use for dramatic confrontation), full side profile, high-angle overhead
- **Environmental Variations (2-3 images)**: Same character pose in different cliff formations, different atmospheric conditions (heavy fog vs clear), different depth compositions (close-up vs wide)
- Total batch: 5-7 images maintaining character costume, wind tier, color palette, and material system as locked constants