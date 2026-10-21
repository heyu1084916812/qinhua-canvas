# Fashion Video Typography Overlay

## Core Methodology

### Multi-Anchor Composition Framework

Fashion video generation requires maintaining visual consistency across three independent anchor dimensions while allowing dynamic variation:

**Anchor Layer Architecture:**

- **Product Anchor** (immutable): the hero product (eyewear, accessory, garment) — preserves exact shape, material texture, design details across all shots
- **Model Anchor** (semi-stable): the talent's face, skin tone, body proportions, hairstyle — must remain recognizable while allowing pose/expression variation
- **Scene Anchor** (contextual): the background environment (white studio, runway, location) — sets lighting consistency and spatial logic

**Isolation Logic:** Each anchor is generated independently first, then referenced together during final video synthesis. This prevents "anchor contamination" where one element's style bleeds into another (e.g., product metallic texture affecting skin rendering).

### Vertical Format Narrative Structure

For 9:16 portrait video (15-30 seconds), employ a 5-Act micro-narrative rhythm:

**Act Sequence:**

1. **Brand Announcement** (0-2s): Static brand text + minimal product tease, establishes visual language
2. **Model Entry** (2-6s): Talent walks into frame, product prominently featured in context
3. **Product Isolation** (6-9s): Extreme close-up on product details (reflections, textures, mechanical elements)
4. **Context Interaction** (9-12s): Model engages with product in environment (turning, posing, direct eye contact)
5. **Text Takeover + Brand Exit** (12-15s): Typography expands to fill frame, model fades, logo lockup

**Pacing Rule:** Each act's duration = \[total_duration / 5\] ±1 second. Transitions must be hard cuts (no dissolves) to maintain fashion editorial energy.

### Typographic Layering System

Text overlays in fashion video serve three simultaneous functions — they're not decorative captions but architectural elements:

**Text Layer Functions:**

- **Wallpaper Layer**: Repeating brand slogans tiled across entire frame at 30-50% opacity, creates texture like fabric print. Keywords repeat 15-20 times in grid formation.
- **Hero Layer**: 2-3 key phrases appear at 100% opacity in XL size (fill 40% of vertical frame height), timed to appear/disappear synchronized with act transitions
- **Kinetic Layer**: Text elements that move — vertical scrolling, horizontal slide-in, scale pulsing at 1-2 second intervals to create urgency

**Typography-Image Interaction Rule**: Text should occlude 30-60% of the model at peak moments (not just float in negative space). This creates fashion editorial "text-as-obstruction" aesthetic where copy competes with image for attention.

### Reference Asset Hierarchy

When user provides reference materials, establish priority order:

**Priority Ranking:**

1. **Product reference image** (highest): This dictates hard constraints — exact design must replicate
2. **Model description** (medium): Guides casting but allows interpretation ("Asian female, minimalist styling" permits variations in exact facial features)
3. **Scene/environment** (lowest): Can be abstracted to core qualities ("white studio" = seamless background + high-key lighting, exact studio setup flexible)
4. **Reference video** (contextual): Extract only rhythm/pacing/editing tempo, NOT visual style. If user says "don't reference video", remove this entirely.

**Constraint: Never let reference video override anchor-based visual consistency.** If conflict arises (e.g., video shows different model than anchor), anchors win.

## Workflow

### 1. Preparation Stage

**Asset Inventory Checklist:**

- \[ \] Product reference image uploaded (or detailed text description if unavailable)
- \[ \] Model specifications: gender, ethnicity, age range, styling (hair/makeup/clothing)
- \[ \] Brand text content: company name, campaign slogan, collection name, legal copy
- \[ \] Duration target: 15s (standard), 30s (extended), or custom
- \[ \] Scene environment: white studio, outdoor location, abstract space

**Critical Decisions Before Starting:**

- **Anchor count**: Minimum 3 (product + model + scene). If user provides multiple model types ("Asian female + European male"), create separate model anchors.
- **Text overlay density**: Fashion editorial (high density, 60%+ frame coverage) vs. minimalist (sparse, &lt;30% coverage)
- **Reference video usage**: Ask explicitly: "Should I reference video rhythm/pacing or ignore entirely?" Default = ignore unless user insists.

