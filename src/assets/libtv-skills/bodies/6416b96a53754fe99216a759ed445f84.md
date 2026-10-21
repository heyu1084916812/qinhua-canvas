# Felt Stop-Motion Animation Production

## Core Methodology

### Framework 1: Anchor Asset Hierarchy

All visual elements exist in a three-tier reference system:

**Tier 1 - Character Anchors (A01-A0N)**

- Purpose: Lock identity consistency across all shots (face, body proportions, material texture)
- Constraint: Must be solo portraits on neutral backgrounds, full-body visibility
- Material encoding: Specify fabric type (short-pile felt, knit yarn, corduroy), button eye stitch pattern (cross, horizontal line, circle), unique identifiers (crooked ear, embroidered mark, worn patches)
- Naming convention: A\[number\]·\[Character Name\]·\[Defining Feature\]
- Why: AI video models struggle with multi-shot character consistency—anchors serve as visual DNA that can be referenced in every prompt

**Tier 2 - Scene Anchors (S01-S0N)**

- Purpose: Establish location identity and environmental atmosphere
- Constraint: Must be character-free pure environments (characters added during video generation)
- Derivation logic: Base scenes can spawn variants (S01 Village → S05 Village with Giant Bear Background → S06 Post-Battle Village)
- Why: Character-free scenes prevent visual conflicts when compositing multiple characters; scene variants encode narrative progression

**Tier 3 - Prop Anchors (P01-P0N)**

- Purpose: Lock key object designs that carry narrative significance
- Constraint: Isolated on neutral background with multiple angles if needed
- Why: Magical/symbolic objects need pixel-perfect consistency for narrative coherence

**Cross-Tier Derivation Rule**: When a character appears in a scene concept image, mark it \[Character Present\] and regenerate a \[Character-Free\] version immediately.

### Framework 2: First-Frame Composition Locking (for Extreme Scale Relationships)

When a shot requires extreme scale disparity that AI tends to normalize:

**Trigger Conditions**:

- Tiny character on giant character (e.g., cat on bear's nose)
- Vertical depth with foreground/midground/background in 1:10:100 scale
- Any shot with "巨大" (giant) in description that fails twice with normal prompts

**Execution Protocol**:

1. Generate a **composition anchor image** specifying exact screen percentages (e.g., "giant bear occupies upper 70% of frame, tiny cat 2% at nose tip, warrior at bottom 10%")
2. Tag the composition anchor with \[@image:composition_lock\]
3. Use this image as the video's first frame in image-to-video generation
4. In the video prompt, only describe actions/movements—do NOT re-specify scale (the first frame locks it)

**Why it works**: AI video models inherit spatial relationships from the first frame but tend to "normalize" extreme scales when only text-prompted. First-frame locking overrides this normalization bias.

### Framework 3: Deviation Diagnostic Matrix

When a generated video doesn't match the storyboard, classify the deviation into one of four types:

Deviation TypeSymptomsDiagnostic QuestionsFix Strategy**Scale Distortion**Giant character appears normal-sized; forced perspective collapsesIs the size difference &lt; 3x? Is the camera angle eye-level?Apply First-Frame Locking (Framework 2)**Composition Stasis**Fixed camera, no shot variety, flat stagingIs it one static wide shot? Missing close-ups?Break into 3-5 sub-beats with explicit camera instructions ("low-angle push-in → extreme close-up → side tracking")**Action Omission**Key actions described in prompt are missingWhich beats are missing? Which character?Add missing character anchors; split into separate shots if &gt;3 actions in one prompt**Character Substitution**Wrong character appears or character features mutateDoes the character match its anchor?Re-reference character anchor node_key; if persistent, regenerate anchor with more distinctive features

**Retry Protocol**:

- 1st retry: Enhance prompt constraints (more explicit, add negative prompts)
- 2nd retry: Apply first-frame locking if scale-related
- 3rd retry: Split shot into 2-3 simpler sub-shots and sequence them

### Framework 4: Felt Material Physics System (Non-Negotiable)

Every visual element must obey felt/yarn/cotton physics:

**Fur Behavior Library**:

- Flatten-and-rise: Fur pressed down slowly springs back fiber-by-fiber
- Puff explosion: Sudden shock causes fur to triple in volume, then gradually settle
- Gravity droop: Hanging upside down causes all fur to point downward in unified direction
- Static cling: Fur-to-fur contact creates fine connecting threads when separated
- Wind blow: Fur blown in one direction reveals rounded fabric body underneath
- Wear patterns: High-contact areas (elbows, seat) show matted fur exposing base fabric

**Button Eye Emotion Encoding**:

- Neutral: X-stitch or single horizontal line
- Happy: Stitches curve into upward arc
- Surprised: Circular thread loop
- Cross-eyed: Both pupils pulled toward center
- Scared: Stitches tighten, pupil contracts

**Collision Response**:

- All impacts produce soft muffled sounds
- Contact points compress, then bounce back with cottony elasticity
- No sharp sounds—everything filtered through yarn/cotton medium

**Why this matters**: Felt stop-motion has a specific material language. Violating it (smooth surfaces, hard collisions, realistic fur) breaks the aesthetic consistency.

## Workflow

### Stage 1: Pre-Production Asset Generation

**Preparation Checklist**:

- \[ \] Story synopsis with character list and key locations
- \[ \] Character material specifications (fabric type, button style, unique markers)
- \[ \] Scene inventory (base locations + narrative variants)
- \[ \] Prop list (magical objects, key items)

**Execution Sequence**:

1. Generate all character anchors (A01-A0N) in parallel
2. Generate base scene anchors (S01-S0N), verify character-free
3. Generate prop anchors (P01-P0N) if needed
4. Create anchor registry file: `/anchors/[project]_anchors.md` with node_key index

**Quality Checklist per Anchor**:

- \[ \] Character anchors: Solo on neutral BG, full body visible, distinctive material markers clear
- \[ \] Scene anchors: Zero characters present, environment lighting/atmosphere matches story needs
- \[ \] Prop anchors: Isolated object, multiple angles if complex
- \[ \] All anchors tagged with persistent node_key for referencing

### Stage 2: Storyboard Execution

**Preparation Checklist**:

- \[ \] Anchor registry complete
- \[ \] Storyboard with 12 beats (for 90s video) or N beats (for custom duration)
- \[ \] Each beat specifies: duration, camera movement, character actions, emotional arc

**Shot Generation Protocol**:

1. **Batch Planning**: Group shots by location/character combo (e.g., "all shots in S01 Village with A01+A02")
2. **Parallel Generation**: Generate 3-5 shots simultaneously to optimize production time
3. **Per-Shot Prompt Structure**:

   ```
   Felt stop-motion style, [specific material details from anchors]
   Reference anchors: [@image:A01:node_key] [@image:S02:node_key]
   
   Camera: [movement type + angle]
   Action beat 1: [Character] does [action with felt physics]
   Action beat 2: [Character] does [action with felt physics]
   [Continue for up to 3 beats per shot—if more, split into separate shots]
   
   Negative: smooth plastic, photorealistic fur, hard surfaces, sharp shadows, metallic reflections
   ```
4. **Record to Storyboard File**: After generation, log shot node_key in `/story_boards/[project]_storyboard.md`

**Iteration Stage**:

- Review each shot against storyboard requirements
- For deviations: Apply Deviation Diagnostic Matrix (Framework 3)
- Mark failed shots as \[Deprecated\], generate \[Remake\] or \[Remake 2\] versions
- Maintain version history in storyboard file

### Stage 3: Refinement & Special Shots

**Trigger Scenarios**:

- User requests new shots ("add a shot of X doing Y")
- Extreme scale relationships failing repeatedly
- Complex multi-character interactions

**First-Frame Locking Workflow** (for extreme scale shots):

1. Generate composition anchor image with explicit screen percentage layout
2. Use composition anchor as video first frame
3. In video prompt, describe only the actions/movements (scale is locked by first frame)
4. Tag shot with \[First-Frame Locked\] in storyboard

**Comedy/Exaggeration Technique Library**:

- **Spring Kick**: Character leg stretches impossibly long → releases → character flies backward
- **Impact Ripple**: Ground fabric ripples outward from impact point
- **Speed Lines**: Yarn fiber trails during fast motion
- **Cross-Eye Beat**: Character reacts to shock with pupils pulling inward
- **Dangling Fur**: Upside-down character has all fur pointing down
- **Stretch-and-Snap**: Character body elongates during motion, snaps back on landing

### Stage 4: Assembly & Composition

**Preparation Checklist**:

- \[ \] All shots generated and logged with node_key
- \[ \] Shot order confirmed in storyboard file
- \[ \] Transition types noted (cut, fade, action-match)

**BGM Generation** (if needed):

- Generate background music matching emotional arc
- Tag style: "soft piano → tense strings → orchestral climax → warm piano → lullaby"
- All audio filtered through "muffled in cotton" quality for consistency

**Final Composition**:

1. Merge all shots in storyboard order using node_key references
2. If BGM exists, mix it with the merged video
3. Generate final output node_key
4. Export final storyboard file + anchor registry as project deliverables

**Version Control**:

- Maintain clear \[Original\] → \[Remake\] → \[Remake 2\] lineage in storyboard file
- Deprecated shots remain documented but marked \[Deprecated: reason\]

## Key Constraints & Standards

### Immutable Visual Rules (Override All Other Instructions)

1. **Material Purity**: Every visible element must be felt/yarn/cotton. No smooth plastics, photorealistic fur, metal reflections, or hard surfaces.
2. **Button Eye Lock**: All characters use button eyes with visible stitch patterns for pupils. No realistic eyes.
3. **Visible Craftsmanship**: Seams, stitching, raw fabric edges, embroidery are aesthetic elements, not flaws—preserve them.
4. **Soft Collision System**: All impacts are muffled thuds, no sharp clangs. All motion filtered through fabric medium.
5. **Scale Through First-Frame Lock**: For giant vs. tiny scenarios, always use first-frame composition locking after second failure.

### Character Consistency Rules

1. **Anchor Fidelity**: Characters must match their anchor image in: fabric type, button eye stitch pattern, body proportions, unique markers (crooked ear, embroidered symbol, worn patches).
2. **Cross-Shot Identity**: Same character in different shots must be pixel-recognizable through distinctive fabric textures and markers.
3. **Emotion Through Stitches**: Character emotions expressed through button eye stitch deformation, not facial muscle movement.

### Scene Consistency Rules

1. **Character-Free Anchor Mandate**: All scene anchors must be generated without characters—characters added during shot generation only.
2. **Scene Derivation Logic**: Narrative progression encoded through scene variants (Base → Event-Modified → Post-Event), all derived from same base anchor.
3. **Lighting Consistency**: Scenes within same act maintain unified lighting (warm golden morning, deep blue night, etc.).

### Felt Physics Standards (Testable)

1. **Fur Flatten-Rise Time**: Pressed fur takes 0.5-1 second to fully spring back.
2. **Puff Explosion Multiplier**: Shocked fur expands to 2-3x normal volume, then gradually settles.
3. **Static Thread Count**: Separating fur-to-fur contact produces 5-20 visible fine connecting threads.
4. **Gravity Droop Angle**: Hanging upside-down character has all fur pointing within 10° of straight down.
5. **Collision Compression**: Impact compresses fabric to 60-70% original thickness, then bounces back.

### Deviation Correction Standards

1. **Scale Distortion Threshold**: If giant/tiny ratio &lt; 5:1 in generated video, apply first-frame locking.
2. **Action Omission Limit**: If ≥2 key actions missing from prompt, split into separate shots.
3. **Retry Cap**: Maximum 3 remake attempts per shot—if third fails, split into 2-3 simpler sub-shots.
4. **Anchor Update Trigger**: If character substitution persists after 2 retries with correct anchor reference, regenerate anchor with more distinctive features.

### Technical Composition Standards

1. **Shot Length**: 5-10 seconds per shot for 90-second films (12 shots total).
2. **Transition Matching**: Action-match transitions require last frame of Shot A to align with first frame of Shot B in character position/pose.
3. **BGM Integration**: Background music must match felt aesthetic ("muffled in cotton" quality filter).
4. **File Naming**: All assets follow pattern \[Type\]\[Number\]·\[Name\]·\[Variant\] (e.g., A01·小绒球, S05·棕色小山, v-abc123·镜4重制三).

## Recommended Tools & Models

This workflow was built using \[@tool:star-video2:Seedance 2.0 VIP:ICON_URL\] for video generation. The first-frame locking strategy and anchor referencing system are optimized for image-to-video models that support multi-reference inputs.

## Advanced Techniques

### Technique 1: Comedy Three-Beat Structure

For exaggerated action sequences:

**Beat 1 - Anticipation/Wind-Up** (1-2 seconds)

- Character prepares action with impossible physics (leg stretches, body squashes)
- Ground/environment reacts in anticipation (fabric ripples, static buildup)
- Camera: low angle emphasizing the wind-up

**Beat 2 - Action/Release** (0.5-1 second)

- Action executes with speed lines, yarn fiber trails
- Often in faster-than-normal speed or with camera tracking the motion blur
- Impact moment uses freeze frame or extreme slow-mo (0.1-0.3 seconds)

**Beat 3 - Reaction/Overshoot** (2-3 seconds)

- Character overshoots (flies backward, spins uncontrollably, crashes)
- Felt physics dominate: fur ruffles, body compression, yarn unraveling
- Camera: wide shot revealing the full consequence

Example: Sister kicks brother → (Beat 1) leg stretches 3x normal, ground indents → (Beat 2) rocket launch with orange yarn trail → (Beat 3) brother flattens against giant's nose in slow-mo, both go cross-eyed

### Technique 2: Nested Reference Inheritance

For shots that build on previous shots:

1. Extract last frame of Shot A as an image
2. Tag it as \[Transition Frame A→B\]
3. Use it as the first frame for Shot B
4. In Shot B prompt, describe only the new action (character state inherited from transition frame)

This ensures seamless shot-to-shot continuity without re-describing all character states.

### Technique 3: Memory Bubble Visualization

For character thoughts/dreams/flashbacks:

**Visual Structure**:

- Main scene: current reality lighting
- Memory bubble: sheer organza bubble with lock-stitch edges floating above character's head
- Bubble interior: same felt style but different color temperature (warm gold for happy memories, cool blue for sad)
- Bubble content: miniaturized felt silhouettes or glowing symbolic objects

**Why it works**: Maintains material consistency while clearly separating mental content from physical reality.

### Technique 4: Scent Visualization via Yarn Vapor Trails

Since felt worlds can't show literal smoke/vapor:

- Golden yarn threads float in wavy paths from scent source to character's nose
- Character's nose wrinkles (yarn fabric pleats) in rhythm
- If character loves the scent: yarn threads sparkle, nose twitches faster
- If character dislikes: yarn threads are dark/tangled, nose wrinkles in reverse

This translates an invisible sense (smell) into the visible yarn language of the felt world.