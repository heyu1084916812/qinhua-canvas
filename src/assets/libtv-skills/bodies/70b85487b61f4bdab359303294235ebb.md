# Shinkai Makoto Color Grading

## Core Methodology

### Luminosity Architecture Framework

The Shinkai color grading system operates on **layered luminosity zones**, not flat color replacement. Every pixel exists in one of four lighting zones:

- **Zone 1 (Primary Light Source)**: Direct sunlight/window light — saturated warm tones (golden/amber), high luminance values (80-100% brightness), glowing translucent quality
- **Zone 2 (Ambient Fill Light)**: Environmental bounce light in shadows — cool desaturated tones (blue/cyan/lavender), medium-high luminance (60-80%), prevents muddy/dead blacks
- **Zone 3 (Rim Light)**: Backlighting on edges/hair — hyper-saturated warm or cool (depends on light source angle), creates separation from background
- **Zone 4 (Core Shadow)**: Deepest shadow areas — still maintain 40-60% luminance, subtle color shift (never pure black/gray)

**Critical principle**: Shadows are NOT absence of light — they are colored, luminous, and atmospheric.

### Color Temperature Polarity System

Shinkai's visual signature relies on **maximum thermal contrast** within naturalistic boundaries:

- **Warm pole** (sunlight, interior lamps): Shift toward yellow-orange (Kelvin 3500-5500K), increase saturation +20-40% from realistic baseline
- **Cool pole** (sky, walls, fabric in shadow): Shift toward cyan-blue (Kelvin 6500-9000K), increase saturation +30-50%
- **Transition zones**: Use gradient blending, not hard cuts — 3-5 step gradations between temperature poles
- **Saturation boost rule**: Overall image saturation increases 25-40% compared to photorealistic rendering, but stays below "neon/oversaturated" threshold

### Material Response Framework

Each material type requires specific color grading treatment:

**Skin**:

- Base tone: peachy-pink with subtle yellow undertone in light, lavender-blue undertone in shadow
- Subsurface scattering: visible glow in ears/nose/fingertips where backlit
- Highlight: sharp specular on nose/forehead, warm-shifted (never pure white)

**Hair**:

- Light zones: individual strand separation with edge glow (rim light)
- Shadow zones: maintain translucency — never solid opaque blocks
- Color shift: warm tones in light pick up amber, cool tones in shadow pick up blue-violet

**Fabric/Clothing**:

- Texture preservation: fine weave/fiber detail stays visible even in shadow
- Fold shadows: cool-shifted and luminous (not black creases)
- Reflectivity: cotton/linen shows diffuse glow, silk/satin shows specular highlights

**Environmental surfaces** (walls, floors, furniture):

- Bounce light mapping: surfaces facing light source get warm wash, perpendicular surfaces get cool ambient
- Texture granularity: wood grain, wall texture, paper fibers remain visible across all lighting zones

## Workflow

### 1. Preparation Stage

**Input asset checklist**:

- Source image (any illustration style) — must have clear subject separation from background
- Intended lighting scenario — time of day (golden hour/midday/blue hour), indoor/outdoor, primary light direction
- Aspect ratio target (original/9:16/16:9)

**Pre-analysis audit**:

1. Identify current image's darkest shadow areas — these will become Zone 4 (core shadow) and must be lifted +40-60 luminance points
2. Map existing light sources — determine which should become Zone 1 (primary warm) vs Zone 2 (ambient cool)
3. Inventory material types (skin, hair, fabric, hard surfaces) — each needs differentiated treatment

**Key decisions before starting**:

- Primary color temperature (warm-dominant vs cool-dominant scene) — determines which lighting zone gets higher saturation
- Rim light placement (backlight angle) — usually 135-180° from camera view for maximum edge glow
- Shadow color bias (blue-violet vs cyan vs lavender) — depends on scene context (outdoor sky = blue-cyan, indoor = lavender-gray)

### 2. Initial Color Grading Stage

**Execution approach**:

Use image-to-image generation with dual reference strategy:

1. **Structure reference**: Original image locked at high fidelity (0.7-0.85 reference strength) to preserve composition, pose, facial features
2. **Color grading prompt**: Comprehensive style descriptor focusing on luminosity and color temperature

**Prompt framework structure**:

```
[Source preservation directive] + [Shinkai color signature] + [Luminosity specifications] + [Material-specific treatments] + [Atmospheric elements]
```

Example breakdown:

```
Preserve all composition, character design, pose, and scene layout from source image. 
Re-render in vivid luminous Makoto Shinkai color grading: high-key lighting with no dark/muddy tones, 
crisp saturated blue-sky cool tones contrasting with golden warm sunlight, 
glowing translucent highlights on skin and hair with visible rim light, 
ambient bounce light filling all shadows (60%+ luminance floor), 
sharp clean linework with soft painterly color gradients, 
cinematic yet bright and airy atmosphere.
```

