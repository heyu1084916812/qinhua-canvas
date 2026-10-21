# E-commerce Product Poster Style Replication

## Core Methodology

### 1. Style Transfer Framework

E-commerce poster design requires extracting visual language from reference images and applying it to target products through structured prompt architecture:

**Visual DNA Extraction System**

- **Scene atmosphere layer**: Environmental tonality (natural outdoor / studio setup / lifestyle context), lighting quality (soft diffused / hard directional / ambient), color temperature (warm/cool bias)
- **Compositional structure layer**: Product placement logic (centered hero / rule-of-thirds / diagonal dynamics), spatial depth strategy (flat graphic / shallow DOF / deep environmental), supporting element hierarchy
- **Stylistic signature layer**: Photography technique (close-up macro / medium product shot / wide lifestyle), post-processing aesthetic (clean minimal / vibrant saturated / moody desaturated), material rendering quality

**Application Logic**: Reference image → Visual DNA extraction → Prompt framework construction → Product-specific adaptation

### 2. Product Identity Preservation Logic

Critical constraint: The source product's physical attributes must remain pixel-locked invariant across all generated variants.

**Immutable Product Dimensions**

- **Geometric integrity**: Product aspect ratio, proportional relationships between package elements (logo size relative to can height, label width relative to bottle diameter)
- **Brand identity markers**: Logo placement, typography treatment, color scheme (PMS color fidelity), graphic patterns
- **Material properties**: Surface finish (matte/glossy), texture detail, transparency/opacity characteristics
- **Structural details**: Can rim profile, bottle cap design, label edge treatment

**Preservation Technique**: Use product white background image as primary input with high reference weight. Prompt must explicitly state "maintain product's original proportions and appearance exactly as provided, only change surrounding environment and compositional context."

### 3. Multi-Model Comparative Generation Strategy

Different AI models exhibit distinct strengths in rendering quality, style interpretation, and consistency. Systematic comparison reveals optimal model selection for specific aesthetic requirements.

**Model Performance Dimensions**

- **Lib Image**: Fast iteration, strong product identity lock, suitable for rapid prototyping
- **General Image V2**: Balanced photorealism and artistic interpretation, good environmental coherence
- **General Image Pro**: Enhanced detail rendering, superior lighting simulation, premium output quality
- **Seedream 5.0 Pro**: Strongest creative interpretation, best atmospheric effects, highest stylistic fidelity to reference

**Batch Testing Protocol**: Generate identical prompt across all 4 models simultaneously → Comparative evaluation across consistency, aesthetic quality, reference alignment → Select optimal model for production batch

### 4. Contextual Element Generation Framework

Surrounding elements must be product-appropriate and reinforce brand messaging while maintaining visual hierarchy.

**Element Selection Logic**

- **Product category association**: Beverage → ice cubes, water splash, condensation droplets, fresh fruit/herbs matching flavor profile
- **Brand positioning**: Premium → minimalist staging, controlled lighting, refined material surfaces; Mass market → energetic composition, vibrant color accents, lifestyle context
- **Seasonal/campaign context**: Summer → bright natural light, outdoor settings, cooling visual cues; Winter → warm indoor ambiance, cozy props, steam effects

**Hierarchy Enforcement**: Product occupies 40-60% of frame area, supporting elements in 30-40% range, negative space 10-20% for visual breathing room

## Workflow

### 1. Preparation Stage

**Required Asset Checklist**

- ✅ Product white background image (PNG with transparency preferred, minimum 1500px on longest side)
- ✅ Reference style image(s) for visual direction
- ⚠️ Product specification sheet (dimensions, material details, brand color codes) if available

**Pre-Generation Decision Points**

1. **Text overlay requirement**: Pure visual poster OR text-integrated design (title, product claims, CTA)
2. **Output aspect ratio selection**:
   - 3:4 (vertical) → Mobile e-commerce main image, social media story format
   - 4:3 (horizontal) → Desktop banner, landscape product display
   - 9:16 (vertical) → Full-screen mobile ad, video cover frame
   - 16:9 (horizontal) → Wide banner, presentation slide, video thumbnail
   - 1:1 (square) → Social media feed post, thumbnail grid
   - Custom ratio → Specific platform requirements
3. **Generation model selection**: Single model for consistency OR multi-model comparison for quality evaluation

**Visual Language Analysis**: Examine reference image(s) and document:

- Dominant color palette (primary, secondary, accent colors)
- Lighting setup (direction, softness, color temperature)
- Compositional structure (product placement, supporting elements, spatial depth)
- Atmospheric qualities (mood, energy level, visual tone)

### 2. Initial Design Stage

**Prompt Framework Construction**

