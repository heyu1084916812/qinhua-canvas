# Commercial Storyboard Video Production

## Core Methodology

### Three-Phase Creative Development Framework

Commercial storyboard production operates through three sequential confirmation gates before asset generation:

**Phase 1: Character Design Panel**

- Establish protagonist identity aligned with product positioning (age range, occupation, lifestyle archetype)
- Define demographic specifics: 28-32 age bracket for mature elegance vs 20-25 for youthful energy
- Lock physical attributes: facial features, skin tone, body proportions as immutable constants across all shots
- Create reference anchor image serving as identity baseline for all subsequent generation

**Phase 2: Narrative Arc Construction**

- Map emotional journey from problem state → product introduction → transformation → resolution
- Structure as 7-shot standard sequence: initial conflict (2 shots) → product reveal (1 shot) → application process (2 shots) → transformation result (1 shot) → product showcase (1 shot)
- Each shot requires distinct emotional register and visual focus (wide establishing → medium action → close-up reaction → macro detail)
- Problem-to-solution arc must compress into 15-30 second viewing window

**Phase 3: Environmental & Lighting Design**

- Define primary location with spatial coherence (e.g., modern minimalist bedroom vanity, Scandinavian workspace)
- Establish color temperature shift strategy: cool tones (blue/cyan) for problem state → warm tones (amber/cream) for solution state
- Light source consistency: maintain directional logic across scene transitions (window light remains left-side throughout)
- Background treatment: shallow depth-of-field bokeh for attention control, 80% background blur standard

### Anchor-Based Consistency System

Consistency across multi-shot sequences relies on three anchor types:

**A1 — Character Identity Anchor**

- Single reference image capturing facial structure, proportions, skin tone in neutral pose
- Must be generated first before any storyboard shots
- All subsequent shots reference this node_key to maintain identity lock
- Regeneration required if client requests age/maturity adjustment

**A2 — Product Anchor**

- Hero product image with accurate packaging, labeling, and material rendering
- Must match actual product photography for trademark/legal compliance
- Used for product close-up shots and final showcase frame

**A3 — Scene/Environment Anchor**

- Establishing shot of primary location without character
- Defines spatial layout, furniture placement, background elements
- Referenced to maintain environmental consistency across character action shots

### Shot Categorization by Visual Language

Each storyboard frame belongs to a functional shot category:

**Establishing Shots (Wide/Full)** — Scene context, spatial relationships, emotional isolation **Action Shots (Medium)** — Character performing key actions (picking up product, applying, gesturing) **Reaction Shots (Close-Up)** — Facial expressions capturing emotional transformation **Detail Shots (Macro/Extreme Close-Up)** — Product texture, application process, material quality **Hero Product Shots** — Isolated product showcase with controlled lighting and background

Standard 7-frame sequence typically uses: 1 establishing + 3 action/medium + 2 close-up reaction + 1 macro detail + 1 hero product

## Workflow

### 1. Preparation Stage

**Client Input Checklist:**

- Product reference images (high-resolution, multiple angles preferred)
- Target audience demographic (age, gender, lifestyle archetype)
- Desired emotional narrative (transformation theme, problem-solution arc)
- Brand tone (luxury elegant vs playful energetic vs professional clinical)

**Pre-Production Decisions:**

- Character persona selection: occupational identity (office worker, creative professional, parent) determines costume, setting, time-of-day
- Narrative structure: confirm 7-shot storyboard sequence with client before generation
- Scene environment: match product category (cosmetics → vanity/bathroom, food → kitchen/dining, tech → workspace)
- Aspect ratio: vertical 9:16 for social media, horizontal 16:9 for broadcast, square 1:1 for feed posts

**Three-Gate Sequential Confirmation Protocol:**

1. Present 3-4 character persona options with demographic variations → client selects ONE
2. Present narrative arc storyboard outline (7 shots described in text) → client confirms sequence
3. Present scene/lighting mood board options → client selects environmental style

Only proceed to asset generation after all three gates confirmed.

### 2. Initial Generation Stage