**Multi-Model Handling**: If user describes "two models", initially generate all anchors expecting dual-talent output. If later they clarify "just one model", immediately pivot to single-model anchors and regenerate.

### 2. Initial Design Stage

**Step 2.1: Generate Independent Anchors**Create each anchor in isolation using precise descriptive prompts:

```
Product Anchor Prompt Template:
[Product category] product photography, [specific design details from reference], [material qualities], [lighting setup], white seamless background, studio photography, sharp focus, professional e-commerce quality

Model Anchor Prompt Template:
[Ethnicity] [gender] fashion model, [age descriptor], [hairstyle], [skin tone], [makeup style], [clothing description], [pose type], white studio background, high-fashion editorial photography, Hasselblad quality

Scene Anchor Prompt Template:
[Environment type] photography set, [lighting characteristics], [spatial qualities], [mood descriptors], professional fashion photography setup, editorial quality
```

**Anchor Validation**: After generation, verify each anchor:

- Product: Does it match reference image silhouette/material? If not, regenerate with refined details.
- Model: Does face/styling align with user's description? Check hair color, skin tone, clothing fit.
- Scene: Does lighting support product visibility? White studios need high-key fill to avoid shadows.

**Step 2.2: Structure Act Breakdown**Before generating video, write explicit text overlay schedule:

```
Act Timeline for 15s Video:
0-2s: Brand name center-lockup, no model visible yet, product teaser in shadow
2-4s: "NEW COLLECTION" slides in from right as model enters left
4-6s: Model full-body visible, brand name repeating as wallpaper layer at 40% opacity
6-9s: Product extreme close-up, all text fades except "SS26" in corner
9-11s: Model + product interaction, "THE FUTURE IS NOW" expands from small to full-frame
11-13s: Text wallpaper intensifies to 60% coverage, multiple slogans scrolling vertically
13-15s: All elements collapse to logo, white fadeout
```

**Step 2.3: First Generation Attempt**Compose final prompt combining all anchors + act structure + text overlay instructions:

```
Generate 15-second 9:16 vertical fashion advertisement video.

Visual Anchors:
- Product: [anchor reference]
- Model: [anchor reference]  
- Environment: [anchor reference]

Narrative Structure:
[Paste act timeline from Step 2.2]

Typography Requirements:
- Wallpaper text: [brand slogans] repeating in grid, 40-60% opacity
- Hero text: [key phrases] appearing at [timestamps]
- Text style: [sans-serif/serif], [weight], [alignment]
- Text-image interaction: Text should occlude 30-60% of model at peak moments

Technical Specs:
- Aspect ratio: 9:16 vertical
- Duration: exactly 15 seconds  
- Pacing: hard cuts between acts, no dissolves
- Camera movement: [static/slow push/dolly]
```

### 3. Iteration Stage

**Iteration Dimension 1: Text Overlay Density**If user requests "text铺满" (text filling frame), regenerate with escalated density:

- Increase wallpaper layer opacity 40% → 60%
- Add 2-3 more text elements to wallpaper grid
- Introduce diagonal/45-degree angle text bands
- Make hero text larger (40% frame height → 60%)

**Iteration Dimension 2: Model Count Adjustment**If user changes from "two models" to "one model":

- Delete unused model anchor
- Redistribute act timeline (remove dual-model interaction beats)
- Extend single-model screen time by rebalancing acts 2-4

