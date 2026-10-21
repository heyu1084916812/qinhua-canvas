# Website Screenshot Animation

## Core Methodology

### Sequential Layer Choreography Framework

This skill implements a strict hierarchical animation sequence that mimics professional website reveal patterns. The core logic treats the static screenshot as a layered composition where each visual hierarchy level animates independently:

**Layer Isolation Principle**: Every screenshot element belongs to one of four timing groups:

- **Layer 1 (Top Navigation)**: Brand name, menu items, header elements — enters FIRST to establish context
- **Layer 2 (Hero Title)**: Main headline, product name — enters with 0.1s delay to create rhythm
- **Layer 3 (CTA/Footer)**: Call-to-action buttons, pricing, supplementary text — enters with 0.2s delay from opposite direction
- **Layer 4 (Product/Visual Focus)**: Central product image, hero visual — fades in LAST (1.4s) after text stabilizes, then performs subtle perpetual motion

**Temporal Staging Logic**: Animation follows a 3-phase structure:

1. **Text Foundation Phase (0s-1.4s)**: All typography enters sequentially to build brand narrative framework
2. **Visual Anchor Phase (1.4s-2.0s)**: Product/hero image fades in to become focal point
3. **Living Product Phase (2.0s-4.0s)**: Subtle Y-axis rotation (-8° to +8°) maintains viewer attention without distraction

### Keyframe Timing Matrix (Non-Negotiable)

LayerAnimation TypeEasingStart TimeEnd TimeMotion VectorTop NavigationslideDownease-out0.0s1.2sFrom above frame boundaryHero TitleslideDownease-out0.1s1.3sFrom above frame boundaryCTA/FooterslideUpease-out0.2s1.4sFrom below frame boundaryProduct VisualfadeInlinear1.4s2.0sOpacity 0→100%Product VisualY-axis rotationslow loop2.0s∞-8° ↔ +8° perpetual

CRITICAL CONSTRAINT: The 0.1s stagger intervals between text layers are calibrated to create perceived "flow" without feeling mechanical. Deviation destroys the rhythm.

### First-Frame Fidelity Principle

Unlike generative product videos that synthesize new 3D assets, this skill MUST preserve the input screenshot as the starting composition:

- **Layout preservation**: Navigation bars, product cards, UI elements, mechanical arms, logos — all must remain in original positions
- **Color system inheritance**: Background color, accent colors, typography colors extracted directly from input image
- **Asset identity lock**: If the screenshot shows a specific product render, that exact visual must be used — AI cannot substitute with "similar" products
- **Compositional integrity**: The animation enhances the existing design; it does not redesign the page

## Workflow

### 1. Preparation Stage

**Input Asset Requirements:**

- Primary input: 1 high-resolution website screenshot (16:9 aspect ratio preferred, minimum 1920x1080px)
- Screenshot must have clear visual hierarchy: distinct header/navigation, hero section with product/title, footer/CTA area
- Clean background preferred (white, gradient, or solid brand color) — busy textures may interfere with motion clarity

**Pre-Animation Analysis Checklist:**

- \[ \] Identify top navigation elements (logo, menu items, breadcrumbs)
- \[ \] Locate hero title/headline position and font hierarchy
- \[ \] Find CTA buttons, pricing tags, or footer supplementary text
- \[ \] Identify the primary product/visual focal point (usually center-weighted)
- \[ \] Extract brand color palette: background base, text primary, accent/highlight colors
- \[ \] Note any asymmetric layout elements that need special handling (sidebar cards, floating badges)

**Text Content Inventory**:If the skill is invoked via template, gather:

- Brand name (for top layer)
- Product title / hero headline (for center layer)
- CTA text or pricing label (for bottom layer)

### 2. Initial Animation Stage

**Prompt Framework Structure:**\[Animation Choreography Description\] + \[Timing Specification\] + \[First-Frame Constraint\] + \[Visual Style Lock\] + \[Technical Parameters\]

**Execution Approach:**

1. **Establish First-Frame Constraint in Prompt:**

   - Use phrases like "The animation starts from the provided website screenshot as frame 1" or "Preserve the exact layout and product visual from the input image"
   - This prevents the video model from generating a new "imagined" version of the product

2. **Specify Layer-by-Layer Motion Sequence:**

   - Explicitly describe each layer's entry animation with precise timing
   - Example phrasing: "Top navigation text slides down from above frame at 0.0s-1.2s using ease-out easing. Center headline text slides down with 0.1s delay at 0.1s-1.3s. Bottom CTA text slides up from below at 0.2s-1.4s."

3. **Define Product Animation with Two-Phase Logic:**

   - Phase 1: "After all text settles at 1.4s, the central product image fades in from 1.4s to 2.0s"
   - Phase 2: "From 2.0s onward, the product performs a subtle perpetual Y-axis rotation between -8° and +8°"

