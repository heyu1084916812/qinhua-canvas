# Cinematic Storyboard Video Production

## Core Methodology

### Dual-Layer Anchor Architecture

The foundation of consistent multi-segment video production lies in separating immutable identity from mutable context through a two-tier reference system:

**Character Anchors (Immutable Layer)**

- Purpose: Establish pixel-level consistent character identity across all shots
- Components: Face structure, skin tone, body proportions, signature styling elements
- Generation: Create full-body portrait images with neutral backgrounds using highly detailed prompts
- Reference Strategy: Every video segment must include character anchor image URLs in the prompt
- Consistency Rule: Character anchors NEVER change once established, even if clothing/pose/scene varies

**Scene Anchors (Mutable Environment Layer)**

- Purpose: Define spatial context, architectural elements, color palette, lighting conditions
- Components: Location type, architectural style, dominant colors, light quality, atmospheric elements
- Generation: Create wide-angle environment images without characters
- Reference Strategy: Each segment references its specific scene anchor to maintain spatial continuity
- Flexibility Rule: Scene anchors can evolve between segments to support narrative progression

**Cross-Reference Logic**

- Single segment = Character Anchor(s) + Scene Anchor + Action/Composition prompt
- Character anchors ensure "who" remains consistent
- Scene anchors ensure "where" remains coherent
- Prompt engineering bridges "what happens" between the two

### Visual Gene Lock System

A hierarchical constraint framework that encodes non-negotiable aesthetic rules:

**Tier 1: Immutable Laws (100% Enforcement)**

- Color System: Define exact palette (e.g., "unified pink-purple warm tones, no cold colors"), specify shadow/highlight behavior, ban incompatible hues
- Compositional Grammar: Absolute symmetry vs controlled asymmetry, frame-within-frame requirements, horizon line positioning rules
- Camera Movement Protocol: Allowed movements (e.g., horizontal tracking only), forbidden movements (e.g., handheld shake, rapid zoom), transition methods between shots
- Aspect Ratio Strategy: Fixed ratio vs narrative-driven ratio changes (e.g., 1.37:1 for intimacy → 2.35:1 for epic scope)

**Tier 2: Flexible Parameters (Guideline-Level)**

- Lighting mood variations within color constraints
- Camera angle alternatives that preserve symmetry rules
- Minor prop/costume adjustments that don't break character identity

**Tier 3: Creative Variables (Per-Segment Freedom)**

- Character poses and gestures
- Scene-specific action beats
- Transitional elements between segments

**Implementation Method**

- Encode Tier 1 rules into a reusable "negative prompt" block for all generations
- Build Tier 2 rules into prompt templates with clear value ranges
- Document Tier 3 variables in segment-specific prompt sections

### Modular Prompt Framework

Structured prompt construction for maximum consistency and controllability:

```
[Style Tags] + [Scene Setting] + [Character Action] + [Camera Specs] + [Lighting] + [Negative Constraints]
```

**Style Tags** (First 10-15 words)

- Cinematography type: "Live-action cinematography", "35mm film look", "anamorphic widescreen"
- Director aesthetic: "Wes Anderson symmetrical composition", "Wong Kar-wai neon-soaked palette"
- Film stock reference: "with slight grain", "Kodak Vision3 color science"

**Scene Setting** (20-30 words)

- Physical space: architecture type, key props, spatial layout
- Scene anchor integration: "\[@image:#N:scene_description:URL\]"
- Environmental storytelling elements

**Character Action** (30-40 words)

- Character anchor integration: "\[@image:#N:character_name:URL\]"
- Pose description: body position, hand placement, facial expression
- Interaction with environment: what they're touching, looking at, moving toward
- Clothing details relevant to this specific shot (if different from anchor)

**Camera Specs** (15-20 words)

- Shot type: wide shot, medium shot, close-up
- Camera movement: tracking, static, slow push-in
- Framing rules: rule of thirds, centered composition, dutch angle
- Aspect ratio specification if different from default

**Lighting** (10-15 words)

- Light source type and direction
- Color temperature adhering to visual gene lock
- Shadow characteristics

**Negative Constraints** (comprehensive block)

- All Tier 1 visual gene lock violations
- Common AI generation errors for this style
- Specific undesired elements from previous iterations

