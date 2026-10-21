# Clay Style Stop-Motion Animation

## Core Methodology

### Layered Anchor System

Stop-motion animation consistency requires a **hierarchical anchor framework** that isolates immutable elements from variable ones:

**Layer 1 — Style Anchor (global constant)**

- Defines the universal visual language across all shots
- Material texture: clay, plasticine grain, soft matte surface
- Lighting setup: diffuse soft light, no hard shadows
- Color palette: saturation level, warmth/coolness bias
- Camera perspective: fixed focal length equivalent, depth of field range
- This anchor is referenced by EVERY shot to maintain cohesive aesthetic

**Layer 2 — Character Anchors (identity constants)**

- One anchor per character, locks:
  - Facial proportions (eye size, nose shape, mouth width)
  - Body shape and scale relative to environment
  - Signature costume/accessory (e.g., red hood, grandmother's glasses)
  - Color scheme (skin tone, clothing palette)
- Character anchors allow pose/expression variation while preserving identity

**Layer 3 — Scene Anchors (environmental constants)**

- One anchor per location (e.g., forest path, grandmother's house interior)
- Locks spatial layout, prop placement, ambient color temperature
- Allows camera angle variation within the same space

**Layer 4 — Shot Variables (per-storyboard-entry)**

- Camera angle (eye-level, low-angle, over-shoulder)
- Character pose and micro-expression
- Prop states (door open/closed, basket contents visible)
- Dialogue overlay timing

### Density-Duration Formula

Storyboard shot count directly correlates with narrative pacing:

- **1 minute target** = 4-6 shots (10-15 seconds per shot) → slower, contemplative rhythm
- **1.5 minutes target** = 6-9 shots (10-15 seconds per shot) → balanced pacing
- **2 minutes target** = 10-12 shots (10-12 seconds per shot) → faster montage style

**Critical constraint**: Single shot minimum duration = 8 seconds (below this, clay texture detail becomes imperceptible in stop-motion aesthetic)

### Comedy Design Dimensions (Tone-Agnostic Framework)

When user specifies comedic tone, deploy these structural mechanisms:

1. **Character Archetype Inversion**: Traditional role expectations violated (e.g., wolf as health-conscious gym-goer vs. villain)
2. **Anachronistic Props**: Modern objects in fairy-tale settings create cognitive dissonance humor (power bank in picnic basket)
3. **Physical Comedy Beats**: Exaggerated body language, slapstick timing (wig slipping, beard caught in door crack)
4. **Meta-Narrative Jokes**: Characters aware of story structure or fourth-wall breaks (grandmother revealing livestream setup)
5. **Subverted Climax**: Audience expectation built then deflated with anti-climactic resolution

For non-comedic tones (melancholic, suspenseful, wholesome), replace these with tone-appropriate structural devices while maintaining the anchor system.

## Workflow

### 1. Preparation Stage

**Input Checklist**:

- Story source material (classic tale to adapt, original concept, user-provided script)
- Target duration (1 min / 1.5 min / 2 min)
- Narrative tone (comedic, heartwarming, mysterious, educational, etc.)
- Language for dialogue/subtitles
- Key plot points or messages user wants emphasized

**Anchor Inventory Pre-Production**:

1. Count unique characters → determine number of character anchors needed
2. Count distinct locations → determine scene anchor requirements
3. Draft style anchor parameters:
   - Confirm clay texture intensity (smooth vs. grainy)
   - Set color saturation baseline (pastel vs. vibrant)
   - Define lighting mood (warm domestic vs. cool nocturnal)

**Narrative Adaptation Decision Tree**:

- If adapting existing story: identify 2-3 core plot beats that MUST remain + 1-2 elements to subvert/modernize
- If original concept: establish three-act structure anchor points (setup conflict, complication, resolution)
- Map tone requirements to structural devices (see Comedy Design Dimensions for comedic; develop equivalent for other tones)

### 2. Initial Design Stage

**Anchor Generation Sequence** (sequential, not parallel):

1. Generate Style Anchor first

   - Prompt structure: `[Clay stop-motion aesthetic] + [lighting setup] + [color palette] + [texture detail level]`
   - Validate: check material grain visibility, lighting uniformity

2. Generate Character Anchors (reference Style Anchor in every prompt)

   - Prompt structure: `Character [name], [physical description], [signature costume], [personality-implied pose], reference: [Style Anchor]`
   - Validate: character scale consistency (measure height ratios if multiple characters interact)
   - Generate neutral-pose version first, use for all future character references

3. Generate Scene Anchors (reference Style Anchor)

   - Prompt structure: `[Location name], [spatial layout description], [key props], [atmospheric mood], clay stop-motion style, reference: [Style Anchor]`
   - Validate: prop scale consistency, lighting matches style anchor

**Storyboard Drafting**:

- Write shot descriptions in table format: `Shot # | Duration | Scene Anchor | Characters | Camera Angle | Action/Dialogue | Anchors Referenced`
- Apply density formula to set shot count
- Ensure每个shot explicitly lists which anchors it inherits
- First pass: write action/dialogue in natural language
- Second pass: compress each shot description to 2-3 concrete visual instructions

**Batch Production Strategy**:

- Generate shots in batches of ≤5 (system technical constraint)
- Sequence batches chronologically to catch continuity errors early
- If total shots &gt;10, split storyboard into Act 1 / Act 2 / Act 3 batches

### 3. Iteration Stage

**Single-Shot Revision Protocol** (like the "Shot 05" door-crack correction):

When user requests changes to one specific shot:

1. **Lock all inherited anchors**: Identify which anchors the original shot referenced (e.g., Shot 05 referenced Character Anchor: Wolf + Scene Anchor: Grandmother's House Door)
2. **Isolate the variable dimension**: Determine what changed (camera angle? prop state? character expression?)
3. **Explicit constraint in regeneration prompt**:
   - "Character appearance must match Shot 04 exactly: \[describe specific costume/makeup state from previous shot\]"
   - "Reference Scene Anchor \[X\], modify only \[specific element\]"
4. **Generate replacement shot** with locked anchors + new variable
5. **Update storyboard table**: mark old shot node as "deprecated", record new node key
6. **Re-composite final video**: replace only the revised shot, keep all others unchanged

**Cross-Shot Consistency Audit**:

Before final composition, verify:

- \[ \] Character costume/makeup state is consistent across adjacent shots (unless narrative logic demands change)
- \[ \] Prop states follow logical continuity (if basket is open in Shot N, it remains open in Shot N+1 unless character closes it)
- \[ \] Lighting temperature doesn't shift between shots in same location
- \[ \] Character scale ratios remain constant when characters appear together

**When to Regenerate vs. Accept**:

- Regenerate if: character identity shifts, scene location doesn't match anchor, major prop missing
- Accept minor variances: slight pose drift, small lighting warmth shifts (inherent in stop-motion aesthetic)

## Key Constraints & Standards

### Immutable Rules

- Style Anchor MUST be referenced in every subsequent generation (character, scene, shot)
- Character identity elements (face proportions, signature costume items) CANNOT change across shots unless narrative explicitly depicts transformation
- Single shot duration: minimum 8 seconds (technical floor for stop-motion texture readability)
- Batch size: maximum 5 shots per generation call (system limit)

### Fidelity Standards

- Clay texture grain must be visible at 1080p resolution (validate by zooming in on material surface)
- Character scale consistency: measure height ratios in pixels; variance &lt;5% across shots featuring same characters
- Lighting direction: if Style Anchor specifies "top-left key light", all shots must maintain this unless switching to night scene

### Consistency Audit Checklist

- Adjacent-shot costume continuity: if Wolf wears crooked nightcap in Shot 04, it must remain crooked in Shot 05 (user's explicit correction requirement)
- Prop state logic: door open/closed status must follow cause-effect sequence
- Dialogue-action sync: if character speaks while performing action, both must be described in same shot

### Narrative Structure Standards

- Three-act minimum: establish setup (context + character introductions), complication (conflict/twist), resolution (outcome)
- Comedic timing (if applicable): punchline shot should be 2-3 seconds longer than setup shots to allow laugh beat
- Tone consistency: once narrative tone is set (comedic/melancholic/etc.), visual gags or emotional beats must align throughout

## Example: Comedic Fairy Tale Adaptation

**Input**: "Little Red Riding Hood", 1.5 minutes, comedic tone with modern twist, Chinese dialogue

**Anchor Setup**:

- Style Anchor: Soft pastel clay, warm diffuse lighting, slightly oversaturated colors
- Character Anchors: Little Red Riding Hood (red hood, modern outfit, curious expression), Wolf (gym gear under grandmother disguise), Grandmother (tech-savvy, smartphone prop)
- Scene Anchors: Forest path (dappled light, whimsical trees), Grandmother's house exterior (cozy cottage door)

**Storyboard Excerpt** (8 shots, \~10-12 sec each):

1. Little Red Riding Hood at doorstep, basket reveals power bank + takeout vouchers, cheerful monologue
2. Forest path encounter: Wolf asks directions politely, Little Red casually gives address
3. Wolf running montage with "diet meal replacement" internal monologue
4. Wolf fumbling with grandmother disguise at door (nightcap crooked, voice cracking)
5. Door crack view: Wolf's face visible through narrow gap, costume same as Shot 04, Little Red peers suspiciously from outside
6. Snack crumbs falling, Wolf's cover blown
7. Real Grandmother jumps from closet holding phone: "Got enough footage!" (livestream reveal)
8. All three sit at table sharing takeout, freeze frame with end credits

**Key Revision Example**: Shot 05 initially showed door opening, user corrected to "door remains closed, only crack visible, Wolf's appearance must match Shot 04 exactly" → regenerated with explicit constraints, updated storyboard, recomposited final video.

## Advanced Techniques

### Micro-Expression Anchors

For character-driven narratives requiring subtle emotion shifts, create expression sub-anchors:

- Neutral base (primary character anchor)
- Happy variant (+15% mouth width, +10% eye openness)
- Worried variant (eyebrow angle -20°, mouth width -10%) Reference base anchor + variant tag in shot descriptions.

### Environmental Storytelling Props

Embed narrative subtext through background prop placement:

- Modern objects in period settings telegraph anachronism humor
- Worn vs. pristine prop states convey character backstory
- Prop lighting (spotlight on key item) guides audience attention without dialogue

### Dynamic Camera Anchor Sets

For action-heavy sequences, create camera angle anchors:

- Eye-level standard (baseline)
- Low-angle heroic (character empowerment)
- High-angle vulnerable (character disadvantage) Reference these as modifiers to scene anchors: "Scene Anchor: Forest + Camera Anchor: Low-angle heroic"