**Iteration Dimension 3: Reference Video Removal**If user says "不要参考视频" (don't reference video):

- Purge all video reference parameters from prompt
- Regenerate using only image anchors + text instructions
- This often produces cleaner, more controllable output

**Convergence Criteria:**

- Product design matches reference image at &gt;90% visual similarity
- Model identity is recognizable across all shots (face, styling consistent)
- Text overlays appear at specified timestamps ±0.5 seconds
- Total duration matches target ±1 second
- No unwanted elements (e.g., extra models, wrong clothing)

**When to Accept vs. Regenerate:**

- ACCEPT if: Core anchors stable + text timing correct + narrative flow smooth
- REGENERATE if: Model face changes between shots, product design drifts, text timing off &gt;2 seconds, duration exceeds target by &gt;3 seconds

## Key Constraints & Standards

### Immutable Rules

1. **Aspect ratio lock**: 9:16 vertical format, never 16:9 horizontal. Fashion content is consumed on mobile, vertical is non-negotiable.
2. **Anchor-first generation**: ALWAYS generate anchors before final video. Never attempt single-prompt generation for multi-element fashion content.
3. **Hard cut transitions**: No cross-dissolves, no morphs between acts. Fashion editing rhythm requires jarring cuts.
4. **Product fidelity**: If user provides product reference image, the final video product must match design details (shape, color, texture, branding) at &gt;90% similarity. This is a pass/fail test.

### Fidelity Rules

5. **Model identity persistence**: Face, skin tone, body proportions, hairstyle must remain consistent across all shots in a single video. Pose and expression can vary, but core identity is locked.
6. **Text legibility threshold**: All hero text must be readable for minimum 1.5 seconds on-screen. Wallpaper text can be illegible (it's texture), but key phrases must be scannable.
7. **Text-image balance**: Text should cover 30-60% of frame during "text takeover" moments (acts 4-5). If text covers &lt;20%, increase density. If &gt;80%, reduce to prevent total image obstruction.

### Consistency Rules

 8. **Lighting continuity**: If scene anchor establishes high-key white studio lighting, all acts must maintain this (no sudden dim/moody lighting in act 3).
 9. **Duration precision**: Final video must match user's target duration ±2 seconds. If user requests 15s, acceptable range is 13-17s.
10. **Text synchronization**: Text appearance/disappearance must align with act transitions. If act 2 starts at 2 seconds, model entry + text slide-in must both trigger at 2s mark (not 2.5s).

### Quality Standards

11. **No pixelation on product details**: Product close-up shots (act 3) must show crisp edges, clear material texture, readable branding. If product appears blurry, regenerate with "sharp focus, macro lens, product photography quality" emphasis.
12. **No model identity drift**: If model face changes significantly between acts (different person appears), this is a critical failure requiring full regeneration with stronger anchor reference weighting.
13. **No unintended elements**: If prompt specifies "one Asian female model" and output shows two people or a male model, regenerate immediately. Zero tolerance for casting errors.

## Recommended Tools & Models

Use **Minimax Hailuo H3** for video generation. This model provides strong anchor-based consistency and handles 9:16 vertical format + complex text overlay instructions effectively.

## Advanced Techniques

### Text Reflection Integration

For luxury product videos (eyewear, jewelry, watches), enhance text-image interaction by having typography reflect in product surfaces:

- During product close-up acts, specify: "Brand text visible as reflection in \[product surface — lens, metal, glass\]"
- This creates premium editorial effect where text becomes part of product's material reality
- Constraint: Reflection text must be legible enough to identify brand name

### Multi-Model Choreography

If user wants multiple models in one video:

- Generate separate anchors for each model (Model A anchor, Model B anchor)
- Structure acts with explicit "who appears when" timeline:
  - Act 2: Model A solo entry
  - Act 3: Product solo (no models)
  - Act 4: Model B entry, both models side-by-side
- Specify spatial positioning: "Model A left third of frame, Model B right third"
- Risk: Multi-model videos have higher anchor drift probability. If models' identities blur together, reduce video duration or separate into two single-model videos.

### Kinetic Typography Patterns

For high-energy fashion campaigns, use these tested text animation patterns:

- **Vertical Scroll**: Text blocks move bottom-to-top at 20-30% frame height per second (fast fashion, streetwear)
- **Scale Pulse**: Text oscillates between 80-120% size at 1Hz frequency (luxury, emphasis on key phrases)
- **Diagonal Sweep**: Text bands slide 45-degree angle across frame (avant-garde, editorial)
- **Convergence**: Multiple text elements start at edges, collapse to center-lockup (brand-focused ending)

Choose ONE pattern per video to avoid chaos. Fashion typography is controlled aggression, not randomness.