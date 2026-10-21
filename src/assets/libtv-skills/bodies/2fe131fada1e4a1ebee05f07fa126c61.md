# Narrative Short Film Storyboarding

## Core Methodology

### Script-to-Storyboard Translation Framework

Decompose narrative scripts into executable visual units through structured scene analysis:

**Scene Identification Dimensions:**

- **Location** (interior/exterior, specific venue)
- **Time of Day** (lighting implications)
- **Character State** (costume, emotion, action)
- **Camera Movement** (static, tracking, transition effects)
- **Audio Cues** (dialogue, SFX, ambient sound)

**Shot Duration Logic:**

- Minimum shot length: 2s (allows motion registration)
- Maximum shot length: 5s (maintains pacing)
- Grouping rule: Organize shots into 15s video nodes to avoid single-shot timing issues and enable modular iteration
- For 30s total: 2 groups × 15s; For 60s total: 4 groups × 15s

### Character Consistency Hierarchy

Maintain character identity across all outputs through layered reference system:

**Layer 1: Primary Character Reference**

- User-provided face reference image becomes the anchor for ALL character generation
- Generate 2 versions upfront: modern costume + period costume (if script requires temporal shifts)
- Link character reference images to EVERY video generation node

**Layer 2: Costume/Context Variations**

- Same face, different styling per scene requirements
- Costume changes encoded in storyboard prompts, but face reference remains constant

**Layer 3: Scene-Specific Poses**

- Each storyboard shot defines unique pose/action while preserving character identity

### Video Generation Architecture

**Batch Generation Strategy:**

**Stage 1: Character Setup**

- Generate character reference images (modern + period versions if needed)
- Confirm character appearance before proceeding to scenes

**Stage 2: Scene Anchor Generation**

- Create location anchor images (key environments: museum hall, ancient street, etc.)
- These become background consistency references

**Stage 3: Storyboard Frame Generation**

- Generate all storyboard frames (10 shots for 30s film = 10 images)
- Each frame links to: character references + scene anchors + shot-specific prompt
- Organize by groups (Group 1: S01-S05, Group 2: S06-S10)

**Stage 4: Group Video Generation**

- Convert each 15s group of storyboard frames into ONE video node
- Critical linking rule: ALL storyboard frames in group + ALL character references → single video node
- Generate videos sequentially, not in parallel, to allow transition checks

**Stage 5: Transition Management**

- Extract tail frame from Group N
- Extract head frame from Group N+1
- If visual discontinuity detected, generate 4s transition video using tail frame as start + head frame as end
- Re-link transition video: if inserting transition, regenerate subsequent group with tail frame as new head frame

## Workflow

### 1. Preparation Stage

**Input Requirements:**

- Complete script with scene descriptions
- Character face reference image(s)
- Total duration selection (15s/30s/60s)
- Aspect ratio selection (16:9 horizontal / 9:16 vertical)
- Video model selection (LibNano 2 / Seedance 2.0 Fast / Kling O3)
- Resolution selection (720P / 1080P)

**Pre-Production Checklist:**

- \[ \] Script parsed into scene list
- \[ \] Shot duration assignments (2-5s per shot)
- \[ \] Shot grouping into 15s modules
- \[ \] Character costume variations identified
- \[ \] Key location environments listed
- \[ \] Audio requirements flagged (dialogue, SFX, BGM)

**Storyboard Table Template:**

ShotDurationScene ContentCharacterLocationCameraAudio NotesS013sMuseum hall, protagonist stands before muralModern costumeInterior museumStatic wide shotAmbient museum soundsS023sClose-up: protagonist's eyes lose focus, finger touches glassModern costumeSamePush-in to close-upClock bell SFX

### 2. Initial Generation Stage

**Step 1: Character Reference Generation**

```
Prompt Framework:
[Character description] + [Costume details] + [Lighting style] + [Quality tags]

Example:
"26-year-old urban professional woman, black hair, neutral expression, wearing [modern business attire / Tang dynasty red silk robe], studio lighting, 2K resolution, character design reference sheet"
```