Structure: `[Scene Description] + [Product Integration Statement] + [Style Directives] + [Technical Specifications]`

Example breakdown:

```
Scene Description:
"Natural outdoor setting with blue sky background, fresh green plants (mint leaves, bamboo shoots), moss-covered wooden log surface, shallow depth of field creating soft bokeh in background"

Product Integration Statement:
"Product: [brand name] [product type] in original packaging, positioned at center-right following rule of thirds, maintain product's exact proportions and all brand elements (logo, label design, colors) precisely as provided in source image"

Style Directives:
"Photography style: Professional e-commerce product shot, soft diffused natural lighting from top-left, clean fresh aesthetic with emphasis on natural ingredients, vibrant but not oversaturated color palette"

Technical Specifications:
"High resolution, photorealistic rendering, sharp focus on product with gradual background blur, commercial photography quality"
```

**Multi-Model Parallel Execution**

If testing multiple models, generate identical prompt across all selected models simultaneously to enable direct comparison. Track generation parameters:

- Model name
- Aspect ratio
- Seed value (for reproducibility)
- Generation timestamp

**Initial Quality Evaluation Criteria**

- ✅ Product identity preserved (proportions, colors, brand elements intact)
- ✅ Reference style successfully transferred (lighting, composition, atmosphere match)
- ✅ Supporting elements appropriate and well-integrated
- ✅ Technical quality meets commercial standards (resolution, sharpness, color accuracy)

### 3. Iteration Stage

**Refinement Dimension Matrix**

**Dimension 1: Product Fidelity Adjustment**

- Issue: Product proportions distorted → Increase product reference weight, add explicit dimensional constraints to prompt
- Issue: Brand colors shifted → Specify exact color values in prompt (e.g., "Pantone 485 C red"), verify model color accuracy
- Issue: Label details lost → Request higher resolution generation, emphasize "maintain all text and graphic details on product packaging"

**Dimension 2: Compositional Refinement**

- Issue: Product too small/large in frame → Adjust framing instructions ("product fills 50% of frame height")
- Issue: Supporting elements compete with product → Simplify element count, reduce visual weight of secondary elements
- Issue: Composition lacks balance → Apply compositional rules explicitly ("position product at golden ratio intersection point")

**Dimension 3: Atmospheric Adjustment**

- Issue: Lighting too harsh/flat → Specify lighting quality ("soft morning light", "diffused studio lighting with fill")
- Issue: Color palette doesn't match brand → Provide explicit color direction ("cool blue-green palette with white accents")
- Issue: Mood/energy mismatch → Adjust scene descriptors ("energetic dynamic" vs "calm serene")

**Dimension 4: Style Alignment**

- Issue: Output diverges from reference → Strengthen reference image influence, extract and emphasize specific reference attributes in prompt
- Issue: Over-stylization compromises realism → Add "photorealistic", "commercial photography" constraints
- Issue: Insufficient creative interpretation → Reduce technical constraints, allow more model creative freedom

**Cross-Output Consistency Audit** (for batch production)

When generating multiple posters for same product:

- ✅ Product appearance identical across all outputs (color, size, orientation consistency)
- ✅ Lighting direction and quality consistent (avoid mixed light sources)
- ✅ Color palette cohesive across series (establish master palette)
- ✅ Compositional logic maintains brand identity (consistent product placement strategy)

**Regeneration Decision Logic**

- **Accept and proceed**: Output meets all quality criteria, minor imperfections acceptable for use case
- **Iterate current**: Core concept strong, needs refinement in 1-2 specific dimensions
- **Regenerate from scratch**: Fundamental misalignment with requirements, prompt framework needs restructuring

## Key Constraints & Standards

### Immutable Product Identity Rules

- ✅ **Product aspect ratio lock**: The product's width-to-height ratio from source image must be preserved within ±2% tolerance
- ✅ **Brand color fidelity**: Primary brand colors must match source within Delta E &lt; 3 (imperceptible difference to human eye)
- ✅ **Logo and text integrity**: All text elements on product packaging must remain legible and positioned exactly as in source
- ✅ **Material surface properties**: Matte finishes remain matte, glossy surfaces maintain specular highlights, transparency levels preserved

### Reference Style Alignment Standards

- ✅ **Lighting direction match**: Light source angle and quality (hard/soft) must align with reference image's lighting setup
- ✅ **Color temperature consistency**: Warm/cool color bias must match reference (measure in Kelvin if reference provides metadata)
- ✅ **Compositional structure transfer**: Spatial relationships (foreground/midground/background hierarchy, negative space distribution) follow reference patterns
- ✅ **Atmospheric coherence**: Mood, energy level, visual tone align with reference aesthetic

### Technical Quality Thresholds

