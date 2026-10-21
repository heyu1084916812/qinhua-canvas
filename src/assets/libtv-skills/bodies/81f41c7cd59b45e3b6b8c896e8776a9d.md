# Mythological Character Video Creation

## Core Methodology

### Character Portfolio Matrix

Systematically decompose cultural character groups into individual visual units:

**Dimensional Structure:**

- **Character Layer**: Each individual's unique identity (appearance, costume, accessories)
- **Iconography Layer**: Signature artifacts/instruments (weapon, tool, symbolic object)
- **Lighting Layer**: Character-specific color palette and luminosity (warm gold, cold blue, sacred white)
- **Pose Layer**: Personality-driven body language (dignified, playful, heroic)

**Standard workflow for character sets:**

1. Catalog all characters with primary trait + artifact + light color
2. Generate in batch with consistent base style (e.g., "3D photorealistic + fantasy lighting")
3. Maintain unified technical specs (resolution, angle, composition depth) across all portraits
4. Validate each character's visual distinctiveness before proceeding to video stage

### Sequential Narrative Storyboarding

Break story into discrete visual beats with mathematical precision:

**Shot Structure Framework:**

- **Anchor Scene** (Opening): Establish ensemble + setting + atmospheric tone → 5s
- **Individual Spotlight Scenes**: One character per shot, demonstrating unique ability → 4-5s each
- **Convergence Scene** (Closing): All characters reunite, visual effects climax → 5-10s

**Shot Count Formula**:Total shots = 1 (opening) + N (individual character count) + 1 (closing) + optional extended effects shots

**Timing Calibration:**

- Character intro shots: 4-5 seconds (enough to register action, not drag)
- Opening/closing scenes: 5-10 seconds (allow atmospheric establishment)
- Effects-heavy finale: 10-15 seconds if adding text/light compositing

### Parallel Production Pipeline

Leverage batch generation to compress timeline:

**Stage 1 — Image Asset Generation**:Generate ALL character portraits in one batch → validate consistency → proceed only when complete set approved

**Stage 2 — Video Storyboard Production**:Split into parallel batches:

- Batch A: Shots 1-5
- Batch B: Shots 6-10 Generate simultaneously, merge chronologically

**Stage 3 — Composite Assembly**:Linear process:

1. Verify all shots render correctly (no corruption, duration matches spec)
2. Concatenate in narrative sequence
3. Add final effects shots (text overlays, light convergence)
4. Final composite merge

### Effects Overlay Logic

Visual effects must serve narrative beats:

**Text Emergence Pattern:**

- Character artifacts emit light rays → rays converge at center frame → form glowing text → hold for 2-3s
- Light color must inherit from character palette (e.g., eight-character group = eight-color convergence)

**Camera + Motion Rules:**

- Opening scene: Slow forward dolly or crane up (grandeur)
- Character shots: Locked camera with character action only (clarity)
- Closing scene: Slow circular orbit or crane out (closure)

## Workflow

### 1. Preparation Stage

**Character Inventory Checklist:**

- \[ \] Character name list (N characters)
- \[ \] Core trait per character (one defining feature)
- \[ \] Signature artifact per character (visual anchor)
- \[ \] Color/light assignment per character (visual coding system)

**Narrative Scenario Definition:**

- \[ \] Story arc (e.g., "characters demonstrate abilities then reunite")
- \[ \] Key visual beats (opening → individual showcases → convergence)
- \[ \] Total runtime target (character count × 4-5s + opening/closing scenes)

**Style Reference Establishment:**

- \[ \] Visual aesthetic keyword set (e.g., "3D photorealistic", "fantasy lighting", "cinematic epic")
- \[ \] Reference images (if available, for visual consistency)
- \[ \] Technical specs (resolution, aspect ratio — default 16:9 for video)

### 2. Initial Generation Stage

**Phase 2.1 — Character Portrait Batch**

Prompt Framework:

```
[Character name], [defining trait], [artifact/instrument], [pose/action], [light color + intensity], [unified base style], [technical specs]
```

Example: "Iron Crutch Li, disheveled appearance, leaning on iron crutch holding gourd, golden celestial aura emanating, 3D photorealistic + fantasy lighting, cinematic quality, front view medium shot"

**Batch Execution:**

1. Generate all N characters in one session
2. Visual audit: Check each character's distinctiveness (no duplicate appearance/artifacts)
3. Consistency audit: Verify style uniformity (lighting quality, render fidelity, composition angle)
4. Accept or regenerate outliers before proceeding

**Phase 2.2 — Storyboard Design**

Create shot breakdown table:

Shot #Scene DescriptionCharacter(s)DurationKey Visual Element001Opening ensembleAll5sAtmospheric establishment002-N+1Individual showcasesOne per shot4-5s eachArtifact in actionN+2Convergence finaleAll5-10sLight/text effect

**Phase 2.3 — Video Generation (Parallel Batches)**

Prompt Framework per Shot:

```
[@image:#N:character_portrait:URL], [action description], [camera movement], [environment/background], [lighting effect], [duration: Xs], [style: cinematic/epic]
```

Example: "\[@image:#1:Iron_Crutch_Li:URL\], standing on golden gourd floating over ocean waves, gourd emits golden celestial mist parting waters, slow forward camera dolly, dramatic ocean spray backlight, 5 seconds, cinematic epic fantasy"