## Workflow

### 1. Preparation Stage

**Pre-Production Checklist**

- Define narrative theme and emotional arc
- Determine segment count and runtime allocation
- Establish visual style reference (director aesthetic, color palette, aspect ratio)
- List all characters with detailed descriptions
- List all locations with spatial requirements
- Create visual gene lock document with Tier 1/2/3 rules

**Asset Inventory Setup**

- Create character anchor checklist (one per major character)
- Create scene anchor checklist (one per distinct location)
- Prepare segment breakdown table with columns: Segment #, Duration, Location, Characters, Key Action, Camera Movement

**Critical Decisions Before Execution**

- Aspect ratio strategy: fixed or narrative-driven changes?
- Character consistency priority: exact costume match vs identity-only match?
- Scene transition method: hard cuts, crossfades, or in-camera transitions?
- BGM approach: pre-composed track or post-production scoring?

### 2. Anchor Generation Stage

**Character Anchor Production**

For each character:

1. Write detailed character portrait prompt following this structure:

   - Subject framing: "Live-action character portrait"
   - Demographics: age range, ethnicity, gender
   - Physical features: face shape, hairstyle, body type
   - Clothing: complete outfit description with fabric details
   - Accessories: jewelry, props, signature items
   - Expression: emotional baseline for this character
   - Background: neutral or style-matching environment
   - Technical specs: lighting, film look, composition type

2. Generate character anchor image

3. Quality check:

   - Does face have clear features suitable for AI reference?
   - Is clothing detailed enough to be recognizable?
   - Does overall aesthetic match visual gene lock?
   - Would this image produce consistent results if referenced 10+ times?

4. If check fails: regenerate with refined prompt

5. Archive approved anchor with naming: `character_[name]_anchor.png`

**Scene Anchor Production**

For each location:

1. Write scene environment prompt:

   - Cinematography framing: "Wes Anderson symmetrical wide shot"
   - Location type: interior/exterior, specific room/space
   - Architectural style: period, aesthetic movement, cultural context
   - Color palette: exact hues matching visual gene lock
   - Key props and set dressing
   - Lighting setup: source, quality, color temperature
   - Atmospheric elements: fog, dust particles, light beams
   - No characters (or silhouettes only if spatially necessary)

2. Generate scene anchor image

3. Quality check:

   - Does space have clear geometric structure?
   - Is color palette exactly matching visual gene lock?
   - Are there sufficient anchor points for character placement?
   - Does lighting create mood without overexposure?

4. Archive approved anchor with naming: `scene_[location]_anchor.png`

**Anchor Cross-Reference Matrix**

Create a mapping table:

SegmentCharactersSceneSpecial Notes01Character AScene 1First appearance, establish baseline02Characters A, BScene 2Character B enters, test interaction............

### 3. Segment Video Generation Stage

**Prompt Assembly for Each Segment**

1. Load segment specifications from breakdown table

2. Retrieve required character and scene anchor URLs

3. Construct prompt using Modular Prompt Framework:

   ```
   [Style Tags from visual gene lock]
   [Scene description + scene anchor: [@image:#N:scene_name:URL]]
   [Character A description + anchor: [@image:#N:char_A:URL]]
   [Character B description + anchor: [@image:#N:char_B:URL]] (if applicable)
   [Action narrative for this segment]
   [Camera movement and framing]
   [Lighting details]
   [Negative prompt block from visual gene lock]
   ```

4. Specify video generation parameters:

   - Duration: per segment allocation
   - Aspect ratio: per visual gene lock or segment-specific requirement
   - Motion level: based on action intensity
   - Model selection: use latest available cinematic model

5. Generate video

**Quality Audit Checklist**

For each generated segment:

**Character Identity Fidelity**

- \[ \] Face matches character anchor (if visible)
- \[ \] Body proportions match anchor
- \[ \] Clothing matches description (color, style, key details)
- \[ \] Movement feels natural for character personality

**Scene Spatial Coherence**

- \[ \] Environment matches scene anchor architecture
- \[ \] Color palette adheres to visual gene lock
- \[ \] Lighting direction is consistent
- \[ \] Props and set dressing are present

