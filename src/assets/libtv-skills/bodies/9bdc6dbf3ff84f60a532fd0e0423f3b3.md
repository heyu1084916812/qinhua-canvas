# Cinematic Short Film Production

## Core Methodology

### Character Identity Lock Framework

Character consistency is the single hardest challenge in AI-generated narrative video. Treat character identity as immutable data:

- **Identity Dimensions**: Face geometry, skin tone, hair color/texture, eye color, body proportions — these NEVER change across all shots
- **Variable Dimensions**: Costume, pose, camera angle, lighting, scene — these change per shot but identity stays locked
- **Disguise vs Identity**: If a character wears a disguise (e.g., wig, makeup), generate TWO separate anchor images — one for disguised state, one for true identity. Switching between them creates narrative reveals
- **Anchor Image Requirements**: Full-body three-view (front/side/back) on white background, neutral pose, professional model card photography, ultra-realistic skin texture, no props/accessories unless story-critical

### Scene Spatial Architecture

Every scene is a 3D stage with physical logic:

- **Location Consistency Matrix**: If multiple shots occur in "the same location" (e.g., garden party → party balcony → party interior study), generate separate anchor images for EACH spatial zone with consistent environmental DNA (architecture style, time of day, weather, color palette)
- **Spatial Relationship Mapping**: Before generating scene anchors, write out the physical relationship: "The balcony overlooks the garden below. The study window faces the garden. The hallway connects the ballroom to the study." This prevents spatial contradictions
- **Viewpoint Diversity Requirement**: For a single location, generate 2-3 anchor images from different viewpoints (e.g., garden ground level, garden from balcony, garden through window) to enable seamless shot transitions

### Cinematic Shot Design Logic

Each shot is NOT a slideshow frame — it's a mini-narrative with movement, focus shifts, and layered information:

**Three-Layer Composition Discipline**:

- Foreground Layer: Out-of-focus environmental elements (doorframes, foliage, shoulders of extras) that add depth
- Subject Layer: Main action/character, where focus lives most of the time
- Background Layer: Context (crowd, architecture), can be sharp or bokeh depending on lens choice

**Single-Shot Information Density**: Instead of cutting between 5 angles in 8 seconds, use ONE continuous shot with:

- Tilt (up/down): Reveal vertical relationships (ground → standing character → tall building)
- Pan (left/right): Follow eyeline, discover off-screen elements
- Push-in/Pull-out: Intensify emotion or create distance
- Rack Focus: Shift attention between foreground/background without cutting

**Camera Movement Motivation**: Every camera move must have narrative justification:

- Following a character's walk = kinetic energy, urgency
- Slow push-in on a face = rising tension, realization
- Orbiting around two characters = intimacy, connection
- Static wide shot = observation, isolation

**Rhythm Pacing Rules**:

- Slow moments: 8-12 second shots, minimal cuts, let breath exist
- High-action moments: 4-6 second shots, snappy cuts, kinetic energy
- Emotional peaks: Slow-motion at 50-70% speed, extend to 10-15 seconds
- NEVER do 1-second micro-cuts unless intentionally chaotic (explosion/panic)

### Dialogue Integration Protocol

AI video models cannot render synchronized lip-sync, so dialogue must be treated as OFF-CAMERA or VOICEOVER:

- **Dialogue Framing**: When characters speak, use medium shots or profile angles where mouth movement is less critical
- **Sound Mix Hierarchy**: Original video audio at 70-80% (preserves environmental sound), BGM at 40-50% during dialogue scenes, 60-70% during action
- **Subtitle Requirement**: All dialogue must be burned-in subtitles or post-production ADR, never rely on visual lip-sync

### Iterative Refinement Dimensions

When a shot fails, diagnose along these axes:

**Realism Failures**:

- "Oil-slick skin" → Add "matte skin texture, pore-level detail, natural sebum, film grain" to prompt
- "Plastic/CGI look" → Add "practical lighting, 35mm film stock, Kodak Vision3, photochemical process"
- "Oversaturated colors" → Add "desaturated color grading, natural color science, low contrast"

**Composition Failures**:

- "Character staring at camera" → Add "character ignores camera, natural performance, candid moment"
- "Flat lighting" → Specify three-point lighting: "key light 45° left, rim light back right, fill light soft diffused"
- "No depth" → Add "shallow depth of field, bokeh background, foreground framing elements"

**Motion Failures**:

- "Robotic movement" → Add "natural weight shift, fluid motion, real-world physics"
- "Action too fast" → Specify "slow motion 50% speed, 60fps capture"
- "Disconnected actions" → Break into TWO shots with a motivated cut (e.g., hand reaching for door handle → door opening)

## Workflow

### 1. Story Development Stage

**Premise Clarification**:

- Genre + tone (e.g., "spy thriller with romantic comedy beats")
- Core conflict ("undercover agents must steal data while pretending to be a couple")
- Emotional arc ("initial distrust → forced cooperation → mutual respect")
- Runtime target (90-120 seconds for short form, 3-5 minutes for extended)

**Beat Sheet Construction** (5-beat structure for shorts):

1. **Setup** (15-20s): Establish world, introduce protagonist in routine
2. **Inciting Incident** (10-15s): Problem/opportunity appears
3. **Rising Action** (30-40s): Complications, obstacles, reveals
4. **Climax** (20-25s): Highest tension point, signature action
5. **Resolution** (10-15s): Consequence, emotional payoff, exit

**Storyboard Drafting**: Write 10-15 shot descriptions with:

- Shot number + duration
- Location (which scene anchor)
- Characters (which identity anchors, which costumes)
- Camera specification (lens, movement, framing)
- Action description
- Narrative purpose

### 2. Asset Generation Stage

**Character Anchor Production**:

- Generate primary identity: "18-year-old female, European model, blonde wavy hair, blue eyes, white fitted shirt and black shorts, black strappy heels, realistic skin texture, professional model card photography, three-view full body, white background"
- If character has disguise/transformation: Generate alternate state with explicit transformation markers (e.g., "same facial structure, but wearing brown bob-cut wig, server uniform")
- Test consistency: Generate 3 test images of same character in different poses — if facial structure drifts, regenerate anchor with stricter identity locking

**Scene Anchor Production**:

- Generate master establishing shot first (widest view of location)
- Generate sub-zones with consistent environmental DNA: "Daytime garden party, white tents, natural sunlight, elegant guests in summer attire" → "Balcony overlooking the same garden, stone balustrade, matching architecture" → "Interior study, window showing garden in background"
- Verify spatial continuity: Check that lighting direction, time of day, weather conditions stay consistent

**Style Reference Lock**: Define global visual parameters in a style document:

- Color grading preset (e.g., "warm golden hour tones for exteriors, cool blue-grey for interiors")
- Film stock emulation (e.g., "35mm Kodak Vision3 500T, fine grain, natural color science")
- Lens character (e.g., "50mm prime lens, shallow depth of field, smooth bokeh")
- Lighting approach (e.g., "three-point cinematic lighting, motivated sources only, no flat ambient")

### 3. Shot Generation Stage

**Prompt Architecture** (per shot):

```
[Scene Anchor Reference] + [Character Anchor Reference] +
[Camera Specification] + [Action Description] + [Lighting] + [Style Lock]
```

Example: "Garden party scene \[@image:scene_anchor\], female protagonist \[@image:character_anchor\], medium shot handheld follow, walking through crowd with tray, scanning surroundings, natural sunlight key light from left, soft fill, shallow depth of field, 35mm film, realistic skin texture, cinematic color grading"

**Shot Duration Strategy**:

- Establishing shots: 5-8s (let viewer absorb space)
- Action shots: 6-8s (complete action arc)
- Dialogue shots: 8-12s (allow conversational rhythm)
- Emotional beats: 10-15s (slow motion, extended)
- Transition shots: 4-6s (just enough to bridge)

**Parallel Generation Batching**: Generate 3-5 shots simultaneously, prioritize shots with same character/scene anchors to maximize asset reuse

### 4. Iteration & Quality Control Stage

**Per-Shot QC Checklist**:

- \[ \] Character facial structure matches anchor (not just "similar")
- \[ \] Skin texture is matte/realistic, no oil-slick sheen
- \[ \] Lighting has directionality, not flat/ambient
- \[ \] Camera movement is motivated, not arbitrary
- \[ \] Action completes within shot duration (no mid-action cuts)
- \[ \] No glitches: duplicate limbs, morphing faces, physics violations
- \[ \] Background depth is visible (not flat painted backdrop)

**Failure Response Protocols**:

- If character face drifts: Regenerate with stricter anchor weighting
- If lighting is flat: Add explicit three-point lighting specification
- If action is robotic: Specify natural physics ("weight shift, fluid motion")
- If shot is too long/short: Re-generate with adjusted duration OR edit via trim
- If multiple issues: Don't iterate — redesign shot concept entirely

**Edit-Driven Optimization**:

- After generating full sequence, review ENTIRE flow at once
- Identify pacing issues: Where does it drag? Where is it rushed?
- Trim shots by 1-3 seconds to tighten rhythm (most AI shots have "dead air" at start/end)
- Reorder shots if narrative logic breaks

### 5. Assembly & Final Mix Stage

**Sequence Stitching**:

- Concatenate shots in storyboard order
- Check for continuity breaks: lighting jumps, costume changes, spatial contradictions
- If transitions feel jarring, consider adding a 0.5s crossfade (use sparingly — hard cuts are more cinematic)

