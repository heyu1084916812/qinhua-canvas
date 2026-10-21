# E-commerce Product Poster Replication

## Core Methodology

### Style Transfer with Product Fidelity Lock

This skill employs a dual-constraint generation logic:

**Immutable Product Core**: The product image acts as a pixel-level identity lock. Throughout style transfer, the product's proportions, branding elements (logos, labels), and physical form must remain unchanged. This is achieved through strict prompt anchoring: the product description always appears first in the prompt structure with hard constraint keywords ("maintain exact proportions", "preserve original packaging design").

**Compositional Style Extraction**: From the reference image, extract decomposable style dimensions:

- Scene environment (natural outdoor / studio tabletop / lifestyle context)
- Lighting setup (soft diffused / dramatic side lighting / backlit glow)
- Supporting elements (ice cubes, water splashes, botanical props, texture surfaces)
- Color palette (warm/cool tones, saturation levels, mood)
- Depth of field (sharp product focus with background blur, or all-in-focus flat lay)

The generation prompt constructs as: **\[Product Identity Lock\] + \[Scene Environment\] + \[Supporting Elements\] + \[Lighting & Atmosphere\] + \[Composition Angle\]**.

### Multi-Model Comparative Production

E-commerce visual requirements vary by platform and campaign. This skill systematically tests multiple AI models in parallel to provide style diversity:

**Model Selection Matrix**:

- **Lib Image**: Balanced photorealism, good product fidelity
- **General Image V2**: Strong compositional creativity, richer scene generation
- **General Image Pro**: Enhanced detail rendering, better lighting control
- **Seedream 5.0 Pro**: Superior photographic realism, high dynamic range

**Batch Production Logic**: Generate 1 output per selected model in parallel. User reviews all versions side-by-side, selecting the best-performing model for that specific product-style combination. This eliminates trial-and-error iteration.

### Aspect Ratio Strategy

**Platform-Optimized Dimensions**:

- **3:4 (Vertical)**: Mobile e-commerce main images, social media feeds (Instagram, TikTok product posts)
- **4:3 (Horizontal)**: Desktop detail pages, landscape product showcases
- **9:16 (Ultra-vertical)**: Full-screen mobile stories, short-form video covers
- **16:9 (Widescreen)**: Hero banners, homepage sliders, video thumbnails
- **1:1 (Square)**: Universal social media posts, grid layouts

The aspect ratio determines composition structure. Vertical ratios emphasize product prominence with minimal background. Horizontal ratios enable richer storytelling through scene expansion.

### Copywriting Coordination

Every poster generation includes structured e-commerce copy:

- **Main Headline**: Product benefit statement (max 8 characters Chinese / 5 words English)
- **Subheadline**: Product category + key feature
- **Selling Points**: 3-4 bullet points highlighting unique value (herbal ingredients, cooling effect, size/quantity, quality certifications)
- **Call-to-Action**: Purchase urgency + promotional offer ("Buy 3 Get 1 Free", "Limited Time Offer")

Copy is provided separately from the visual — users can choose text-free posters or composite text in post-production.

## Workflow

### 1. Preparation Stage

**Required Assets**:

- **Product White-Background Image**: Clean product shot with transparent or pure white background. Product must be well-lit, facing forward, with all branding elements visible. Recommended resolution: 2000px+ on longest side.
- **Style Reference Image**: An existing e-commerce poster, lifestyle photo, or campaign visual representing the desired aesthetic. Can be from competitors, mood boards, or previous successful campaigns.

**Critical Asset Verification**:

- Product image must show the EXACT SKU being promoted (correct packaging design, label text, size)
- Reference image should clearly demonstrate the target scene environment, lighting mood, and supporting element types
- If multiple products need posters, prepare a complete white-background image set upfront

**User Consultation Checklist**:

1. **Text Requirement**: Does the user need typographic text overlays on the poster, or pure visual output for later text addition?
2. **Aspect Ratio Selection**: Which platform/use case? Suggest ratio based on deployment channel.
3. **Model Selection**: Single model or multi-model comparison? If comparative testing, recommend 3-4 models for diverse style exploration.

### 2. Initial Design Stage

**Prompt Framework Construction**:

```
[Product Identity Lock]
"{{Product name}} {{packaging type}} with exact original proportions and branding, maintain product design unchanged"

+ [Scene Environment]
"Scene: {{environment type from reference}} (e.g., natural outdoor sunlight, wooden table surface, studio gradient background)"

+ [Supporting Elements]
"Add {{complementary objects from reference}} (e.g., ice cubes melting around product, fresh fruit slices, botanical leaves, water droplets)"

+ [Lighting & Atmosphere]
"Lighting: {{lighting style from reference}} (e.g., soft diffused natural light, warm golden hour glow, cool blue studio lighting), mood: {{adjective}} (fresh, energetic, premium, cozy)"

+ [Composition Angle]
"Composition: {{camera angle}} (eye-level centered, slightly elevated 30-degree angle, low-angle hero shot), shallow depth of field with product in sharp focus"

+ [Technical Specifications]
"Professional e-commerce photography, high resolution, product photography lighting setup, {{aspect ratio}}"
```

**Reference Image Integration**: Attach the reference image to the prompt with instruction: "Learn the visual style, scene composition, and atmospheric mood from this reference image."

**Product Fidelity Calibration**: After constructing the scene prompt, append hard constraints:

- "The {{product name}} must retain its original size proportions relative to scene elements"
- "Product label text and logo must remain legible and unaltered"
- "Packaging colors must match the original product exactly"

**Parallel Generation**: If user selected multiple models, trigger all model generations simultaneously with identical prompts. Each model interprets the prompt with its unique style bias, providing automatic A/B testing.

### 3. Iteration Stage

**Quality Audit Dimensions**:

**Product Fidelity Check**:

- \[ \] Product proportions match original (not stretched, squashed, or distorted)
- \[ \] Branding elements (logo, label text, color blocking) are accurate
- \[ \] Product orientation and angle align with standard e-commerce presentation

**Style Transfer Accuracy**:

- \[ \] Scene environment matches reference image atmosphere (lighting, color mood)
- \[ \] Supporting elements are contextually appropriate (no random irrelevant objects)
- \[ \] Composition structure follows reference layout principles

**E-commerce Viability**:

- \[ \] Product is the clear focal point (not overwhelmed by background)
- \[ \] Background elements enhance rather than distract from product
- \[ \] Overall aesthetic aligns with brand positioning (premium/casual/youthful/traditional)

**Cross-Model Comparison**:

- Review all generated versions side-by-side
- Evaluate each model on: product accuracy, scene realism, lighting quality, color palette appeal
- Select the best-performing model as the production standard for future batches of this product line

**Regeneration Triggers**:

- Product distortion or proportion errors → Strengthen product identity lock in prompt, add "exact original dimensions" constraint
- Background too busy or chaotic → Simplify scene description, specify "minimal clean composition"
- Lighting inconsistency → Add specific lighting setup terms ("softbox lighting", "natural window light from left side")
- Color palette mismatch → Explicitly define color scheme in prompt ("cool blue tones", "warm earthy palette")

**Accepted Output Criteria**:

- Product passes fidelity check (can be used for actual e-commerce listing)
- Scene aesthetic aligns with brand campaign goals
- User confirms this output as satisfactory for final use or further minor post-production editing

## Key Constraints & Standards

### Immutable Product Rules

1. **Proportional Integrity**: Product aspect ratio must be preserved. A tall slim can cannot become a short wide can. If the original product is 15cm tall by 5cm diameter, the generated output must maintain that 3:1 height-to-width ratio.

2. **Branding Accuracy**: Logo placement, font style, label text, and color-blocking on packaging must be pixel-accurate to the input product image. No hallucinated text, no logo distortion, no color shifts in brand identity elements.

3. **Physical Realism**: Product material properties (glossy metal can, matte cardboard box, transparent glass bottle) must be rendered consistently. Reflections and highlights should logically correspond to the scene lighting.

### Scene Composition Rules

4. **Product Prominence**: The product must occupy 40-60% of the frame for 3:4 vertical formats, 30-50% for horizontal formats. Background elements serve as supporting context, never dominating the visual hierarchy.

5. **Supporting Element Coherence**: Props and scene elements must be semantically related to the product category. For a beverage, acceptable elements include ice, condensation droplets, fruit garnishes, glassware. Unacceptable: random electronics, clothing, text books.

6. **Lighting Logic**: Lighting direction must be consistent across all elements. If the product has a highlight on the top-right, background elements should also show light coming from the upper-right direction. Avoid mixed lighting that breaks spatial realism.

### Style Transfer Fidelity

7. **Color Palette Extraction**: Identify the 3-5 dominant colors in the reference image. Generated output must stay within this color family. Saturation levels should match — if reference is desaturated and moody, output cannot be oversaturated and vibrant.

8. **Depth of Field Matching**: If reference uses shallow depth of field (sharp product, blurred background), output must replicate this. If reference is all-in-focus flat-lay, output should avoid artificial bokeh.

9. **Atmosphere Translation**: Reference mood descriptors ("fresh and energetic", "premium and minimalist", "cozy and warm") must translate into concrete visual decisions: lighting warmth, background texture density, compositional breathing room.

### Batch Production Consistency

10. **Model Standardization**: Once a specific model is chosen as optimal for a product line (e.g., Seedream 5.0 Pro works best for this beverage brand), all subsequent posters in that campaign should use the same model to maintain visual coherence.

11. **Aspect Ratio Consistency Within Campaign**: A single product launch campaign should maintain one primary aspect ratio (e.g., all mobile main images use 3:4). Mixing ratios within one campaign creates visual fragmentation.

12. **Scene Variation Logic**: When generating multiple posters for the same product, vary ONLY the supporting elements and background details while keeping product angle, lighting setup, and color palette consistent. This creates a cohesive campaign set rather than disjointed random images.

## Recommended Tools & Models

This skill supports four AI image generation models, each with distinct strengths:

- **Lib Image**: Balanced general-purpose generation with reliable product fidelity. Suitable for standard e-commerce posters requiring moderate realism and fast iteration.

- **General Image V2**: Enhanced creativity in scene composition and supporting element generation. Best for lifestyle-oriented campaigns requiring richer storytelling context.

- **General Image Pro**: Superior detail rendering and texture quality. Optimal for premium product campaigns where material realism (fabric weave, metallic sheen, glass transparency) is critical.

- **Seedream 5.0 Pro**: Highest photographic realism and dynamic range. Recommended for hero campaign visuals, high-end product launches, and outputs requiring print-quality resolution.

For initial exploration, generate with 2-3 models in parallel to identify which model's style bias best suits your product category and brand aesthetic.