**Aesthetic Compliance**

- \[ \] Compositional rules followed (symmetry, framing, etc.)
- \[ \] Camera movement matches specified protocol
- \[ \] No forbidden elements from negative prompt appear
- \[ \] Film grain/texture matches style specification

**Regeneration Decision Tree**

- Critical failure (character face wrong, wrong color palette, broken composition) → **MUST regenerate**
- Major deviation (clothing significantly off, lighting too different) → **SHOULD regenerate**
- Minor variance (slight pose difference, small prop missing) → **ACCEPTABLE, note for next iteration**

### 4. Synthesis & Finalization Stage

**Video Segment Sequencing**

1. Review all approved segment videos in chronological order

2. Check transition points:

   - Does action flow logically between segments?
   - Are there jarring visual jumps (lighting, color, spatial orientation)?
   - Do character positions make spatial sense across cuts?

3. If transition issues exist:

   - Option A: Regenerate problematic segment with transition-aware prompt
   - Option B: Add transition element (crossfade, black frame, graphic element)

**BGM Integration**

1. Analyze emotional arc across segments

2. Define BGM requirements:

   - Instrumentation matching film aesthetic (e.g., string quartet for period piece)
   - Tempo changes aligned with segment pacing
   - Total duration = sum of all segments

3. Generate or select background music

4. Review music against video for sync points

**Final Assembly**

1. Concatenate video segments in order

2. Mix BGM into composite video:

   - Adjust volume to not overpower ambient sound
   - Fade in at start, fade out at end
   - Consider diegetic vs non-diegetic sound logic

3. Add title cards or credits if required

4. Export final composite video

**Deliverable Package**

- Final composite video
- Individual segment videos (for future reuse/editing)
- All character anchor images
- All scene anchor images
- Production notes document with prompts and decisions

## Key Constraints & Standards

### Immutable Rules

**Character Identity Consistency**

- Once a character anchor is approved, facial features CANNOT change across any segment
- Acceptable variations: lighting, angle, expression
- Unacceptable variations: different face structure, ethnicity shift, body type change
- Test: If you showed segment 1 and segment 10 to a viewer, they must immediately recognize it's the same person

**Visual Gene Lock Enforcement**

- Color palette rules are absolute — if the lock specifies "no cold tones", a single blue-tinted shot invalidates the entire sequence
- Compositional grammar must be consistent — if "absolute symmetry" is specified, every frame must obey
- Camera movement protocol violations break cinematic language cohesion

**Spatial Logic Preservation**

- Characters cannot teleport between non-connected spaces without transition
- Lighting direction must be consistent within continuous scenes
- Architectural elements (doors, windows, furniture) must maintain relative positions

### Fidelity Rules

**Anchor Reference Precision**

- Every character appearance MUST include their anchor image URL in the prompt
- Scene anchor URLs MUST be included even if describing the same location verbally
- Never rely on "the AI will remember" — always explicitly reference

**Prompt Completeness Standard**

- Every prompt must contain all six elements of Modular Prompt Framework
- Negative prompt block must include ALL Tier 1 visual gene lock rules
- Character descriptions must include both anchor reference AND segment-specific details (pose, action, clothing variations)

**Regeneration Discipline**

- Do not accept "close enough" on character face mismatches
- Do not rationalize color palette violations as "artistic choice"
- Do not proceed to next segment if current segment fails critical quality checks

### Consistency Audit Rules

**Cross-Segment Continuity Checks**

Perform these checks after generating every 2-3 segments:

1. **Character Identity Drift Detection**

   - Export frame from segment 1 and latest segment
   - Place side-by-side
   - Check: face shape, skin tone, hair texture, body proportions
   - If drift detected: identify where it started, regenerate from that point

2. **Color Palette Deviation Analysis**

   - Sample dominant colors from each segment (use color picker tool)
   - Compare against visual gene lock color specifications
   - Acceptable variance: ±5% hue/saturation within specified palette
   - If deviation exceeds threshold: regenerate offending segment

3. **Spatial Continuity Verification**

   - Map character movements across segments
   - Check: Do they enter/exit from correct screen directions?
   - Check: Are environmental props in consistent positions?
   - If spatial logic breaks: add transition element or regenerate