Generate 2-3 character versions covering all costume requirements. Confirm with user before proceeding.

**Step 2: Scene Anchor Generation**

```
Prompt Framework:
[Location type] + [Architectural details] + [Lighting conditions] + [Atmospheric elements]

Example:
"Museum exhibition hall interior, glass display cases, dim ambient light with spotlight beams, cold color temperature, high ceilings, empty space, cinematic lighting"
```

Generate 1 anchor per major location (typically 2-4 anchors for 30s film).

**Step 3: Storyboard Frame Generation**

For each shot in storyboard table:

```
Prompt Framework:
[Scene anchor reference] + [Character reference] + [Specific action/pose] + [Camera angle] + [Emotional tone]

Linking Structure:
- Scene anchor image ID
- Character reference image ID(s)
- Shot-specific prompt describing action

Example:
"Based on museum hall anchor and modern character reference, protagonist stands with back to camera facing large Tang dynasty mural on wall, three-quarter view, slightly hunched posture showing fatigue, cold color grading, cinematic composition"
```

Generate all storyboard frames in sequence. Review for character consistency across frames.

**Step 4: Group Video Generation**

For each 15s group:

```
Video Generation Linking:
- Input: [Group storyboard frame IDs] + [All character reference IDs]
- Model: [User-selected model]
- Duration: 15s
- Resolution: [User-selected resolution]
- Aspect Ratio: [User-selected ratio]

Generate ONE video node per group
```

### 3. Iteration Stage

**Transition Coherence Check:**

After generating Group 1:

1. Extract tail frame (last frame of Group 1 video)
2. Generate Group 2
3. Extract head frame (first frame of Group 2 video)
4. Manual visual comparison: Check for spatial/lighting/character pose discontinuity

**Transition Fix Protocol:**

If discontinuity detected:

Option A: Regenerate Group 2 with Group 1 tail frame as head frame reference

```
Regenerate Group 2:
- Add Group 1 tail frame to reference inputs
- Specify "match lighting and character pose from reference frame"
```

Option B: Generate 4s transition video

```
Transition Video:
- Start frame: Group 1 tail frame
- End frame: Group 2 head frame
- Duration: 4s
- Link all character references
- Prompt: "smooth transition maintaining character identity and spatial continuity"
```

**BGM Integration Decision Matrix:**

Video Audio StateBGM RecommendationGenerated video has rich ambient/SFXSkip BGM or use only in ending segmentGenerated video has sparse audioFull-length BGM recommendedScript specifies critical SFX momentsExclude BGM from those segments

**BGM Generation:**

If BGM required:

```
BGM Prompt Framework:
[Musical style fusion] + [Emotional arc] + [Duration]

Example:
"Traditional guqin instrument blended with modern electronic ambient, three-part emotional progression: ethereal and sparse opening (museum coldness) → tense and layered middle (apocalyptic tension) → warm and resolved ending (acceptance), 30 seconds total"
```

**BGM Alignment Rules:**

- Generate BGM at EXACT total video duration (not longer)
- If excluding BGM from specific segments, use audio timeline offsets in composition
- For transition-removed edits: Regenerate BGM at new total duration

**Final Composition:**

```
Composite Video:
- Video tracks: [Group 1] + [Transition (if used)] + [Group 2] + ...
- Audio track: [BGM] with start/end times aligned to video segments
- If BGM excluded from middle segment: Use audio timeline gaps
```

## Key Constraints & Standards

### Character Fidelity Rules

- **Immutable**: Character reference image MUST link to every storyboard frame and every video node
- **Testable**: Side-by-side comparison of character face across all outputs — facial features, skin tone, and proportions must remain pixel-consistent
- **Costume separation**: Costume changes are acceptable and script-driven; face identity is not

### Shot Duration Standards

