# Poster-to-Video Dynamic Motion

## Core Methodology

### Multi-Layer Element Decomposition Framework

Every poster image contains independent visual layers that animate on different timelines:

**Layer 1 — Character/Subject Identity (Immutable)**

- Facial features, hair structure, body proportions, skin tone
- These NEVER change throughout the 15-second duration
- Subject acts as the anchor point for all other animations

**Layer 2 — Typography Hierarchy (Primary Animation Target)**

- Main headline: largest font, earliest entry (0-1.5s slide/slam into position)
- Subtitle: secondary font, delayed follow (0.3-2s delayed entry)
- Body text/labels: smallest font, sequential reveal (1-3s typewriter-style fade-in)
- Each text element has independent entry timing but shares unified exit timing

**Layer 3 — Graphic Elements (Secondary Animation Target)**

- Decorative borders: contract/expand into final position (0-4s)
- Icons/shapes: pulse activation (2-4s)
- Background patterns: continuous subtle breathing motion throughout
- Grid lines: radiate from center or corners

**Layer 4 — Texture & Distress (Persistent Atmosphere)**

- 16mm film grain: always present, intensity varies
- Halftone dots: density peaks during key moments
- Print misregistration: brief chromatic shifts (0.5-1s duration)
- Ink splatters: timed to beat drops or transitions

**Layer 5 — Camera Movement (Narrative Arc)**

- 0-5s: Static or slow push-in on full composition
- 5-10s: Dynamic movement (orbit, tilt, dolly)
- 10-15s: Return to front-facing lock, prepare for exit

### Semantic Color Matching Logic

When text content changes, the color palette auto-adjusts based on semantic associations:

Content ThemeColor SchemePrimarySecondaryHighlightMetal/IndustrialRust-red + Oxidized copper#8B3A3A#4A6B5FCold whiteGothic/DarkDried blood + Tarnished silver#6B1A1A#A0A0A0Faded goldCyber/DigitalNeon magenta + Deep purple#CC0044#1A0A2ECyan blueOrganic/EarthBurnt brown + Dead leaf orange#5C3A1E#B8763AAsh whiteOcean/IceDeep abyss blue + Ship gray#0F2A3F#4A5058Cold whiteDefaultPure black + Blood red#000000#CC0000White

User can override with custom palette or preserve original poster colors.

### Five-Act Motion Structure

Any 15-second poster animation follows this dramatic arc:

**Act 1 (0-3s) — Assembly/Entry**

- All elements enter frame through coordinated but staggered animations
- Large elements enter first (headlines slam), small elements last (labels fade)
- Subject becomes visible as text settles
- Establishes full composition

**Act 2 (3-6s) — Camera Exploration**

- First major camera move: orbit, tilt, or push-in
- Text elements shift in parallax depth
- First glitch event: chromatic aberration or ink splash (brief, &lt;1s)

**Act 3 (6-9s) — Intensification**

- Second camera move: different axis from Act 2
- Graphic elements activate (borders pulse, icons glow)
- Second glitch event: jump cut misregistration or exposure burn

**Act 4 (9-12s) — Deconstruction/Chaos**

- Text explodes into fragments, letters disintegrate
- RGB color channels separate and drift apart
- Texture/grain reaches maximum intensity
- Negative flash or chromatic burst

**Act 5 (12-15s) — Resolution**

- All fragments snap back to original positions (magnetic pull effect)
- Texture suddenly vanishes, leaving clean digital finish
- Credit text fades in bottom corner
- Hard cut to black

## Workflow

### 1. Preparation Stage

**Reference Image Analysis Checklist:**

- \[ \] Subject identification: face/body/object, angle, lighting
- \[ \] Typography inventory: list ALL text elements with font style, size, position
- \[ \] Graphic elements: borders, shapes, icons, decorative lines
- \[ \] Color palette extraction: primary, secondary, highlight, shadow colors
- \[ \] Texture assessment: grain, distress, print artifacts

**User Input Collection:**

- Reference poster image (required)
- Text content overrides (optional — if not provided, use original poster text)
- Color scheme preference (optional — if not provided, auto-match to text semantics)
- Music genre (optional — default: rap/dark-pop)
- End credit text (optional — default: "shot on \[model name\]")

**Key Decision: Animation Approach**

- **Entry-focused**: Front-loaded impact with text flying in, then gradual decay
- **Exit-focused**: Stable opening, explosive deconstruction at end
- **Balanced**: Equal weight to entry and exit with dynamic middle section

### 2. Initial Prompt Construction Stage

**First-Frame Locking Protocol:**

The prompt MUST explicitly state: "This video begins exactly with the user's reference image as the very first frame." Then describe the reference image in detail:

> "a \[subject description\] in strict \[angle\] composition. Color scheme: \[palette description\]. The reference image is a graphic poster containing multiple typography elements that will animate into place: \[headline text\] in \[font style\] at \[position\], \[subtitle text\] in \[font style\] at \[position\], \[body text\] at \[position\], plus graphic elements including \[list decorative elements\]."

This forces the model to treat the image as frame 0, not just a style reference.

**Motion Instruction Format:**

Each time segment needs explicit instructions:

> "0-3s: \[camera state\]. \[Element A\] \[animation verb\] from \[start state\] to \[end state\], settling by \[timestamp\]. \[Element B\] follows with \[delay amount\], \[animation verb\]. \[Element C\] \[animation verb\] between \[start time\]-\[end time\]. \[Texture/effect\] \[occurs/visible\]. At \[timestamp\], a brief \[effect type\] flashes and vanishes."

Never write vague instructions like "elements animate naturally" — specify the exact sequence.

**Glitch Event Scheduling:**

Place 3-5 glitch events across the timeline, each under 1 second:

- Chromatic aberration (RGB channel split): "the \[color\] channel shifts \[direction\] for 0.5 seconds"
- Ink splash: "\[color\] ink splatters \[direction\] from \[position\]"
- Jump cut: "a jump cut shifts the entire composition slightly"
- Exposure burn: "a brief exposure burn flashes at frame edges"
- Negative flash: "a 2-frame negative flash"

Always specify color (matches the chosen palette), duration, and timing.

### 3. Iteration Stage

**Common Issues and Fixes:**

ProblemDiagnosisSolutionSubject changes appearanceFirst-frame lock failedAdd "strict front-facing composition" + "preserve exact facial features, hair structure, and body proportions from reference image"Text missing from openingEntry animation too subtleChange to aggressive entry: "slams into frame" / "slides from off-screen" / "scales up from center"Text too staticNo animation instructionsAdd per-element timings: "settles by 1.5s" / "follows with 0.3s delay" / "fades in between 2-3s"Glitch effects too longGlitch duration not specifiedAlways cap at 0.5-1s: "flashes for 0.5 seconds then vanishes"Camera too chaoticMultiple moves overlapSeparate camera moves into distinct time windows: 0-5s static, 5-10s orbit, 10-15s returnColors wrongAuto-matching failedOverride with explicit palette: "Color scheme: \[primary color name\] #HEX as main, \[secondary color name\] #HEX as accents"

**Quality Audit Dimensions:**

1. **First-frame fidelity**: Does frame 0 match the reference image exactly?
2. **Text element completeness**: Are ALL text items from the reference present and animated?
3. **Animation entry timing**: Do elements follow the staggered sequence (large → small)?
4. **Camera motion clarity**: Is each camera move distinct and purposeful?
5. **Glitch event brevity**: Are all glitches under 1 second?
6. **Color consistency**: Does the palette match the text semantics or user override?
7. **Resolution timing**: Does the ending follow the magnetic-snap → texture-vanish → credit → cut sequence?

**When to Regenerate:**

- Subject appearance changes: immediate regenerate
- Missing text elements: try "enhance prompt specificity" first
- Wrong color palette: regenerate with explicit color codes
- Timing issues: adjust time segment boundaries in prompt

## Key Constraints & Standards

### Immutable Rules

1. **First-frame exactness**: The reference image IS frame 0, not a style guide. Subject appearance, composition angle, and all visible elements must match pixel-accurately.
2. **Subject identity lock**: Facial features, hair texture, skin tone, body proportions never change across 15 seconds.
3. **Typography completeness**: Every text element visible in the reference poster must appear and animate in the video.
4. **Hard cut only**: Never use fades, dissolves, or soft transitions between segments. Only hard cuts, jump cuts, and single-frame inserts.
5. **15-second fixed duration**: Do not exceed or fall short. Structure must fit exactly.

### Fidelity Rules

6. **Text animation stagger**: Elements enter in order of visual hierarchy — headlines first (0-1.5s), subtitles second (0.3-2s), body text last (1-3s).
7. **Glitch brevity**: All distortion effects (chromatic aberration, ink splash, jump cut, exposure burn, negative flash) must be under 1 second. They punctuate, they don't obscure.
8. **Camera return**: If the camera moves away from front-facing in the middle section, it must return to front-facing composition by 10-12s for the resolution phase.
9. **Texture arc**: Film grain and print texture are always present but vary in intensity — maximum during deconstruction (9-12s), vanish during resolution (13-14s).

### Consistency Rules

