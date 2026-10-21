# Website Scroll Unfold Animation Design

## Core Methodology

### Sequential Layer Choreography Framework

Web scroll animations operate through **time-based layer isolation** — every visual element is treated as an independent animation layer triggered in a coordinated sequence. This framework decomposes page composition into three core animation layers:

**Layer 1 — Textual Foundation (0.0s – 1.4s):**

- Navigation bar: slides down from top edge (0.0s – 0.5s)
- Hero headline: slides down from above viewport (0.5s – 1.0s)
- CTA button + footer logo row: slides up from bottom edge (1.0s – 1.4s)
- **Animation logic**: Establish page hierarchy through vertical axis motion — primary UI anchors enter first to frame the visual space

**Layer 2 — Visual Anchoring (1.4s – 2.0s):**

- Product hero visual: fade-in with 0.3s opacity ramp (1.4s – 1.7s)
- Product info card: fade-in with 0.3s opacity ramp (1.7s – 2.0s)
- **Animation logic**: After text scaffolding is complete, introduce visual content to maintain user attention on structured information flow

**Layer 3 — Product Dynamism (2.0s – 4.0s):**

- Hero product (vehicle/device): Y-axis rotation loop -8° to +8°, 2-second cycle
- **Animation logic**: Continuous micro-motion sustains engagement after initial load sequence — product becomes "alive" through subtle dimensional rotation

### Layout Composition Transfer Logic

When adapting a reference layout to new brand content:

**Dimensional Analysis:**

- Navigation structure: top bar element count, alignment (left/center/right)
- Content layout: left-text + right-visual OR center-focused OR grid-based
- Visual hierarchy: title size ratio, CTA prominence, product card position (corner overlay vs integrated)
- Whitespace distribution: padding ratios, vertical breathing zones

**Brand Visual Substitution:**

- Extract brand color palette from product visual (primary, accent, neutral)
- Map brand colors to layout zones: CTA buttons = primary brand color, headlines = high-contrast neutral, accent = decorative elements
- Replace reference product with target product while maintaining: angle consistency (3/4 front vs side profile), scale proportion (visual weight relative to text), lighting direction

**Asset Inventory Mapping:**

- Navigation items: 4-6 text links (Home, Products, Technology, Contact, etc.)
- Hero headline: 1-2 lines, brand tagline or product launch statement
- CTA text: action verb ("Explore", "Discover", "Configure")
- Product info card: specification snippet (engine, horsepower, features)
- Footer logo row: brand logo + partner logos (optional)

## Workflow

### 1. Preparation Stage

**Input Asset Checklist:**

- Reference layout image: full-page screenshot showing navigation, content zones, visual hierarchy
- Product hero visual: high-resolution image, ideally 3/4 front angle, clean background
- Brand guidelines (if available): color codes, typography preferences, logo variants

**Dimensional Audit**:Before animation, analyze reference layout structure:

- Measure navigation bar height ratio (typically 8-12% of viewport)
- Identify headline position (left-aligned, center, or right)
- Locate CTA button placement (below headline, bottom corner, floating)
- Note product visual zone (right half, center stage, background layer)
- Check for overlay elements (product cards, spec callouts)

**Brand Color Extraction**:From product visual, identify:

- Primary brand color (logo color, typically high-saturation accent)
- Secondary color (complementary or analogous to primary)
- Neutral base (white, light gray, dark gray for text/backgrounds)

**Key Decision: Animation Pace**Standard 4-second sequence works for:

- E-commerce product landing pages
- Automotive reveal campaigns
- Consumer electronics launches

For enterprise/luxury brands, extend to 6 seconds (slower, more deliberate pacing).

### 2. Initial Composition Stage

**Step 1: Layout Composition (Static Frame)**

Generate the final static webpage composition by combining:

- Reference layout structure (navigation, content zones, whitespace)
- Target product visual (replace reference product)
- Brand color application (CTA buttons, accent elements)
- Text content (headlines, CTA copy, product specs)

Prompt framework for composition:

```
[Layout structure from reference] + [Target product visual] + [Brand color palette] + [Text content elements]
- Navigation: [4-6 items, top bar, brand colors]
- Hero section: [Headline text] + [CTA button with primary brand color] + [Product visual at 3/4 angle]
- Product card: [Specifications overlay, bottom-right corner]
- Footer: [Brand logo row]
- Background: [Gradient matching product visual lighting]
```

**Composition Quality Check:**

- Visual hierarchy intact: text readable, product prominent but not dominating
- Brand color applied to interactive elements (buttons, links)
- Whitespace preserved: not cluttered, breathing room around key elements
- Product visual aligned: not cropped awkwardly, maintains intended viewing angle

**Step 2: Animation Sequence Generation**

Use the static composition frame as input for animation generation.

Prompt framework for animation (based on Sequential Layer Choreography):