**Calibration checkpoints**:

- Shadow luminance test: No pure blacks — histogram should show no pixels below 30% brightness
- Saturation delta: Overall image should feel +30-40% more vibrant than photorealistic render, but still "naturalistic"
- Temperature contrast: Warmest area (sunlight) and coolest area (shadow) should be 3000-5000K apart

### 3. Iteration Stage

**Optimization dimension: Luminosity Balance**

If output appears too dark/muddy:

- Increase ambient fill light intensity: "brighter bounce light in shadows, 70% minimum luminance"
- Reduce shadow density: "no areas darker than 40% brightness, luminous shadow detail"
- Add atmospheric haze: "subtle atmospheric glow, visible light rays"

If output appears washed out:

- Increase shadow color saturation: "richer blue-purple undertones in shadow areas"
- Strengthen core shadow definition: "preserve form with deeper (but still luminous) shadow"

**Optimization dimension: Color Temperature Polarity**

If warm-cool contrast is weak:

- Amplify warm pole: "more golden-amber sunlight glow, increased yellow-orange saturation"
- Amplify cool pole: "deeper cyan-blue ambient light, cooler shadow color shift"
- Widen temperature gap: "maximum thermal contrast between sunlight and shadow zones"

If colors feel artificial/oversaturated:

- Reduce saturation ceiling: "vibrant but naturalistic, not neon/fluorescent"
- Add color variation: "subtle gradient transitions, avoid flat color blocks"

**Optimization dimension: Material Fidelity**

If skin looks plastic/over-smooth:

- Add subsurface detail: "visible skin texture, subtle pore detail, natural imperfection"
- Enhance subsurface scattering: "translucent glow in backlit areas (ears, fingers, nose)"

If hair lacks depth:

- Increase strand separation: "individual hair strand definition with edge highlights"
- Boost rim light: "glowing hair edges with warm/cool backlight"

If fabric appears flat:

- Preserve weave texture: "visible fabric weave, textile grain detail"
- Define fold shadow: "luminous creases with cool color shift, not black folds"

**Cross-output consistency audit** (when processing multiple images):

1. Color temperature anchors: Sun/primary light source must maintain same Kelvin value across all frames
2. Shadow floor luminance: Core shadow brightness should stay within ±5% across batch
3. Saturation boost level: Overall vibrance increase must be uniform (test: pick 3 random pixels from each zone, compare HSV values)

**Iteration acceptance criteria**:

- ✅ Accept when: Shadows show visible color and detail, warm-cool contrast is vivid but believable, highlights glow without clipping, materials show appropriate texture response
- ❌ Regenerate when: Any shadow area is pure black/gray, colors feel flat/washed-out, skin looks plastic, hair appears as solid mass, composition/pose has drifted from source

## Key Constraints & Standards

### Immutable Rules (Never Violate)

**Luminance Floor Constraint**: No pixel in the final image may have brightness value below 30% (in 0-100% scale). Even the deepest shadows must remain visible and colored. Test: Convert image to grayscale histogram — if spike appears at 0-30% range, regenerate with "brighter ambient fill light, 60% minimum shadow luminance."

**Color Temperature Delta Constraint**: The difference between warmest zone (sunlight) and coolest zone (shadow) must be minimum 3000K, maximum 6000K. Below 3000K reads as flat/boring. Above 6000K reads as unnatural/artificial. Test: Sample RGB values from brightest warm area and darkest cool area, convert to Kelvin — adjust if outside range.

**Composition Lock Constraint**: Original image's character design, facial features, pose, camera angle, and scene layout are immutable. Only lighting, color, and atmospheric effects may change. Test: Overlay source and output at 50% opacity — silhouettes and feature positions should align perfectly.

### Fidelity Rules (Quality Thresholds)

**Saturation Boost Threshold**: Overall image saturation increases by 25-40% compared to photorealistic baseline, measured as average HSV saturation across all pixels. Below 25% = insufficient Shinkai character. Above 50% = crosses into oversaturated/neon territory. Test: Export color palette from output, compare to source — should see clear vibrancy increase without "burned" appearance.

**Rim Light Visibility Standard**: Hair edges and backlit contours must show visible glow with width of 2-5 pixels (at 1024px image width). Glow must be warm-shifted (for sunlight) or cool-shifted (for sky/ambient) per scene logic. Test: Zoom to 200% on hair edges — should see gradient halo, not hard cutoff.

