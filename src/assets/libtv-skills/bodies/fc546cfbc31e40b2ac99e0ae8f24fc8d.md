# Anime Short Film Production

## Core Methodology

### Script Analysis & Optimization Framework

When receiving a script, apply **Multi-Dimensional Script Audit**:

- **Temporal Feasibility Check**: Calculate content density. For 2-minute targets, 8 scenes ≈ 15s/scene. If density exceeds threshold, propose compression vs. duration extension.
- **Visual Translatability Audit**: Identify passages that are narrative-heavy but visually thin. Flag for enhancement with sensory details (texture, motion, light).
- **Character Consistency Mapping**: Extract all character appearance descriptions. If inconsistent across scenes, consolidate into unified reference.
- **Pacing Arc Analysis**: Map emotional intensity across scenes. Ensure rhythm follows pattern: hook → build → peak → resolution → coda.

### Asset Establishment System

Before storyboarding, establish **Three-Tier Asset Hierarchy**:

**Tier 1 — Character Assets (Highest Priority)**

- Generate full-body reference sheets for all speaking roles
- Main protagonist requires minimum 3 views: front, three-quarter, side
- Lock ONE primary anchor node for protagonist — all subsequent references must use this exact node to maintain pixel-level consistency
- Secondary characters need single frontal reference

**Tier 2 — Scene Assets**

- Establish master shots for each unique location
- Generate detail inserts for scene-specific elements (kitchen appliances, market stalls)
- Maintain 2-3 establishing shots per major location for camera angle variety

**Tier 3 — Prop Assets**

- Generate reference sheets for story-critical props (items that appear 3+ times)
- Group functionally related props into single reference sheet
- Props that undergo transformation (empty bowl → filled bowl) need before/after states

**Asset Registry Protocol**: Create `assets.md` file with three-column table: | Asset Category | Asset Name | node_key |

This registry becomes the single source of truth for all subsequent storyboard and video generation prompts.

### Storyboard Construction Logic

Apply **Layered Storyboard Methodology** with strict adherence to cinematic grammar:

**Three-Shot Rule (Per 15s Segment)**

- Opening 30%: Wide Shot (WS) — establishes spatial context
- Middle 40%: Medium Shot (MS) — advances narrative action
- Closing 30%: Close-Up (CU) — emotional punctuation

**Ghibli Motion Discipline**

- Fixed shots ≥ 70% of total frames
- Maximum 1 camera movement per scene (push-in, pan, or tilt — never combined)
- Minimum 1 empty frame (空鏡) per scene for breath/transition
- Camera movements must have narrative justification, never decorative

**Match Cut System**Every cut between frames must employ one of four match types:

1. **Action Match**: continuous gesture across frames (hand reaching → hand grasping)
2. **Shape Match**: geometric echo (circular swirl → circular bowl)
3. **Color Match**: dominant hue carries over (amber liquid → amber sunset)
4. **Eyeline Match**: character gaze direction → what they see

Prohibited: jump cuts with no logical/perceptual bridge.

**Storyboard Format Requirements**Each frame entry must contain 7 fields: | Frame | Shot Type | Camera Angle | Movement | Duration | Visual Description | Editing Principle | Audio Cue | Asset References |

## Workflow

### 1. Preparation Stage

**Input Checklist**

- \[ \] Complete script document with scene breakdowns
- \[ \] Target duration confirmed (typically 120-180s)
- \[ \] Visual style reference (e.g., "Ghibli/Miyazaki hand-drawn warmth")
- \[ \] Aspect ratio (16:9 landscape / 9:16 portrait / 1:1 square)
- \[ \] Optional: Editing handbook (for advanced projects)

**Pre-Production Audit**

1. Read script chronologically, count unique characters/locations/props
2. Identify which elements appear 3+ times (these become asset priorities)
3. Calculate content density: total_word_count ÷ target_duration_seconds. If &gt;15 words/second, flag for compression
4. Extract all character physical descriptions into unified reference doc
5. Ask user for optimization approval before proceeding

**Key Decisions to Confirm**

- Accept script as-is vs. propose optimizations (pacing, visual density, character consistency)
- Determine asset generation scope (minimal vs. comprehensive)
- Clarify if user has reference images to upload

### 2. Initial Design Stage

**Asset Generation Sequence**

Phase 1 — Character Anchors:

- Generate protagonist full-body reference first
- Show to user, iterate if needed, then LOCK as primary anchor node
- Generate secondary characters only after protagonist approval
- Store all character node_keys in `assets.md`

Phase 2 — Scene Establishment:

- Generate wide establishing shots for each unique location
- Generate detail inserts for story-critical set pieces
- Maintain consistent lighting/color palette across related scenes