```
Based on [static composition image], generate 4-second web scroll unfold animation:

Layer 1 (0.0s – 1.4s): Textual Foundation
- Top navigation slides down from top edge (0.0s – 0.5s)
- Hero headline slides down (0.5s – 1.0s)
- CTA button + footer logo row slide up from bottom (1.0s – 1.4s)

Layer 2 (1.4s – 2.0s): Visual Anchoring
- Product hero visual fades in (1.4s – 1.7s)
- Product info card fades in (1.7s – 2.0s)

Layer 3 (2.0s – 4.0s): Product Dynamism
- Product performs Y-axis rotation -8° to +8°, 2-second loop cycle

All motions use ease-out timing. Camera remains locked.
```

### 3. Iteration Stage

**Animation Timing Refinement**:If Layer 1 feels rushed:

- Extend text entry phase to 1.8s (navigation 0.0-0.6s, headline 0.6-1.2s, CTA/footer 1.2-1.8s)
- Push Layer 2 start to 1.8s

If product motion feels static:

- Increase Y-axis rotation range to -12° to +12°
- Add subtle Z-axis zoom (scale 1.0 to 1.05) during rotation

**Brand Color Correction**:If CTA button doesn't match brand:

- Regenerate composition with explicit hex code (e.g., "Honda red #CC0000 for CTA button")
- Ensure high contrast against background (minimum WCAG AA contrast ratio 4.5:1)

**Visual Hierarchy Audit**:After animation generation, verify:

- Headline remains readable throughout motion (no overlap with product during slide-in)
- CTA button visible and prominent by 1.4s mark
- Product rotation doesn't obscure product info card
- Navigation bar doesn't create top-heavy composition

**Consistency Check Across Variants**:If generating multiple product variants (different car models, color options):

- Product rotation angle range MUST be identical (e.g., always -8° to +8°)
- Animation timing MUST match frame-by-frame (all start/end timestamps identical)
- Only product visual swaps; layout structure, text positioning, color zones remain locked

## Key Constraints & Standards

### Immutable Animation Rules

- **Camera lock**: Camera must remain completely static. All motion is object-based (UI elements, product). No camera pan, zoom, or dolly.
- **Layer sequencing**: Layers must animate in strict order (Textual → Visual → Dynamic). No simultaneous start times across layers.
- **Timing envelope**: Total duration 4 seconds (±0.5s acceptable). Shorter feels rushed; longer risks user drop-off.

### Composition Fidelity Rules

- **Reference structure preservation**: Navigation bar position, content zone proportions, whitespace distribution must match reference layout (±10% margin).
- **Product visual integrity**: Product must not be distorted, cropped at critical angles, or repositioned to break intended viewing perspective.
- **Brand color application**: CTA buttons, accent elements must use exact brand primary color. No arbitrary color substitution.
- **Text legibility threshold**: Headline text minimum size 5% of viewport height. Body text minimum 2%. CTA button text minimum 3%.

### Motion Quality Standards

- **Ease-out timing**: All slide-in/fade-in motions use ease-out curve (fast start, slow deceleration). No linear timing.
- **Rotation smoothness**: Product Y-axis rotation must complete full -8° to +8° cycle in exactly 2 seconds. No jittery keyframes.
- **Overlap prevention**: No UI element overlap during motion. If headline and product visual paths intersect, adjust Layer 1 timing.
- **Fade-in opacity ramp**: All fade-in effects use 0.3s ramp (0% → 100% opacity over 300ms). No instant pop-in.

### Brand Consistency Rules

- **Color extraction priority**: Always extract primary brand color from product visual first. Use brand guidelines as secondary reference.
- **Logo placement**: Brand logo must appear in footer row or top-left navigation. Never obscured by product visual.
- **Typography hierarchy**: Headline font weight ≥ 700 (bold). Body text weight ≤ 400 (regular). CTA button weight ≥ 600 (semi-bold).

### Technical Execution Constraints

- **Aspect ratio**: Output video 16:9 (standard web viewport). For mobile-first designs, use 9:16 vertical format.
- **Frame rate**: Minimum 30fps. For luxury/automotive brands, 60fps preferred for smoother product rotation.
- **Resolution**: Minimum 1920x1080 (1080p). 4K (3840x2160) for hero banner campaigns.

## Advanced Techniques

### Multi-Product Carousel Sequencing

For multi-model campaigns (e.g., sedan, SUV, sports car variants):

- Generate 3 separate composition frames (one per model)
- Animate each with identical Layer 1/2 timing
- Vary Layer 3 rotation range by product type:
  - Sedan: -6° to +6° (elegant, restrained)
  - SUV: -10° to +10° (bold, commanding)
  - Sports car: -12° to +12° (aggressive, dynamic)

### Parallax Depth Layering

For premium brand executions:

- Split background into 3 depth planes (far, mid, near)
- Apply differential scroll speeds:
  - Far plane (gradient): 0.3x scroll speed
  - Mid plane (product): 1.0x scroll speed
  - Near plane (UI text): 1.5x scroll speed
- Generates dimensional depth cue during Layer 1-2 animation

### Micro-Interaction Accents

Add secondary motion to elevate polish:

- CTA button: subtle scale pulse (1.0 → 1.05 → 1.0) on 3-second loop
- Navigation links: horizontal slide-in stagger (0.1s offset per item)
- Product info card: slide-in from right edge (not fade-in) with overshoot spring effect