**Audio Mix Strategy**:

- Original video audio: 70-80% (preserves environmental ambience, footsteps, movement)
- Background music: 40-50% during dialogue, 60-70% during action
- If dialogue is critical: Drop BGM to 30% or duck entirely for that segment
- Sound effects: Add post-production foley if AI video lacks impact sounds (door slams, footsteps, etc.)

**Music Selection Criteria**:

- Match genre/tone: Spy thriller = tense orchestral with electronic elements
- Avoid lyrics unless thematically critical (lyrics compete with visual narrative)
- Dynamic range: Music should have quiet moments to create contrast
- Length buffer: Generate music 20-30s longer than video to avoid abrupt endings

## Key Constraints & Standards

### Immutable Rules

1. **Character Identity Lock**: Facial structure, eye color, skin tone, hair color NEVER change unless explicitly a disguise transformation. If the model drifts, regenerate — do NOT accept "close enough."

2. **No Direct Camera Address**: Characters should NEVER look directly at camera or pose for it, unless the shot is explicitly a "breaking the fourth wall" moment. Always specify "character ignores camera, natural performance."

3. **Physics Realism**: All movement must obey real-world physics — no floating, no morphing, no instant teleportation. If action requires impossibility (e.g., jumping from building), stage it with motivated cuts, not within a single shot.

4. **Spatial Continuity**: If two shots occur in the same location, environmental elements (lighting direction, background architecture, weather) must be pixel-consistent.

### Fidelity Standards

1. **Skin Texture**: Reject any output with "oil-slick" or "plastic mannequin" skin. Skin must show pore-level detail, natural sebum variation, and film grain texture.

2. **Lighting Depth**: Reject flat lighting. EVERY shot must have a visible key light source (sun, window, lamp) casting directional shadows. Shadows should have soft edges (diffused light) not hard edges (point source).

3. **Color Grading**: Avoid oversaturated "Instagram" colors. Reference: Look at a Kodak film stock — colors are rich but not neon. If colors feel "too much," regenerate with "desaturated" in prompt.

4. **Motion Fluidity**: Character movement should have weight and inertia. Fast actions (punches, jumps) should show anticipation → execution → follow-through. Robotic stiffness is a regeneration trigger.

### Consistency Rules

1. **Time-of-Day Lock**: If a sequence occurs at "golden hour," ALL outdoor shots must show warm, low-angle sunlight. Switching from golden hour to noon lighting breaks immersion.

2. **Costume Continuity**: If a character changes costume (e.g., disguise transformation), this MUST be shown on-screen via a dedicated "changing" shot. Never hard-cut from outfit A to outfit B without explanation.

3. **Camera Language Consistency**: If the film uses handheld shaky-cam in Act 1, switching to locked-off tripod shots in Act 2 (without narrative motivation) breaks visual grammar. Pick a camera style and commit.

### Technical Limits

1. **Shot Duration**: Most AI video models degrade after 12-15 seconds. For longer takes, plan motivated cuts or regenerate with extended duration.

2. **Fast Motion Artifacts**: Rapid camera pans or character movements often create warping/ghosting. For fast action, use multiple shorter shots OR specify "slow motion" to give model more frames to interpolate.

3. **Text/Props**: AI models struggle with readable text and detailed handheld props (phones, documents). Either avoid close-ups of these, or plan to composite them in post-production.

4. **Crowd Scenes**: Background extras often clone/warp in AI video. Keep crowd activity in soft-focus background, never in foreground/focus.

## Recommended Tools & Models

Use **Seedance 2.0** for video generation — optimized for character consistency and cinematic motion. Use **LIB Image** for generating character and scene anchor images with photorealistic quality.

## Advanced Techniques

### Signature Action Beats

Every protagonist needs a memorable "hero moment" — a visually distinctive action that becomes their character signature:

- Design it as a 6-10 second shot with slow-motion emphasis
- Use low-angle camera to amplify heroic impact
- Ensure the action is physically plausible (even if stylized)
- Example: Spy character does a sweep-kick to disarm guard, then catches falling gun mid-air — this becomes her visual motif

### Intentional Misdirection

Use shot design to hide/reveal information for narrative surprise:

- Over-the-shoulder shots hide a character's identity until a reveal
- Rack focus pulls from a background detail (hidden enemy) to foreground (oblivious hero)
- Extreme close-ups on props (countdown timer, hidden weapon) build tension without dialogue

### Emotional Subtext via Blocking

Character spatial relationships communicate unspoken dynamics:

- Characters avoiding eye contact → mistrust/guilt
- Characters mirroring each other's poses → bonding/harmony
- One character in light, one in shadow → moral divide
- Increasing physical distance across a sequence → relationship fracturing