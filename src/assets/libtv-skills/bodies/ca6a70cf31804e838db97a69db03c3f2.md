# Product Poster to Animated Ad

Transform a multi-section product poster (e.g., 4-flavor snack packaging) into a 15-second vertical video advertisement. Each poster section activates sequentially with glow effects, explosive product reveals, flavor-specific text animations, and a finale where all elements converge into a frozen vortex around the brand.

## Core Methodology

### 1. Floating Poster Canvas Architecture

**Gradient Space as Universal Background** — The poster never sits on a surface or in a room. It floats in a limitless gradient void that dynamically recolors to reflect the active section. Structure:

- **Layer 1 (Base Gradient)**: Neutral slate/charcoal gradient covering full frame (top-to-bottom transition)
- **Layer 2 (Poster)**: Product poster suspended in center, occupying 75-85% of vertical frame height
- **Layer 3 (Dynamic Gradient Injection)**: Color-coded light infusion corresponding to active section (gold for classic, crimson for tomato, umber for BBQ, tangerine-red for spicy)
- **Layer 4 (Floating Elements)**: Chips, particles, text animations existing in 3D space around poster

The poster remains the visual anchor throughout — never replaced, only temporarily zoomed into. Background gradient shifts provide emotional tonal support without competing for attention.

### 2. Sequential Section Activation Framework

**Pulse → Detach → Explode → Label → Reset** cycle applied to each poster section:

- **Pulse Stage** (0.5-1s): Target section glows with 3 pulsating rings, brightness increasing per pulse. Gradient background responds with subtle color injection matching section theme.
- **Detach Stage** (0.3-0.5s): Section elastically stretches and zooms toward camera (2D→3D transition effect). Remaining poster shows glowing "empty slot" where section was.
- **Explode Stage** (1.5-2s): Product bursts from enlarged section with flavor-specific particle effects. Each chip/particle is individually defined with texture details (ridges, seasoning specks, shadows).
- **Label Stage** (concurrent with Explode): Flavor name appears with physics-driven text animation (see Text Animation System).
- **Reset Stage** (hard cut): Camera snaps back to full poster view. Activated section retains soft residual glow as "completion marker."

Critical constraint: Use only hard cuts between sections — no dissolves, wipes, or fades. This maintains TikTok/Reels-style punchy rhythm.

### 3. Text Animation Personality Matrix

Each section's flavor name receives a unique kinetic identity to differentiate product variants:

- **Classic/Original**: Rubber-band bounce — letters stretch vertically on impact, compress horizontally, snap back to normal with overshoot and settle
- **Tomato/Red Variant**: Jelly wobble — letters squish laterally, oscillate back/forth 3-4 times with decreasing amplitude, stabilize
- **BBQ/Smoky Variant**: Inflation-deflation — letters rapidly expand like inflating balloons, peak at 150% scale, quickly compress back with slight bounce
- **Spicy/Hot Variant**: Vibration blur — letters shake at high frequency creating edge blur, gradually dampen to stable buzz

All text animations must:

- Launch synchronized with product explosion
- Complete within 0.8-1.2 seconds
- Maintain perfect readability throughout (no motion blur artifacts)
- Use bold, rounded sans-serif with 3D bevel/gradient fill

### 4. Particle Physics and Material Definition

Every floating element requires explicit material properties:

**Chip Specification**:

- Geometry: Irregular curved edges, ruffled surface with bubble texture
- Color: Golden-brown base gradient (darker center, lighter crisp edges)
- Details: Unevenly distributed salt specks (white micro-dots), soft drop shadow
- Motion: Arc trajectories with tumbling rotation (lazy spin or end-over-end flip)
- Lighting: Studio key light catches ridges, creates subtle rim light on edges

**Flavor-Specific Particle Systems**:

- Classic: Golden crumb mist preceding main burst, fine salt crystal spray
- Tomato: Red seasoning powder particles (edible glitter effect), concentrated on chip ridges
- BBQ: Smoky brown sugar/paprika dust, faint heat-haze wisps curling from pouch
- Spicy: Orange ember pinpricks (no actual fire), whole dried chili flakes tumbling with chips

Physics rule: Each particle obeys consistent arc motion — explosion velocity decreases over time, natural parabolic descent begins around 1.5s mark, all particles converge for finale vortex.

## Workflow

### 1. Preparation Stage

**Input Requirements**:

- One multi-section product poster (4 sections standard)
- Poster must show consistent brand identity across all sections (same logo treatment, packaging style)
- Sections must have clear visual boundaries and equal visual weight
- Poster designed for vertical frame (9:16 aspect ratio)

