# Ghibli Animation Production Workflow

## Core Methodology

### Three-Stage Sequential Production Framework

**Stage 1: Character Anchor Establishment (Sequential Confirmation Protocol)**

- Single Character Iteration Rule: Generate one character at a time, mandatory user confirmation before proceeding to next character
- Character anchor = tri-view template: front view + side profile + facial close-up, establishing visual identity consistency baseline
- Anchor serves as pixel-level reference library for all subsequent scenes
- Character count determines Stage 1 completion: N characters = N confirmation cycles

**Stage 2: Detailed Storyboard Matrix (9-Grid Full Coverage System)**

- 9-grid constraint: Every storyboard MUST fill all 9 grids with NO empty cells
- Grid decomposition logic: 1 grid = 1 camera shot OR 1 grid = transition split into 2 micro-shots (e.g., door opening sequence: handle close-up → door swing wide-angle)
- Time allocation formula: Total duration ÷ 4 storyboards = \~30s per board (Seedance 2.5 max limit)
- Black-and-white pencil sketch base layer + Color Annotation System overlay:
  - 🔴 Red arrows = Body/character movement trajectory
  - 🔵 Blue arrows = Camera movement (pan, tilt, dolly, zoom)
  - 🟢 Green marks = Framing/composition notes (rule of thirds, leading lines)
  - 🟠 Orange marks = Lighting direction (sun angle, shadow cast)
  - 🟣 Purple marks = Sound/emotional emphasis (music swell, dialogue peak)
  - ⚫ Black text = Shot duration + brief action description

**Stage 3: Video Generation with Annotation Elimination**

- Critical constraint: Color annotation system is REFERENCE ONLY — must NOT appear in final video output
- Seedance 2.5 parameters: 720p resolution, 30s max per segment
- Segment structure: 1 storyboard = 1 video segment, 4 segments = complete film
- Sequential synthesis workflow: Generate all 4 segments → BGM generation → Final composition with audio overlay

### Layered Consistency Enforcement Architecture

**Immutable Layer (Character Identity)**

- Facial structure, eye color, hair texture, body proportions = LOCKED across all scenes
- Character anchor serves as ground truth — any deviation triggers regeneration
- Multi-character scenes require cross-reference to ALL character anchors simultaneously

**Flexible Layer (Scene Context)**

- Environment, lighting, props can vary per narrative requirement
- Camera angles and compositions adapt to storytelling beats
- Color palette adjusts for emotional tone (warm gold for nostalgia, cool blue for melancholy)

**Transition Layer (Continuity Logic)**

- Scene-to-scene transitions must maintain spatial coherence (e.g., character enters door from outside = back-to-camera perspective in previous shot)
- Action continuity: movement direction, object positions, character postures must align across cut points

### Ghibli Aesthetic DNA Encoding

**Color Philosophy**

- Multi-layered natural palettes: forests = 5-7 green gradients + golden sunlight + violet shadows + amber highlights
- Avoid single-tone environments — nature is chromatically complex
- Warm-cool balance: golden hour lighting bias with cool accent shadows

**Creature Design Naturalism**

- Real-world fauna color accuracy: magpies = black-and-white, swallows = dark blue-black with cream underparts (NOT fantasy rainbow birds)
- Anthropomorphic characters (e.g., cat shopkeeper) retain species-accurate base colors with costume overlays

**Hand-Drawn Watercolor Simulation**

- Visible brush texture, soft edges, organic line weight variation
- Joe Hisaishi-style piano and strings for BGM (gentle, nostalgic, non-intrusive)

## Workflow

### 1. Preparation Stage

**Input Checklist:**

- \[ \] Script with character descriptions (age, physical traits, clothing, symbolic roles)
- \[ \] Total animation duration (determines storyboard count: duration ÷ 30s = N boards)
- \[ \] Aspect ratio specification (16:9 for cinematic, 9:16 for vertical)
- \[ \] Narrative act structure (four-act recommended: introduction, conflict, climax, resolution)

**Character Inventory Construction:**

- Extract all named characters from script
- Prioritize by screen time: protagonist → supporting → background
- Document symbolic attributes (e.g., "orange cat = wisdom and time keeper", "elderly customer = memory and regret")

**Storyboard Segmentation Calculation:**

- Formula: Total seconds ÷ 30s per board = storyboard count
- Example: 120s film = 4 storyboards (0-30s, 30-60s, 60-90s, 90-120s)
- Assign narrative beats to each board (Act 1 = Board 1, etc.)

### 2. Initial Design Stage (Character Anchors)

**Single-Character Generation Loop**:For each character in inventory:

1. Generate tri-view character sheet:
   - Frontal view: neutral expression, full body, hands visible, centered composition
   - Side profile: 90° rotation, same pose, shows hair/clothing silhouette
   - Facial close-up: 3/4 angle, captures eye color, skin texture, emotional baseline
2. User confirmation gate: await explicit approval before proceeding
3. If rejected: iterate on specific correction (e.g., "eye color too dark", "dress pattern incorrect")
4. Archive approved anchor with unique ID (character-name-ANCHOR)

**Prompt Framework for Character Anchors:**

```
[Character name] character sheet, Ghibli Studio watercolor style, triple view layout:
- Full body front view: [age], [hair description], [eye color], [clothing details], [symbolic props]
- Side profile view: same character, 90-degree rotation
- Close-up portrait: face details, [emotional expression]
Pencil sketch linework with soft watercolor fill, white background, consistent lighting across all three views
```

### 3. Iteration Stage (Storyboards & Videos)

**Storyboard Refinement Protocol:**

**Critical Parameters (Must Specify in Every Prompt):**

- Model: Lib Image, 2K standard quality
- Language: Chinese prompts (text readability priority)
- Grid constraint: 9 cells MUST be filled (split scenes if needed)
- Branding: "LibTV TIME SHOP" (not "TIME SHOP")
- Style: Black-and-white pencil sketch + color annotation overlays

**Grid Expansion Strategy**:If storyboard has &lt;9 shots:

- Decompose complex actions into micro-shots (e.g., "character enters" → grid 1: hand on doorknob, grid 2: door half-open, grid 3: character stepping through)
- Add transition frames (e.g., fade-outs, scene establishing shots)
- Include cutaway details (e.g., clock close-up, object symbolic insert)

**Annotation Application Rules:**

- Red arrows: draw on character's movement path (e.g., walking trajectory, hand gesture arc)
- Blue arrows: overlay camera motion vector (e.g., upward tilt, rightward pan)
- Green marks: circle composition focal points, draw framing guides
- Orange marks: draw sunlight rays, indicate shadow direction
- Purple marks: place near dialogue bubbles or emotional peak moments
- Black text: write in margins, format = "\[Shot #\] \[duration\]s: \[action\]" (e.g., "S07 5s: Girl pushes door open")

**Video Generation Correction Cycles:**

**Common Issues & Fixes:**

IssueDiagnosticCorrectionAnnotation artifacts in videoColor arrows/text visible in outputRe-prompt: "Color annotations are reference only, MUST NOT appear in video output"Forest color monotonySingle-tone green, lacks depthSpecify: "Multi-layered forest palette with 5-7 green gradients, golden sunlight, violet shadows, amber highlights"Fantasy bird colorsRainbow/unrealistic plumageSpecify species: "Magpie (black-and-white) or swallow (dark blue-black with cream belly)" — real-world color accuracyIncorrect action directionCharacter exits instead of entersSpecify POV: "Back-to-camera view, character pushes door inward from outside"

**Regeneration Decision Matrix:**

- Minor issues (slight color shift, composition tweak) → Proceed, note for next segment
- Major issues (wrong character, missing action, annotation artifacts) → Immediate regeneration
- Continuity breaks (action direction mismatch, character inconsistency) → Regenerate current + review previous segment

**Video Synthesis Sequence:**

1. Generate all 4 video segments in parallel (if computing resources allow) or sequentially
2. User confirmation after each segment (optional: can batch-confirm all 4 if production-ready)
3. Generate Ghibli-style BGM: Joe Hisaishi piano/strings, non-intrusive, emotional tone matching narrative
4. Final composition: Concatenate 4 segments + overlay BGM with fade-in/fade-out
5. Archive final output with metadata (duration, resolution, segment timecodes)

## Key Constraints & Standards

### Immutable Rules (Never Violate)

**Character Identity Consistency:**

- Face, skin tone, body proportions, eye color = pixel-level identical across ALL scenes
- Hair texture, clothing patterns = consistent unless narrative explicitly requires change
- Character anchor is ground truth — any visual deviation requires regeneration

**Storyboard Grid Discipline:**

- 9 grids MUST be filled — no empty cells allowed
- If shot count &lt;9, decompose actions into sub-shots or add transition frames
- Every grid requires duration marking in black text

**Annotation Visibility Rule:**

- Color annotation system (red/blue/green/orange/purple arrows + black text) is REFERENCE ONLY
- Annotations MUST NOT appear in final video output — if detected, regenerate segment

### Fidelity Rules (Ghibli Aesthetic Standards)

**Color Palette Complexity:**

- Natural environments require 5-7 color gradients per element type (e.g., forest greens, sky blues)
- Avoid single-tone blocks — layer warm and cool tones for depth
- Golden hour lighting bias (warm amber sunlight + cool violet shadows)