10. **Color semantic matching**: If text content changes, automatically select the color scheme that matches the new semantic theme (metal → rust-red, cyber → neon magenta, etc.). User can override.
11. **Palette coherence**: Once a color scheme is chosen, ALL subsequent elements (ink splashes, chromatic shifts, highlights) must use colors from that palette only.
12. **Music genre alignment**: The visual rhythm (glitch frequency, camera speed, text animation tempo) should match the music genre specified — rap = aggressive hard cuts, ambient = slower drifts.

### Technical Standards

13. **Frame rate**: 24 FPS (creates slight motion stutter for analog feel)
14. **Aspect ratio**: 16:9 (default), can adapt to 9:16 vertical or 1:1 square if needed
15. **Resolution**: Minimum 1080p equivalent (not specified in prompt but expected from model)
16. **Texture authenticity**: Use period-accurate analog terms — "16mm film grain", "halftone dots", "print misregistration", not generic "noise" or "distortion"

## Recommended Tools & Models

Use **Minimax H3** for video generation from single reference images. This model excels at first-frame locking and 15-second continuous shots with complex camera movements.

## Advanced Techniques

### First-Frame-to-Last-Frame Transition

For more dramatic transformations, use TWO reference images:

- First image: starting poster composition (frame 0)
- Last image: ending poster composition (frame \~13-14s)

Prompt structure changes:

> "This video begins exactly with \[first reference image\] and ends by transforming into \[second reference image\]. 0-7s: \[first poster elements animate and deconstruct\]. 7-10s: \[transition space — abstract motion, color shift, or pure energy\]. 10-15s: \[second poster elements assemble and lock into place\]."

This requires explicit "deconstruction → void → reconstruction" choreography.

### Multi-Segment Stitching (When Single-Shot Fails)

If the model cannot execute the full 15-second sequence in one generation:

1. Generate 3-4 segments separately (each 3-5s)
2. Each segment uses the same color palette and subject lock
3. Stitch with hard cuts at natural beat points (3s, 6s, 9s, 12s)
4. Manually ensure last frame of Segment N matches first frame of Segment N+1

This sacrifices seamless camera motion but preserves element animation quality.

### Adaptive Color Temperature Shifts

For longer mood arcs, shift color temperature across the timeline:

- 0-5s: Cool palette (blues, cyans, cold whites)
- 6-10s: Warm injection (reds, oranges bleed in)
- 11-15s: Return to cool or shift to monochrome

Requires per-segment palette instructions:

> "6-9s: color temperature shifts warm, \[secondary color\] elements bleed into \[warm color\], maintaining \[primary color\] as anchor."

## Example

**User Input:**

- Reference image: Portrait poster with "MENTAL HEALTH" headline, X-ray skull visual, blue-cyan color scheme
- Text override: None (use original)
- Color scheme: Auto-match (detects medical/clinical theme → deep abyss blue + ship gray)
- Music genre: Dark ambient

**Prompt Output (abbreviated):**

> 24FPS, 16:9, 15-second seamless continuous shot, dark-pop cyber-grunge ambient music video. This video begins exactly with the user's reference image as the very first frame: a person with transparent X-ray skull visualization in strict front-facing composition. Color scheme: deep abyss blue #0F2A3F, ship gray #4A5058, cold white highlights, high contrast. The reference image is a graphic poster containing: "MENTAL HEALTH" in large bold sans-serif centered at top, "We Trust Science" in script font overlaid, "FIND PEACE" small text top left, navigation text, corner decorative L-brackets, bottom info bar. All elements initially present.
>
> 0-3s: Camera holds full composition. "MENTAL HEALTH" headline tracks down from slightly above frame, settling by 1.5s. "We Trust Science" follows with 0.3s delay, fading in. Small text elements reveal typewriter-style 2-3s. L-brackets pulse activation. 16mm grain visible. Brief blue ink splash at 2s.
>
> 3-6s: Slow 360° clockwise orbit. Typography shifts parallax. Chromatic aberration at 4.5s: cyan channel splits 0.5s. Single-frame photocopy flash at 5s.
>
> 6-9s: Fluid low-angle tilt-up to overhead. Brackets prominent. Exposure burn at frame edges 7.5s. Jump cut misregistration 8.5s.
>
> 9-12s: Pull back to front-facing. All text returns flat. Blue ink splatter upward at 10s. 2-frame negative at 11s. Maximum halftone density.
>
> 12-15s: Static. Chromatic burst 13s: all blue elements split to gray ghosts then snap back violently. 14s texture vanishes instantly. "shot on Minimax H3" fades bottom right. Hard cut black.
>
> High contrast, deep black shadows, abyss blue and ship gray palette, all typography animating naturally, X-ray skull constant, cold and clinical, no cheap neon.