4. **Lock Camera and Lighting:**

   - Enforce "no camera movement" to maintain static framing (common mistake: models add zoom or dolly)
   - Specify "studio soft lighting" or "consistent ambient lighting matching the screenshot" to avoid dramatic lighting changes

**Multi-Reference Strategy (When Applicable)**:If the user provides multiple website screenshots from the same brand:

- Batch process them with identical timing parameters
- Extract a unified color palette across all screenshots to ensure brand consistency
- Maintain the same Y-axis rotation speed/range for product animations

### 3. Iteration Stage

**Primary Optimization Dimension: First-Frame Fidelity Check**

Most common failure mode is the video model regenerating the product instead of using the input screenshot. Audit:

- \[ \] Does the video's first frame match the input screenshot's layout exactly?
- \[ \] Is the product visual pixel-identical to the screenshot, or has it been replaced with a "similar" 3D render?
- \[ \] Are UI elements (navigation bars, cards, logos) preserved in original positions?

If fidelity fails → regenerate with stronger first-frame constraint language in prompt

**Secondary Optimization Dimension: Timing Rhythm Verification**

- \[ \] Do text layers enter sequentially with 0.1s stagger, or do they all appear simultaneously?
- \[ \] Does the product fade-in start at exactly 1.4s (after text stabilizes), or does it overlap with text motion?
- \[ \] Is the Y-axis rotation subtle (-8° to +8°), or does it become a distracting 360° spin?

If timing is off → adjust prompt wording to emphasize "sequential reveal" and "subtle perpetual motion"

**Tertiary Optimization Dimension: Color System Accuracy**

- \[ \] Does the video background match the screenshot's background color?
- \[ \] Are accent colors (buttons, highlights) preserved from the original design?
- \[ \] Is lighting consistent (avoid dramatic shadows or specular highlights not present in screenshot)?

If color drifts → explicitly specify hex codes extracted from the screenshot in the prompt

**When to Regenerate vs Accept:**

- Regenerate if: First-frame layout is altered, product visual is replaced, timing sequence collapses into simultaneous motion
- Accept if: Minor color saturation variation (&lt;10%), lighting softness differs slightly but maintains mood, Y-axis rotation speed varies within 20% tolerance

## Key Constraints & Standards

### Immutable Timing Rules

1. **Stagger interval lock**: Text layers MUST enter with exactly 0.1s delay increments (0.0s, 0.1s, 0.2s). This interval is empirically calibrated for visual flow.
2. **Product delay threshold**: Product visual MUST NOT begin fading in before 1.4s. Early entry breaks the "text-first, product-second" hierarchy logic.
3. **Duration mandate**: Total video length is 4.0 seconds. The Y-axis rotation loop continues infinitely within this window but must start at 2.0s.

### Fidelity Rules

1. **First-frame preservation**: The input screenshot MUST be recognizable as the base composition in the output video. Layout, product identity, and UI elements cannot be regenerated.
2. **Product asset lock**: If the screenshot shows a specific product render (e.g., a gaming controller held by a robotic arm), that EXACT visual must appear in the video — the model cannot substitute with a "similar but different" 3D asset.
3. **Typography position invariance**: Text layer positions (top, center, bottom) must match the screenshot's typographic hierarchy. Do not rearrange headline placement.

### Motion Quality Standards

1. **Camera immobility**: Zero camera movement throughout the 4-second duration. This is a product showcase animation, not a cinematic camera motion piece.
2. **Rotation subtlety threshold**: Y-axis rotation must stay within -8° to +8° range. Exceeding ±10° makes the motion distractingly aggressive.
3. **Easing consistency**: All slide-in animations use ease-out easing. Do not mix linear or ease-in curves, which break the "landing smoothness" feeling.

### Color System Rules

1. **Palette extraction mandate**: Background color, text color, and accent colors MUST be sampled from the input screenshot. Do not invent new brand colors.
2. **Contrast preservation**: If the screenshot has high-contrast text (e.g., black text on white), the video must maintain this contrast ratio. Do not soften to gray-on-gray.
3. **Accent color highlight**: If the screenshot includes a standout color (e.g., neon green CTA button), this color must remain vibrant in the video — do not desaturate for "cinematic" effect.

### Batch Consistency Standards (Multi-Screenshot Projects)

1. **Unified timing**: All screenshots in a batch must use identical keyframe timing (0.0s, 0.1s, 0.2s, 1.4s, 2.0s).
2. **Rotation speed lock**: Y-axis rotation speed must be identical across all product videos in the batch.
3. **Color palette coherence**: If processing multiple pages from the same website, extract a master color palette and apply it uniformly to avoid per-video color drift.

## Recommended Tools & Models

Use MiniMax Hailuo H3 for video generation with screenshot-to-video capabilities and precise motion control.