**Anchor Asset Production (Parallel):**

- Generate A1 (Character), A2 (Product), A3 (Scene) anchors simultaneously

- Use Lib Image for character generation (offers better facial consistency)

- Character anchor prompt structure:

  ```
  [Age range]-year-old [ethnicity] [occupation/archetype],
  [specific facial features], [skin tone description],
  [hair style and color], [clothing style],
  [emotional state: neutral/confident], [lighting: soft natural light],
  [shot type: medium shot portrait], professional photography,
  [background: simple neutral/blurred], high detail, realistic style
  ```

- Product anchor: replicate actual product photography style (white background, studio lighting, multiple angles if needed)

- Scene anchor: empty environment establishing shot with key furniture/props, lighting matching intended mood

**Storyboard Shot Generation (Sequential with Iteration):**

- Generate shots 01-03 first, await client confirmation before proceeding

- Each shot prompt must reference character anchor node_key for identity consistency

- Shot-specific prompt framework:

  ```
  [Character description referencing anchor] + [specific action/pose] +
  [product interaction if applicable] + [emotional expression] +
  [camera angle and shot type] + [lighting description] +
  [background/environment details] + [photographic style] +
  [quality keywords: high detail, realistic, commercial photography]
  ```

**Iterative Refinement Protocol:**

- Client feedback on each shot typically addresses: pose angle, product visibility, facial expression mismatch, lighting tone
- Hand/product interaction shots (e.g., "trying product on hand") require most iterations — expect 2-3 regenerations
- Camera angle corrections: "more frontal", "flatter hand position", "overhead view" require explicit prompt adjustments
- When client provides custom prompt corrections, use their exact wording for regeneration

### 3. Video Synthesis Stage

**Grid Layout Assembly:**

- Convert storyboard frames into presentation grids (4-panel horizontal layout standard)
- Maintain original aspect ratio per frame (9:16 vertical shots arranged horizontally in 4-column grid)
- Output resolution: 4K for client review, can downscale to 1080p for video synthesis
- Grid composition: first 4 shots in Grid 1, remaining 3 shots + 1 blank space in Grid 2

**Segmented Video Generation:**

- Generate videos in batches matching grid structure (4 shots per batch)
- Video parameters: 720p resolution, 15 seconds duration, 9:16 aspect ratio (vertical)
- Each video generation must reference:
  - Grid image node as first frame/composition reference
  - Character anchor (A1) for identity consistency
  - Scene anchor (A3) for environmental consistency
  - Product anchor (A2) for product appearance accuracy
- Generate Grid 1 video → client confirms → generate Grid 2 video (sequential approval gates)

**Final Assembly:**

- Concatenate approved video segments in chronological order (Grid 1 video + Grid 2 video)
- Output format: single continuous 30-second vertical video (15s + 15s)
- Audio handling: retain original generated audio unless client requests music/voiceover additions
- If client requests background music: generate or source 30s BGM, ensure consistent volume across both segments

## Key Constraints & Standards

### Identity Consistency (Immutable)

- **Character facial features, skin tone, and body proportions must remain pixel-identical across all shots** — this is the primary quality differentiator for commercial work
- Any perceived identity drift requires immediate regeneration referencing the original anchor
- Age/maturity adjustments require regenerating the base anchor (A1) first, then regenerating all dependent shots
- Use Lib Image model for all character-based shots (superior facial consistency vs other models)

### Product Fidelity (Legally Critical)

- Product packaging, labels, and branding must match actual product imagery exactly
- Trademark/logo visibility must be clear in hero product shots (final frame)
- Product color accuracy critical for cosmetics/fashion — saturation and hue must match reference images
- Product interaction shots (hand holding, applying) must show product clearly without obstruction

### Lighting & Mood Consistency

- Maintain consistent light direction across all shots (e.g., window light from left throughout)
- Color temperature shifts must be gradual and narratively justified (cool → warm during transformation arc)
- Avoid abrupt lighting changes between consecutive shots (breaks visual continuity)
- Background bokeh quality should remain consistent (depth-of-field consistency signals professional production)