**Batch A (Shots 1-5):** Generate opening + first 4 character shots **Batch B (Shots 6-N+1):** Generate remaining character shots **Render in parallel, then validate all outputs**

### 3. Iteration & Refinement Stage

**Dimensional Optimization Checklist:**

**Visual Consistency Dimension:**

- \[ \] All shots maintain same color grading and lighting quality
- \[ \] No sudden stylistic jumps between cuts
- \[ \] Character appearance matches portrait reference in video shots

**Narrative Flow Dimension:**

- \[ \] Shot sequence follows logical story progression
- \[ \] Transition pacing feels natural (no abrupt cuts)
- \[ \] Each character gets equal screen presence (4-5s per individual shot)

**Technical Quality Dimension:**

- \[ \] No video corruption or artifacts
- \[ \] Duration matches storyboard spec (±0.5s tolerance)
- \[ \] All shots render at target resolution

**Effects Integration Dimension (if applicable):**

- \[ \] Text overlay timing (appears after character convergence, holds 2-3s)
- \[ \] Light convergence effect aligns with character positions
- \[ \] Final shot provides clear visual closure (no awkward hang)

**When to Regenerate vs Accept:**

- **Regenerate if:** Character identity unrecognizable, major style break, technical corruption
- **Accept if:** Minor lighting variation, slight duration drift (&lt;1s), acceptable composition shift

**Extended Effects Shot Addition**:If adding finale effects (text emergence, light convergence):

1. Generate as separate 10-15s shot using group portrait as image reference
2. Prompt must specify: character positions + artifact light emission + text formation sequence
3. Concatenate with main composite as final shot

## Key Constraints & Standards

### Immutable Character Identity Rules

- Each character's defining trait (appearance, costume, artifact) must be pixel-consistent across portrait and video shots
- Artifact iconography must never swap between characters (e.g., sword-wielder cannot suddenly hold flute)
- Character count in ensemble scenes must exactly match N (no missing or duplicate characters)

### Visual Fidelity Standards

- Base style descriptor (e.g., "3D photorealistic + fantasy lighting") must appear in every single prompt
- Light color assignments per character are locked after portrait generation phase
- Camera angle should remain consistent within character spotlight shots (typically front 3/4 view or profile)
- Background complexity should not overwhelm character focus (character remains primary visual anchor)

### Timing & Pacing Constraints

- Individual character showcase: 4-5 seconds (minimum 3s to register action, maximum 6s to avoid drag)
- Opening/closing ensemble scenes: 5-10 seconds (atmospheric establishment requires ≥5s)
- Effects-heavy finale with text: 10-15 seconds (light convergence + text hold requires ≥8s)
- Total runtime formula: (N characters × 4.5s average) + 10s opening + 10s closing ≈ 20s + (N × 4.5s)

### Storyboard Structure Rules

- Minimum 3 shots: opening + ≥1 character showcase + closing
- Character showcases must appear in consistent order (no random shuffling mid-edit)
- No character can appear in multiple individual spotlight shots (one showcase per character)
- Final convergence scene is mandatory (narrative closure requirement)

### Batch Production Consistency

- All shots in one batch must be generated with identical model version and parameters
- Parallel batches should split at natural narrative break points (e.g., after first half of characters)
- Shot validation must complete for one batch before starting next batch generation

### Effects Overlay Technical Requirements

- Text overlay: Must use image reference showing desired character arrangement
- Light convergence: Emission points must align with character artifact positions in reference image
- Text content: Maximum 2-4 Chinese characters or 8-12 English letters (readability at video scale)
- Hold duration: Text must remain readable for minimum 2 seconds before video end

### Composite Assembly Rules

- Shot concatenation must preserve source framerate (no framerate conversion artifacts)
- Audio track (if present) must be continuous without pops/clicks at cut points
- Final duration must match sum of individual shot durations (±1s tolerance)
- Export format: Minimum 1080p resolution, H.264 codec, 16:9 aspect ratio

## Recommended Tools & Models

- **Seedream 5.0 Pro**: Use for high-quality character portrait generation with 3D photorealistic rendering and fantasy lighting effects
- **Seedance 2.0 Fast VIP**: Use for video generation of individual character action shots and ensemble scenes with cinematic motion

## Example

**Scenario:** "Eight Immortals Crossing the Sea" video series

**Phase 1 — Character Portraits:**

- Generate 8 portraits (Iron Crutch Li with crutch + gourd + golden light, Han Zhongli with banana fan + warm gold aura, Zhang Guolao riding donkey backwards + fishing drum + cold blue glow, etc.)
- Validate: Each character visually distinct, unified "3D photorealistic + fantasy lighting" style

**Phase 2 — Storyboard:**

- Shot 001: Eight immortals gather at Penglai Island, blue-purple atmospheric light, 5s
- Shot 002-009: Each immortal crosses ocean using their artifact (gourd-surfing, fan-flying, donkey-riding, etc.), 4-5s each
- Shot 010: Eight immortals converge on far shore, eight light rays meet, 5s
- Shot 011 (extended): Artifacts emit light forming "八仙" text, hold 10s

**Phase 3 — Video Generation:**

- Batch A: Generate shots 001-005
- Batch B: Generate shots 006-010
- Generate extended shot 011 separately using group portrait reference
- Concatenate all shots into final 60s composite

**Final Output:**

- 60-second video, 1080p 16:9
- 10 narrative shots + 1 effects shot
- Cinematic epic fantasy visual style with character-specific light color coding