**Creature Design Naturalism:**

- Fauna must use real-world species color palettes (e.g., magpie = black/white, not rainbow)
- Anthropomorphic characters retain species base colors (e.g., orange cat stays orange, add costume overlays)

**Hand-Drawn Texture Simulation:**

- Visible pencil sketch linework in storyboards
- Soft watercolor edges in video output (avoid hard digital edges)
- Organic line weight variation (thicker outlines on characters, lighter on backgrounds)

### Consistency Rules (Continuity Logic)

**Spatial Continuity Across Cuts:**

- Action direction must align: if character moves left-to-right in Shot A, continue left-to-right in Shot B
- Camera perspective coherence: if character enters door from outside, previous shot = back-to-camera view
- Object position consistency: props placed in Scene 1 must remain in same relative position in Scene 2 (unless narrative moves them)

**Segment Boundary Transitions:**

- Last frame of Segment N should visually/thematically connect to first frame of Segment N+1
- Avoid abrupt tonal shifts (e.g., bright daylight → sudden nighttime without establishing shot)
- Audio crossfade at segment junctions (1-2s overlap for smooth BGM integration)

**Batch Production Standards:**

- Seedance 2.5: 720p resolution, 30s max per segment, 16:9 aspect ratio default
- Storyboard generation: Lib Image, 2K quality, Chinese text prompts
- Character anchors: Same model as final video generation for style consistency

### Quality Audit Checklist (Pre-Final Export)

**Visual Inspection:**

- \[ \] Character faces identical across all scenes (compare to anchors)
- \[ \] No annotation artifacts (arrows/text) visible in video
- \[ \] Color palette richness (multi-layered, not flat)
- \[ \] Action continuity (no spatial/directional jumps)
- \[ \] Storyboard grid completeness (all 9 cells filled per board)

**Technical Verification:**

- \[ \] Segment duration match (actual vs. planned timecodes)
- \[ \] Resolution consistency (all segments 720p)
- \[ \] Audio sync (BGM fade-in at 0s, fade-out at end)
- \[ \] File format compatibility (H.264 codec standard)

**Narrative Coherence:**

- \[ \] Story beats align with original script
- \[ \] Emotional arc progression clear (introduction → conflict → climax → resolution)
- \[ \] Symbolic elements visible (e.g., time bottles, LibTV branding)

## Recommended Tools & Models

Use **Seedance 2.5** for video generation (720p, 30s max per segment). Use **Lib Image** with 2K standard quality for storyboard and character anchor generation. All prompts should be in Chinese for text clarity.

## Example

**Project:** 120-second animation "The Time Shop in the Forest"

**Stage 1 Output:** 4 character anchors (Girl, Cat Shopkeeper, Elderly Customer, Mother) — each tri-view sheet confirmed sequentially

**Stage 2 Output:** 4 storyboards covering 0-30s, 30-60s, 60-90s, 90-120s — each with 9 filled grids, black-and-white pencil sketch + color annotations

**Stage 3 Output:** 4 video segments (30s + 30s + 29s + 28s = 117s total) + 117s Ghibli-style BGM → Final composition with audio overlay

**Key Corrections Applied:**

- Storyboard iteration: Changed birds from "colorful fantasy" to "magpie/swallow (realistic colors)"
- Video iteration: Fixed door action direction (girl enters from outside, not exits from inside)
- Color enhancement: Added multi-layered forest palette (5-7 green gradients + golden highlights)

## Advanced Techniques

**Dynamic Camera Language Encoding in Storyboards:**

- Blue arrow length = camera movement speed (short arrow = slow pan, long arrow = fast dolly)
- Blue arrow curve = non-linear motion (S-curve = smooth acceleration/deceleration)
- Multiple blue arrows in one grid = complex camera choreography (e.g., pan + tilt + zoom combined)

**Micro-Shot Decomposition for Emotional Beats:**

- High-impact moments (e.g., character discovering key object) → split into 3 grids:
  - Grid 1: Wide shot (character approaches)
  - Grid 2: Medium shot (character reacts, hand reaches)
  - Grid 3: Extreme close-up (object reveal, emotional peak)

**BGM-Scene Sync Optimization:**

- Map music structure to narrative beats BEFORE video generation:
  - Piano intro = forest entrance (0-30s)
  - Strings swell = shop discovery (30-60s)
  - Melancholic melody = memory reveal (60-90s)
  - Hopeful resolution = reunion scene (90-120s)
- Provide BGM structure to video prompts for pacing alignment (e.g., "slow contemplative pace matching gentle piano melody")