**Batch Size Optimization**

- Generate 2-5 segments before synthesis attempt
- Smaller batches (2-3) = easier to maintain consistency, more regeneration opportunities
- Larger batches (4-5) = faster production, but higher risk of accumulated drift
- For first-time productions: use 2-segment batches until quality is stable

## Recommended Tools & Models

Use **Seedance 2.0** (referenced as \[@tool:generate_video_seedance_v2_0:Seedance 2.0:ICON_URL\] in context) for video generation. This model is optimized for:

- Character anchor image referencing
- Cinematic camera movements
- Maintaining visual consistency across multiple generations
- High-fidelity detail preservation

## Advanced Techniques

### Aspect Ratio as Narrative Tool

**Technique**: Change aspect ratio between segments to signal narrative shifts

**Application Logic**:

- 1.37:1 (Academy Ratio): Intimate, constrained, character-focused scenes
- 16:9 (Standard Widescreen): Neutral, default for most content
- 2.35:1 (Anamorphic): Epic scope, landscape emphasis, emotional climax

**Implementation**:

1. Define aspect ratio progression in visual gene lock (e.g., 1.37:1 → 2.35:1 → 1.37:1)
2. Specify transition method: hard cut vs gradual letterbox reveal
3. In prompts, explicitly state aspect ratio for each segment
4. During synthesis, use video editing to implement letterbox transitions if gradual reveal is desired

**Example Application** (from Budapest Hotel workflow):

- Segments 1-3: 1.37:1 (character trapped in hotel's constrained world)
- Segment 4: 2.35:1 (cable car escape, world expands)
- Segment 5: 1.37:1 (return to hotel, closure)

### Micro-Variation Control

**Problem**: Achieving variation without breaking consistency

**Solution**: Layered Element Isolation

Treat each video generation as 5 independent controllable layers:

**Layer 1 — Character Identity** (LOCKED)

- Face, skin tone, body shape from anchor
- Never changes

**Layer 2 — Character Styling** (VARIABLE)

- Clothing, accessories, hair styling
- Changes per segment as needed
- Prompt: "\[Character anchor\], wearing \[new outfit\]"

**Layer 3 — Character Action** (VARIABLE)

- Pose, gesture, movement
- Changes per shot requirement
- Prompt: "\[Character\], \[action verb + details\]"

**Layer 4 — Scene Environment** (SEMI-LOCKED)

- Locked: architectural structure, color palette (from scene anchor)
- Variable: lighting angle, prop arrangement
- Prompt: "\[Scene anchor\], with \[lighting variation\]"

**Layer 5 — Camera** (VARIABLE per rules)

- Within visual gene lock rules, change angle/movement per segment
- Prompt: "\[approved camera movement\], \[approved framing\]"

**Practical Application**:

- When generating segment prompts, explicitly call out which layers are changing
- Example: "Segment 3: Layer 2 change (character now wearing coat), Layer 3 change (character walking instead of standing), Layers 1/4/5 locked"

### Multi-Character Scene Orchestration

**Challenge**: Maintaining identity consistency for 2+ characters in same shot

**Technique**: Sequential Anchor Stacking

1. **Prioritize Character Hierarchy**

   - Primary character: most screen time, most critical to story
   - Secondary characters: supporting roles
   - Background characters: minimal detail needed

2. **Anchor Placement Order in Prompt**

   - List primary character anchor first with most detailed description
   - List secondary character anchor second with medium detail
   - Describe background characters verbally without anchors

3. **Spatial Separation Strategy**

   - Position characters with clear spatial gaps (different depth planes, screen thirds)
   - Use "in foreground" / "in background" / "left side" / "right side" descriptors
   - Avoid overlapping character positions in prompt

4. **Quality Check Priority**

   - Primary character face must be perfect
   - Secondary character must be recognizable (allow minor variance)
   - Background characters must not distract

**Example Prompt Structure**:

```
[Style tags], [scene anchor: URL], 
[Primary character A anchor: URL], wearing [outfit], [action], positioned in foreground center,
[Secondary character B anchor: URL], wearing [outfit], [action], positioned in background left,
third person in background right wearing [description],
[camera specs], [lighting], [negative prompt]
```