**Gradient Smoothness Standard**: Color transitions between lighting zones require 3-5 intermediate steps for smooth painterly effect. Hard boundaries are only acceptable at material edges (e.g., clothing seam). Test: Pick color transition area, count distinct color bands — should see gradual shift, not posterized steps.

**Material Texture Retention**: Fine details (skin pores, fabric weave, wood grain, paper texture) must remain visible even in shadow zones. Texture should not be obliterated by color grading. Test: Zoom to 150% on shadow areas — should still see material surface detail, not smooth color fills.

### Consistency Rules (Multi-Image Batches)

**Color Anchor Consistency**: When processing multiple images in a series, primary light source Kelvin temperature, shadow base color, and saturation boost percentage must remain constant. Test: Sample same material type (e.g., skin highlight) across 3 images — RGB values should be within ±10 points.

**Aspect Ratio Adaptation Rule**: When changing aspect ratio (e.g., source is 1:1, output is 9:16), composition must expand logically — add more sky/ceiling at top, more floor/ground at bottom, never crop character. Test: Character should occupy same proportional screen space (e.g., if head was 1/4 from top in source, keep that ratio in 9:16).

## Example

**Scenario**: Convert a semi-realistic digital illustration (warm muddy lighting, low saturation, 1:1 square format) of a pink-haired girl studying at a desk into Shinkai style 9:16 vertical format.

**Source analysis**:

- Current state: Warm yellow lighting from desk lamp, deep brown shadows, muted colors, single light source
- Target state: Bright window light from right, blue-tinted walls, luminous shadows, high saturation, cool-warm contrast

**Execution**:

1. **Preparation**: Identify Zone 1 (window sunlight, right side), Zone 2 (ambient room fill, left side), Zone 3 (rim light on hair), Zone 4 (under desk/behind objects). Decide on warm-dominant scene (golden sunlight &gt; cool ambient).

2. **Initial prompt**:

```
Re-render this illustration in luminous Makoto Shinkai color style, 9:16 vertical format: 
preserve character design, pose, desk scene, all objects; 
bright high-key lighting with vivid cool-warm contrast — 
golden sunlight streaming from right side window (3500K warm), 
blue-tinted walls and ambient room light (7000K cool), 
glowing translucent highlights on pink hair with visible rim light, 
skin with peachy-pink tone and subsurface glow, 
all shadows filled with luminous blue-lavender bounce light (60% minimum brightness), 
no dark/muddy tones, crisp saturated colors with painterly gradients, 
cinematic bright airy atmosphere, 
expand composition vertically to show more ceiling and floor while keeping character centered.
```

3. **First output check**:

- ✅ Warm sunlight from right is vivid and golden
- ✅ Walls shifted to blue, shadows are luminous
- ❌ Hair lacks rim light glow
- ❌ Under-desk area still too dark (35% luminance)

4. **Iteration prompt**:

```
Enhance: stronger glowing rim light on hair edges with golden backlight, 
brighter under-desk area with blue bounce light (60% minimum luminance), 
maintain all other color grading improvements.
```

5. **Final output validation**:

- Luminance floor test: Histogram shows no values below 30% ✅
- Temperature contrast: Sunlight area \~4000K, shadow area \~7500K (3500K delta) ✅
- Rim light: 3-pixel golden glow visible on hair edges ✅
- Composition: Character size ratio preserved, vertical space expanded logically ✅

**Result**: Transformed image has Shinkai's signature bright, vibrant, cinematically-lit aesthetic while preserving all original design elements.

## Advanced Techniques

### Atmospheric Light Ray Injection

For scenes with strong directional light (window, doorway), add visible volumetric light rays:

- Technique: "visible atmospheric light rays, subtle god rays through window, dust particles catching sunlight"
- Constraint: Rays must align with primary light source direction (test: ray angle should match highlight direction on character)
- Saturation rule: Light rays themselves are 20-30% desaturated compared to direct highlights (prevents oversaturation)

### Adaptive Shadow Color Selection

Shadow base color should respond to scene context, not default to generic blue:

- Outdoor daylight: Cyan-blue (sky reflection)
- Indoor warm lighting: Lavender-gray (complementary to warm light)
- Sunset/golden hour: Purple-pink (complementary to orange)
- Overcast: Desaturated blue-gray

Test method: Pick shadow area, check hue angle — should show clear color bias, not neutral gray.

### Multi-Layer Color Grading for Complex Scenes

When scene has 3+ distinct lighting zones (e.g., foreground character, midground objects, background environment):

1. Apply base Shinkai color grading to entire image
2. Add secondary prompt: "foreground character receives stronger rim light and higher saturation, background slightly desaturated and cooler for depth"
3. Validate depth separation: Foreground should be 10-15% more saturated than background

This creates cinematic depth-of-field effect through color, not blur.