- **Minimum 2s**: Shorter shots fail to register motion in video generation
- **Maximum 5s**: Longer shots risk temporal coherence breakdown or sluggish pacing
- **Group size 15s**: Maintains model generation coherence; longer single-node videos show quality degradation

### Transition Continuity Standards

- **Spatial consistency**: Character position and camera angle should maintain logical flow between groups
- **Lighting consistency**: Abrupt lighting shifts between groups break immersion — transition videos or regeneration required
- **Action continuity**: Character pose/motion should not teleport between shots (e.g., standing → suddenly sitting without intermediate frame)

### Audio Layering Standards

- **BGM volume**: Should sit 20-30% below dialogue/critical SFX in mix
- **SFX preservation**: Script-specified sound effects (glass tap, phone drop, clock bells) must not be masked by BGM
- **Silence as tool**: For dramatic moments (phone drop scene), brief BGM silence amplifies impact

### Storyboard Grouping Standards

- **15s module rule**: Always divide total duration into 15s chunks (30s = 2 groups, 60s = 4 groups)
- **Shot distribution**: Aim for 4-6 shots per 15s group (varies based on 2-5s shot durations)
- **Group independence**: Each group should function as a semi-autonomous narrative beat (setup/confrontation/resolution)

## Recommended Tools & Models

Use **LibNano 2** for character-driven narrative scenes requiring high facial consistency and smooth motion. Alternatively, use **Seedance 2.0 Fast** for faster iteration cycles with good quality, or **Kling O3** for experimental stylistic rendering.

## Example

**Input:**

- Script: 30s short film with museum→ancient street→museum structure
- Character reference: Modern professional woman portrait
- Requirements: 16:9 horizontal, LibNano 2, 720P

**Execution:**

1. Generate character references:

   - Modern version: Business attire, neutral lighting
   - Ancient version: Tang dynasty red robe, warm lighting

2. Generate scene anchors:

   - Museum exhibition hall (cold blue lighting)
   - Ancient Chinese street market (warm golden hour)

3. Storyboard breakdown (10 shots, 2 groups):

   - Group 1 (S01-S05): Museum mystery buildup → time warp transition
   - Group 2 (S06-S10): Ancient encounter → return → resolution

4. Generate Group 1 video (15s):

   - Link all S01-S05 frames + character references → single video node

5. Extract Group 1 tail frame

6. Generate Group 2 video (15s):

   - Link Group 1 tail frame + S06-S10 frames + character references → single video node

7. Generate 30s BGM (guqin + electronic fusion)

8. Composite final video:

   - Group 1 (15s) + Group 2 (15s) + BGM (30s aligned)

**Output:** 30s narrative short film with character consistency, smooth transitions, and integrated BGM

## Advanced Techniques

### Multi-Timeline Character Handling

For scripts with parallel timelines or flashbacks:

1. Generate separate character reference sets per timeline (e.g., young vs. old version)
2. Use visual markers in storyboard frames to signal timeline (color grading, costume, hair style)
3. Maintain same face reference across timelines, vary only age-related styling

### Dynamic Camera Movement Encoding

For shots requiring specific camera motion:

```
Camera Motion Vocabulary:
- "Slow push-in" (2s → 5s): Gradual zoom emphasizing subject
- "Tracking shot" (3s+): Camera follows character movement
- "Handheld shake" (any duration): Adds tension/urgency
- "Static lock" (2s): Immobile camera for stability

Encode in storyboard prompt:
"[Scene description], camera: slow push-in from medium shot to close-up over 3 seconds"
```

### Audio Segmentation for Selective BGM

When BGM should skip certain segments:

```
Composition Audio Timeline:
- Track 1 (BGM): 0-15s, 19-30s (excludes 15-19s transition)
- Track 2 (SFX): 8s (clock bell), 18s (phone drop)
- Track 3 (Dialogue): 25-28s (voiceover)

Implement via audioList with startTime/endTime offsets
```