- ✅ **Resolution requirement**: Minimum 2048px on longest side for print quality, 1500px for digital-only use
- ✅ **Focus and sharpness**: Product must be in critical focus, background blur acceptable and often desirable (shallow DOF)
- ✅ **Noise and artifacts**: Minimal compression artifacts, no visible AI generation anomalies (malformed objects, impossible physics)
- ✅ **Color space**: sRGB for web delivery, Adobe RGB or ProPhoto RGB for print production

### Copywriting Integration Standards (when text overlay requested)

- ✅ **Visual hierarchy**: Product name &gt; Key benefit claim &gt; Call-to-action, font size ratios 3:2:1
- ✅ **Readability**: Text contrast ratio minimum 4.5:1 against background (WCAG AA standard)
- ✅ **Placement logic**: Text positioned in negative space areas, never obscuring critical product features
- ✅ **Brand voice alignment**: Copywriting tone matches brand positioning (premium sophisticated vs energetic playful)

### Batch Production Consistency Rules

- ✅ **Model identity lock**: Once optimal model selected through comparison, use same model for entire campaign batch
- ✅ **Prompt template consistency**: Establish master prompt template, vary only product-specific details and scene elements
- ✅ **Lighting continuity**: Maintain consistent lighting setup across all variants (direction, color temperature, intensity)
- ✅ **Aspect ratio strategy**: Use consistent aspect ratios within same platform deployment (all mobile main images 3:4, all desktop banners 16:9)

### Output Approval Checklist

Before finalizing any poster:

- \[ \] Product proportions and brand identity 100% accurate
- \[ \] Reference style successfully transferred
- \[ \] Supporting elements enhance rather than distract
- \[ \] Technical quality meets platform requirements
- \[ \] (If applicable) Text overlay readable and well-integrated
- \[ \] (If batch) Consistency maintained across series

## Recommended Tools & Models

This skill involves systematic comparison across multiple AI generation models to identify optimal quality for specific aesthetic requirements:

- **Lib Image**: Fast iteration model suitable for rapid prototyping and concept testing
- **General Image V2**: Balanced model with good photorealism and environmental coherence
- **General Image Pro**: Enhanced detail rendering with superior lighting simulation for premium output quality
- **Seedream 5.0 Pro**: Strongest creative interpretation with best atmospheric effects and highest stylistic fidelity to reference images

Workflow typically involves parallel generation across 2-4 models for direct quality comparison, then selecting the optimal model for production batch generation.

## Example

**Scenario**: Generate e-commerce poster for herbal tea beverage, reference style is fresh natural outdoor aesthetic

**Input Assets**:

- Product: Herbal tea can with red brand color, 310ml size, traditional Chinese medicine brand positioning
- Reference: Natural outdoor scene with blue sky, green plants, wooden surface, shallow depth of field

**Execution**:

1. **Asset preparation**: Verify product image is clean white background PNG, analyze reference image's visual DNA (natural lighting from top, cool color palette with green accents, moss-covered wood surface texture, soft bokeh background)

2. **Initial prompt construction**:

```
Professional e-commerce product photography: [Brand] herbal tea 310ml can positioned center-right on moss-covered wooden log surface, natural outdoor setting with blue sky and fresh green bamboo shoots in background, soft natural lighting from top-left creating gentle shadows, shallow depth of field with soft bokeh, fresh clean aesthetic emphasizing natural herbal ingredients, maintain product's exact appearance (red can color, logo placement, label design) precisely as provided, photorealistic commercial photography style, high resolution
```

3. **Multi-model comparison**: Generate across Lib Image, General Image V2, General Image Pro, Seedream 5.0 Pro simultaneously (all 3:4 vertical format)

4. **Quality evaluation**:

   - Lib Image: Fast result, good product fidelity, slightly flat lighting
   - General Image V2: Balanced quality, natural lighting well-executed
   - General Image Pro: Best detail rendering, superior material textures
   - Seedream 5.0 Pro: Most atmospheric, strongest reference style match, richest color

5. **Model selection**: Choose Seedream 5.0 Pro for production based on superior atmospheric quality and reference alignment

6. **Iteration refinement**: Generate 3 additional variants with scene variations (different plant species, altered camera angle, time-of-day lighting changes) to provide client selection options

7. **Copywriting generation** (delivered alongside visuals):

   - Main title: "清凉一夏,吉祥相伴" (Cool Summer, Fortune Accompanies)
   - Subtitle: "全冰草本·\[Brand\]凉茶" (Full Ice Herbal·\[Brand\] Herbal Tea)
   - Key benefits: Herbal formula, cooling properties, 310ml convenient size
   - CTA: Limited-time promotion messaging

**Output**: 4-model comparison set + selected model's variant series + matched copywriting package