### Shot Composition Standards

- **Hand/product interaction shots require frontal, flattened perspective** — avoid angled or foreshortened hand positions
- Facial close-ups must show eyes clearly (primary emotional communication channel)
- Product visibility hierarchy: ensure product occupies 30-50% of frame in application shots, 70%+ in hero shots
- Background elements must support without distracting (80% blur standard for shallow DOF shots)

### Video Technical Requirements

- Vertical format (9:16) mandatory for social media distribution
- 720p resolution minimum for synthesis (balances quality and generation speed)
- 15-second segment length maintains narrative pacing without viewer fatigue
- Grid-based batch generation (4 shots per video) prevents identity drift across long sequences

### Iteration Efficiency Rules

- **Maximum 3 regeneration attempts per shot** — if third attempt fails, revise prompt structure or anchor references
- Client-provided custom prompts supersede all template frameworks (use verbatim)
- Hand/product interaction shots statistically require 2-3 iterations — budget time accordingly
- Anchor regeneration cascades to all dependent shots — avoid anchor changes after storyboard approval

## Recommended Tools & Models

- **Lib Image**: Use for all character identity anchor generation and character-based storyboard shots (superior facial consistency)
- **Lib Navo 2**: Use for grid layout assembly and product/scene anchor generation (high-resolution output quality)
- **Video Generation**: Use platform's video synthesis tools for storyboard-to-video conversion with anchor node referencing

## Example

**Scenario**: NARS foundation product commercial targeting professional women aged 28-32

**Character Design**: Mature elegant Asian female office worker, natural makeup, business casual attire, confident expression, morning natural lighting

**Narrative Arc (7 shots)**:

1. Alarm clock closeup, woman waking tired/bare-faced (establishing problem)
2. Hand opening drawer, retrieving NARS foundation (product introduction)
3. Hand back macro, foundation pumping onto skin, finger blending (application detail)
4. Face close-up, foundation application with brush, skin appearing luminous (transformation)
5. Mirror reflection, woman smiling confidently with finished makeup (emotional result)
6. Full shot, woman picking up bag, energetic stride toward door (lifestyle integration)
7. Product hero shot, two NARS bottles on white surface with soft shadows (brand showcase)

**Scene Design**: Modern minimalist bedroom vanity, white/cream color palette, soft morning sunlight through sheer curtains, shallow depth-of-field background

**Execution Flow**:

- Generate character anchor (mature elegant face, neutral expression)
- Generate 3 anchor assets in parallel (character, product bottles, vanity scene)
- Generate shots 01-03 → client confirms → shots 04-05 → confirms → shots 06-07
- Shot 03 (hand/product interaction) required 3 iterations for correct frontal hand angle
- Compile shots into two 4-panel grids (shots 1-4, shots 5-7 + blank)
- Generate Grid 1 video (15s, 720p vertical) referencing all anchors → client confirms
- Generate Grid 2 video (15s, 720p vertical) → client confirms
- Concatenate both videos into final 30s commercial spot

## Advanced Techniques

### Cross-Shot Motion Continuity

For premium productions requiring seamless motion flow between shots:

- Generate video from shot N, extract final frame as first frame reference for shot N+1
- Requires regenerating shot N+1 storyboard image to match extracted frame composition
- Increases production time 40% but eliminates jarring cuts between action sequences

### Dynamic Product Transformation

For before/after product demonstrations:

- Generate paired anchor images: product in "before state" (e.g., dull skin) and "after state" (e.g., radiant skin)
- Structure narrative as A-B-A pattern: before state (3 shots) → product application (2 shots) → after state (2 shots)
- Ensure identical camera angles and lighting for before/after comparison shots (side-by-side credibility)

### Multi-Product Campaign Scaling

For product line campaigns requiring multiple videos with shared character:

- Lock character anchor (A1) and scene anchor (A3) as constants
- Swap only product anchor (A2) for each SKU variant
- Maintain identical narrative structure and shot sequence across all videos
- Generates 5-10 product variant videos using 80% shared assets (massive efficiency gain)