Phase 3 — Props:

- Generate grouped prop sheets (e.g., "kitchen utensils set")
- Ensure props match character scale and scene lighting

**Asset Validation Rules**:

- User must explicitly approve protagonist design before proceeding
- If user requests character redesign, generate variants but always maintain single locked anchor after approval
- All asset images must use same base model and style parameters for visual coherence

**Storyboard Planning**

1. **Scene Segmentation**: Break script into 15s segments (6-8 frames each)
2. **Frame Breakdown**: For each segment, apply Three-Shot Rule to determine shot types
3. **Asset Mapping**: For each frame, list all required asset node_keys
4. **Editing Logic**: Between every frame pair, specify match type (action/shape/color/eyeline)
5. **Write Storyboard Table**: Create markdown table with 8 columns per frame
6. **Generate Storyboard Images**: One panel image per scene showing all frames in sequence

**Storyboard Image Prompt Template**:

```
[Visual style] storyboard panel, [aspect ratio].

Reference: {{story_board_previous}} (if iterating)
Assets: {{character_anchor}} {{scene_anchor}} {{prop_anchor}}

[Scene name] | [Duration] | [Frame count]

Frame 1 [shot_type·camera·movement·duration]: [detailed visual description]
Frame 2 [shot_type·camera·movement·duration]: [detailed visual description]
...

Editing rules: [match types between frames]
Lighting: [overall mood]
Color palette: [dominant hues]
```

### 3. Iteration Stage

**Video Generation Protocol**

**Per-Scene Generation Rules**:

- Each video node MUST reference storyboard image as `start_frame_image_node`
- Connect all relevant asset anchors as additional image references
- Prompt must explicitly state: "\[Visual style\] hand-drawn animation, NOT photorealistic, NOT flat 2D vector"
- Duration must match storyboard table specification
- Use Hailuo Video H3 model (海螺H3) or equivalent for best Ghibli-style results

**Prompt Structure for Video Generation**:

```
[Visual style (e.g. Miyazaki Ghibli)] hand-drawn animation, NOT photorealistic, NOT 2D vector.

Storyboard reference: {{storyboard_panel_node}}
Character reference: {{protagonist_anchor}}
Scene reference: {{location_anchor}}
Props: {{prop_anchor_1}} {{prop_anchor_2}}

[Scene description from storyboard table]

Shot sequence:
- Frame 1 [shot_type]: [action description]
- Frame 2 [shot_type]: [action description]
...

Camera: [movement specifications]
Lighting: [mood description]
Pacing: [rhythm notes]
```

**Consistency Audit Checklist** (Per Generated Video):

- \[ \] Character face matches locked anchor node
- \[ \] Scene lighting consistent with previous segments
- \[ \] Prop appearance matches reference sheets
- \[ \] Camera movement follows Ghibli discipline (≤1 movement, justified)
- \[ \] Frame transitions use specified match cuts
- \[ \] No jump cuts or unmotivated angle changes

**When to Regenerate**:

- Character facial features deviate from anchor (immediate regeneration required)
- Camera movement violates single-movement rule
- Lighting/color palette breaks from established scenes
- Transition between frames lacks match cut logic

**Composite Assembly**

1. Generate BGM matching script's emotional arc (instrument selection, tempo curve)
2. Composite all scene videos in chronological order
3. Mix BGM into final composite
4. Update project documentation (`storyboard.md`, `assets.md`, task notes)

**Named Optimization Dimensions**:

**Dimension 1 — Temporal Coherence**: Every scene transition must feel motivated by time flow. Check: Does scene B logically follow scene A in story time? If not, add transitional bridge frame.

**Dimension 2 — Character Identity Lock**: Protagonist's facial structure, body proportions, clothing must be pixel-identical across all appearances. Any deviation triggers regeneration with stronger anchor weighting.

**Dimension 3 — Atmospheric Continuity**: Scenes within same time-of-day must share lighting temperature and shadow angle. Morning scenes all warm, noon scenes high-contrast, evening scenes cool/golden.

## Key Constraints & Standards

### Immutable Rules

1. **Single Protagonist Anchor**: Once locked, the protagonist character node MUST be referenced in every frame featuring that character. Never generate "similar" characters — always use the exact node_key.

2. **Storyboard-First Mandate**: Video generation CANNOT begin until storyboard panel images are approved. Storyboard images are NOT optional — they are the structural blueprint.

3. **Asset Registry Requirement**: `assets.md` file must exist and be populated before storyboarding begins. This file is the single source of truth for all node_key references.

4. **Three-Shot Rule Enforcement**: Every 15s segment must contain minimum one Wide Shot. Segments with no establishing shot are invalid.