**Pre-Production Checklist**:

- \[ \] Verify poster contains no old logos, watermarks, or residual text from previous versions
- \[ \] Identify section activation sequence (typically left-to-right or top-to-bottom)
- \[ \] Map section-to-flavor names (default: Classic, Tomato, BBQ, Spicy)
- \[ \] Define gradient color progression for each section's activation phase
- \[ \] Confirm brand wordmark placement for finale (typically centered above poster)

**Key Decision: Gradient Color Palette**

- Base gradient: Deep charcoal (#2B2B2B) → slate (#4A4A4A)
- Classic injection: Golden-amber (#FFB84D)
- Tomato injection: Deep crimson (#C41E3A)
- BBQ injection: Smoky umber (#6B4423)
- Spicy injection: Tangerine-to-crimson blend (#FF6347 → #DC143C)
- Finale gradient: Buttery yellow center (#FFD700) → warm brown edges (#8B4513)

### 2. Initial Design Stage

**Prompt Construction Framework**:

```
[Aspect Ratio + Duration] + [Background System] + [Poster Anchor Description] + 
[Section Activation Sequence] + [Particle Systems] + [Text Animation Specs] + 
[Finale Convergence] + [Brand Lock Frame]
```

**Example Structure for 4-Section Poster**:

- Opening: 1s static hold, poster floating in base gradient
- Section 1: 0.5s pulse → 0.3s detach → 2s explosion+text → hard cut (total 2.8s)
- Section 2: 0.5s pulse → 0.3s detach → 2s explosion+text → hard cut (total 2.8s)
- Section 3: 0.5s pulse → 0.3s detach → 2s explosion+text → hard cut (total 2.8s)
- Section 4: 0.5s pulse → 0.5s spin detach → 2.5s explosion+text (total 3.5s)
- Finale: 0.5s vortex acceleration → 0.3s freeze → 1.8s brand lock (total 2.6s)
- **Total: \~15 seconds**

**Multi-Reference Strategy for Consistent Execution**:

- Reference poster image must appear in prompt as visual anchor
- Specify "the poster remains visible in background" during each section zoom
- Describe "glowing empty slot" effect to maintain poster continuity
- Define "hard cut return to full poster view" between sections

**Calibration: Poster Scale vs Frame**

- Poster occupies 75-85% of vertical frame height when fully visible
- During section zoom, enlarged section fills 90-95% of frame
- Finale view returns poster to 75-85% scale with frozen particle ring extending to frame edges

### 3. Iteration Stage

**Optimization Dimension: Aspect Ratio Lock**

If output is 16:9 instead of 9:16:

- Regenerate with explicit "9:16 vertical aspect ratio, portrait orientation" at prompt start
- Add negative prompt: "16:9, horizontal, landscape, widescreen"
- Verify model settings show vertical/portrait mode selection

**Optimization Dimension: Background Contamination**

If real-world elements (tables, rooms, surfaces) appear:

- Strengthen "pure gradient space" language: "limitless void," "no physical environment"
- Add negative prompt: "tabletop, room, floor, wall, real-world setting"
- Emphasize "poster floats suspended, casting no shadow"

**Optimization Dimension: Transition Softness**

If dissolves/fades appear between sections:

- Reinforce "exclusively hard cuts" and "no dissolves, no wipes, no fades"
- Describe transitions as "instant snap," "direct cut," "hard edit"
- Add negative prompt: "fade in/out, soft transitions, dissolves, cross-fades"

**Optimization Dimension: Text Clarity**

If text appears blurry or distorted:

- Specify "perfectly crisp, sharp-edged typography" and "no motion blur on text"
- Reduce animation speed descriptors ("rapid" → "smooth elastic")
- Add "maintain readability throughout animation" as explicit constraint
- Negative prompt: "blurry text, distorted typography, illegible labels"

**Consistency Audit Checklist** (compare across all 4 sections):

- \[ \] Each section follows same activation timing structure
- \[ \] All text animations use same font family with consistent sizing
- \[ \] Chip appearance remains uniform (only seasoning color differs)
- \[ \] Background gradient responds proportionally to each section
- \[ \] Poster brand identity remains pixel-identical across all frames

**When to Accept vs Regenerate**:

- **Accept if**: 9:16 format correct, gradient background pure, all 4 sections activate, finale vortex present, brand legible
- **Regenerate if**: Wrong aspect ratio, real-world background elements, missing sections, no gradient color shifts, text unreadable, poster brand inconsistency

## Key Constraints & Standards

### Immutable Structural Rules

- **Aspect ratio**: 9:16 vertical (portrait) only — never 16:9 or square
- **Duration**: 15 seconds ±1 second maximum variance
- **Background type**: Pure gradient space — zero tolerance for rooms, tables, surfaces, or poster background extensions
- **Transition type**: Hard cuts exclusively — no dissolves, wipes, fades, or morphs between sections

### Brand Identity Fidelity Rules

- **Logo consistency**: Brand logo must appear identical on poster across all frames (same size, position, color, font)
- **Packaging consistency**: All product pouches on poster must maintain uniform design language (same brand, same label structure)
- **Zero legacy artifacts**: No old logos, no residual text from previous versions, no watermarks, no foreign brand elements
- **Finale brand lock**: Final frame must show poster with clear brand wordmark above it, both perfectly legible

### Visual Quality Standards

- **Text readability**: All flavor names must remain crisp and sharp throughout animations — no motion blur, no scaling artifacts
- **Chip definition**: Each chip must show textured surface (ridges/bubbles), gradient coloring, salt specks, and shadow
- **Particle physics**: All floating elements must follow realistic arc trajectories — no linear motion, no teleporting
- **Gradient smoothness**: Background transitions must be seamless gradients — no banding, no hard color edges (except section-to-section hard cuts)

### Timing Synchronization Rules

- **Pulse-to-explosion rhythm**: Section glow pulses 3 times before detachment (approximately 0.5s total)
- **Text launch sync**: Flavor name appears concurrent with product explosion, not before or after
- **Vortex freeze timing**: Particle convergence must fully freeze before finale gradient transition begins
- **Brand lock hold**: Final static frame holds minimum 1.5 seconds for brand absorption

### Section Activation Equity

- **Equal screen time**: Each of 4 sections receives 2.5-3 seconds activation time (±0.5s variance acceptable)
- **Consistent zoom scale**: All section enlargements reach same approximate scale (90-95% frame fill)
- **Uniform particle density**: Each section's explosion produces similar chip count (visual weight balance)

### Gradient Dynamics Rules

- **Base state**: All non-activation frames show neutral charcoal-to-slate gradient
- **Active state color injection**: Gradient center adopts section-specific color (gold/crimson/umber/tangerine-red) at 40-60% saturation
- **Finale transition**: Final gradient must shift to warm golden-amber (buttery yellow center → warm brown edges)
- **No abrupt color jumps**: Gradient color shifts happen during hard cuts (instant transition acceptable) or during 0.3-0.5s section detach animation

### Particle Material Standards

- **Chip texture requirement**: Must show surface irregularities (not flat discs) — ruffled edges, bubble texture, ridge definition
- **Seasoning visibility**: Flavor-specific particles (red powder, brown dust, chili flakes) must be visibly distinct from chip base color
- **Lighting consistency**: All particles receive same lighting setup (key light from upper-left, subtle rim light on edges)
- **Shadow presence**: Every chip casts soft drop shadow (not harsh contact shadow)

## Recommended Tools & Models

Use **Minimax H3 (Hailuo)** for video generation. This model excels at long-form prompt adherence (3500+ token prompts), precise particle physics, and maintaining visual continuity across extended sequences. Alternative models may struggle with the sequential section activation logic and gradient background dynamics required by this workflow.

## Advanced Techniques

### Micro-Timing Stagger for Vortex Convergence

Instead of all particles moving simultaneously toward poster during finale, introduce slight entry timing offsets:

- Chips at top of frame begin descent 0.1s before side chips
- Side chips begin inward spiral 0.1s before bottom chips
- This creates cascading convergence effect (waterfall visual) rather than uniform collapse
- All particles still freeze simultaneously at vortex peak

### Flavor-Specific Camera Motion Personality

Subtle camera behavior variations can reinforce flavor character:

- Classic: Smooth linear zoom, stable framing (traditional, reliable)
- Tomato: Slight horizontal weave during zoom (playful, casual)
- BBQ: Lower camera angle with slight upward tilt (heroic, robust)
- Spicy: Faster zoom speed with micro-shake (energetic, intense)

Keep motion subtle — exaggerated camera work breaks professional advertising aesthetic.

### Adaptive Gradient Intensity Scaling

For brands preferring subtler color shifts:

- Reduce active state gradient injection from 40-60% saturation to 20-35%
- Increase base gradient contrast (darker charcoal, lighter slate) to maintain depth
- Use rim lighting on poster edges to separate from background instead of strong color contrast

This creates premium, sophisticated aesthetic vs. energetic social media style.