### Fidelity Rules

5. **Ghibli Motion Discipline**: Camera movements per scene ≤ 1. If prompt requires 2+ movements, split into separate scenes.

6. **Empty Frame Quota**: Minimum 1 empty frame (no characters, pure environment) per scene. These provide visual breath and are non-negotiable in Ghibli aesthetic.

7. **Style Specification Precision**: Prompts must explicitly state "hand-drawn animation" AND negate "photorealistic" AND negate "flat 2D vector". All three conditions required.

8. **Match Cut Mandate**: No frame transition allowed without specifying match type. If no natural match exists, insert empty frame as bridge.

### Consistency Rules

 9. **Lighting Temperature Lock**: Scenes within same time block must share color temperature. Morning = warm (3200K-4500K), Noon = neutral-cool (5500K-6500K), Evening = golden-amber (2800K-3500K).

10. **Prop Scale Consistency**: Objects must maintain relative size across scenes. If bowl is hand-sized in Scene 1, it cannot be plate-sized in Scene 3.

11. **Audio Layer Structure**: Final composite must have three audio layers: (Bottom) ambient sound, (Middle) BGM, (Top) dialogue/SFX. Layers must not exceed -6dB to prevent clipping.

12. **Segment Duration Ceiling**: Individual video generation requests ≤ 15s. Longer scenes must be split into multiple nodes then composited.

### Quality Thresholds

13. **Asset Count Minimums**:

- 1-2 minute shorts: minimum 5 character assets + 8 scene assets + 5 prop assets
- Protagonist requires minimum 3-angle reference sheet
- Secondary characters require minimum 1 frontal reference

14. **Frame Density Standards**:

- 15s segment = 6-8 storyboard frames (average 2s per frame)
- Frame count below 5 = insufficient visual variety
- Frame count above 10 = excessively fragmented, risks disorientation

15. **Regeneration Trigger Conditions**:

- Character face mismatch from anchor: immediate regeneration required, no exceptions
- Lighting inconsistency: regenerate if delta E &gt; 15 in color space
- Prop appearance deviation: regenerate if silhouette shape differs &gt;20%

## Recommended Tools & Models

- **Video Generation**: Use Hailuo Video H3 model (海螺H3) for optimal Ghibli-style hand-drawn animation output

## Example

**Scenario**: 2-minute episode of slice-of-life rural anime featuring protagonist preparing traditional dessert for market

**Workflow execution**:

1. Received 8-scene script (150s target), identified 3 optimization points (pacing, character intro, ending transition)
2. Confirmed: Ghibli style, 16:9 landscape, loaded editing handbook
3. Generated 23 assets: 5 characters (protagonist 3-view + 4 secondary), 11 scenes, 7 props
4. Produced 8 storyboard panels (59 frames total) following Three-Shot Rule + Ghibli Motion Discipline
5. Generated 8 video segments using storyboard panels as start frames, all referencing locked protagonist anchor
6. Created 150s BGM with guitar + strings + accordion matching emotional arc
7. Composited final video with mixed audio layers
8. Archived: `storyboard.md` (59-frame table), `assets.md` (23 node_keys), task completion log

**Key success factors**: Protagonist visual consistency maintained across all 8 segments via single locked anchor node; every scene transition used match cuts (no jump cuts); Ghibli motion discipline achieved 75% fixed shots with only 5 camera movements across entire film.

## Advanced Techniques

### Dynamic Asset Expansion

For multi-episode projects, establish **Asset Evolution Protocol**:

- Maintain core anchor nodes across episodes (protagonist, main location)
- Create episode-specific asset branches for new characters/locations
- Use naming convention: `[character_name]_EP[number]_[variant]`
- Cross-reference table linking episode-specific assets back to core anchors

This prevents anchor drift while allowing narrative expansion.

### Layered Video Compositing

For scenes requiring complex action (e.g., character + props + background all in motion):

- Generate background movement as separate video node (no characters)
- Generate character action as separate node with transparent background
- Generate prop action as third node
- Composite in layers using video editing with proper z-ordering

This "animation cel" approach mirrors traditional hand-drawn workflow and gives finer control over each element's motion quality.

### Micro-Continuity Injection

To elevate consistency between scenes:

- Identify "continuity anchors" — small visual elements that carry across scenes (e.g., protagonist's hair clip, specific tree in background)
- In storyboard prompts, explicitly call out these anchors even in frames where they're not story-critical
- This creates subliminal visual threads that bind scenes together

Example: "Background includes corner of blue ceramic pot from Scene 2, slightly out of focus" — viewer won't consciously notice, but it reinforces spatial coherence.