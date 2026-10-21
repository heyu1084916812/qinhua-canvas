# Chinese Ink Animation Production

## Core Methodology

### Storyboard Decomposition Framework

Break narrative into visual segments following the **15-second unit** rule:

- **Duration logic**: Segment boundary = natural narrative pause or scene shift. Default 15s per cut unless user specifies otherwise.
- **Shot composition**: Each segment = 1 independent video clip with coherent action/emotion arc.
- **Transition planning**: Every segment boundary requires dynamic element bridge (ink flow, fabric motion, particle dispersion) — NEVER hard cuts unless explicitly requested.

Storyboard structure:

```
Segment N: [Duration] [Scene description] [Key visual elements] [Motion type] [Transition out method]
```

### Anchor Asset Strategy Matrix

Three execution paths based on user choice:

1. **User-uploaded anchors**: User provides reference images → extract visual style DNA (color palette, brush texture, composition density) → apply to all segments for consistency.
2. **AI-generated anchors**: Generate 2-3 style reference images first using refined Chinese ink prompts → user selects preferred anchor → proceed with full production.
3. **Pure text-to-video**: No image anchors, rely entirely on prompt engineering with strict style constraints (see Prompt Framework below).

### Chinese Ink Prompt Framework

Structure for EVERY video generation prompt:

```
[Fixed prefix] + [Color palette] + [Brush technique] + [Negative space rule] + [Scene content] + [Motion directive]
```

**Fixed prefix** (mandatory): "Chinese ink wash painting style, traditional Xuan paper texture, fluid brushwork, soft gradient transitions"

**Color palette** (choose one per project):

- Monochrome: "pure black ink with grayscale gradients, white paper negative space"
- Two-tone: "black ink + \[color\] accents (e.g., crimson/gold/azure), 80% monochrome base"
- Polychrome: "mineral pigment colors (vermillion/malachite/azurite), layered washes, subdued saturation"

**Brush technique keywords**:

- Bone method (骨法用笔): "strong confident strokes, clear structure"
- Splash ink (泼墨): "spontaneous wet-on-wet blending, atmospheric effects"
- Fine-line (工笔): "precise contour lines, delicate details"

**Negative space rule**: "Intentional blank areas occupying 20-40% of frame, asymmetric composition, breathing room around subjects"

**Motion directive** (critical for transition design): Specify which element(s) carry motion OUT of frame:

- Fabric/hair flow direction
- Ink droplet scatter path
- Mist/cloud drift trajectory
- Light particle swirl pattern

### Transition Design System

**Rule**: All cuts connect via **dynamic element continuity** (画面元素的动态转场).

Transition types:

1. **Ink flow transition**: Segment A ends with ink flowing right → Segment B starts with ink emerging from left edge.
2. **Fabric whip transition**: Sleeve/robe edge sweeps across frame → next shot begins behind the fabric motion.
3. **Particle scatter transition**: Falling petals/snowflakes drift toward bottom-right → next shot opens with particles entering from top-left.
4. **Atmospheric fade transition**: Mist thickens to near-white → next scene emerges from clearing fog.

Execution:

- Final 1-2 seconds of Segment N must show transition element motion.
- First 1-2 seconds of Segment N+1 must continue that motion's trajectory.
- If user requests hard cuts, explicitly disable this system.

## Workflow

### 1. Requirement Capture Stage

**Input checklist**:

- \[ \] User narrative description (story concept, emotional tone)
- \[ \] Total duration preference (or default to 15s × segment count)
- \[ \] Aspect ratio specification (16:9 / 9:16 / 1:1 / custom)
- \[ \] Anchor asset strategy choice (upload / generate / text-only)

**Output**: Structured storyboard draft with:

- Segment count and durations
- Shot descriptions per segment
- Transition method proposals

**Presentation format**: Show draft as numbered list, ask user to confirm/revise before proceeding.

### 2. Anchor Asset Preparation Stage

If user uploads assets:

1. Analyze uploaded images for:
   - Dominant color palette (extract hex codes if possible)
   - Brush stroke density (sparse/medium/dense)
   - Composition balance (centered/asymmetric/layered depth)
2. Generate **Style DNA Summary**: "This project uses \[palette description\], \[brush technique\], \[composition approach\]"
3. Use DNA summary as prefix for all subsequent prompts.

If generating anchors:

1. Create 2-3 style test images:
   - Variant A: Monochrome minimal
   - Variant B: Two-tone balanced
   - Variant C: Polychrome rich
2. User selects preferred variant → extract Style DNA → proceed.

If pure text-to-video:

1. Confirm color palette choice with user.
2. Apply strict negative space constraint ("40% blank paper") to maintain ink painting authenticity.

### 3. Video Generation Stage

**Model configuration**:

- Platform: MiniMax H3 video model
- Resolution: 720p (1280×720 for 16:9, 720×1280 for 9:16, adjust for custom ratios)
- Duration per segment: User-specified or 15s default

**Prompt assembly per segment**:

```
[Style DNA prefix]
[Segment scene description]
[Transition motion directive]
[Technical parameters: aspect ratio, camera movement if any]
```

**Batch generation**:

- Generate segments in storyboard order.
- After each segment completes, verify transition element motion before starting next.
- If transition discontinuity detected, regenerate problem segment with adjusted motion directive.

### 4. Audio Integration Stage

**Four-track mixing structure**:

TrackContentVolume guidelineTiming主旋律 (Main melody)Instrumental theme70-80%Full duration环境音 (Ambient)Atmosphere (wind/water/birds)40-50%Continuous or scene-specific旁白 (Voiceover)Narration if needed90-100%, ducks musicSync to key story beats辅助音效 (SFX)Action accents (sword swoosh, footsteps)60-70%Event-triggered

**Mixing rules**:

- Main melody + ambient run throughout.
- Voiceover triggers automatic ducking (music drops to 50% during speech).
- SFX layered on top without affecting other tracks.

### 5. Final Composite Stage

**Assembly sequence**:

1. Arrange video segments in storyboard order.
2. Verify transition continuity at every cut point (motion element handoff).
3. Align audio tracks to video timeline.
4. Export as single master file.

**Quality checklist**:

- \[ \] All transitions use dynamic elements (no hard cuts)
- \[ \] Style consistency across all segments (color palette, brush technique match)
- \[ \] Audio levels balanced (no sudden volume jumps)
- \[ \] Total duration matches user specification

## Key Constraints & Standards

### Immutable Style Rules

1. **Negative space requirement**: 20-40% of every frame must be blank/near-blank paper texture. Violating this breaks ink painting authenticity.
2. **Brush texture fidelity**: Strokes must show paper absorption effects (feathered edges, gradual ink spread). Clean vector-like lines are unacceptable.
3. **Color saturation ceiling**: If using color, saturation must not exceed 60% (mineral pigment aesthetic). Oversaturated hues break traditional painting feel.

### Transition Fidelity Rules

1. **Motion continuity law**: Transition element's exit trajectory in Segment N must geometrically match entry trajectory in Segment N+1 (direction + speed + scale).
2. **Element persistence**: The transitioning element (ink/fabric/particles) must be visually present in BOTH adjoining segments (minimum 1-second overlap).
3. **Hard cut prohibition**: Unless user explicitly requests, NO direct cuts. Fade-to-black transitions are also forbidden (breaks dynamic continuity).

### Video Generation Standards

1. **Segment duration consistency**: Unless narrative demands variance, all segments should be equal length (default 15s). Prevents jarring rhythm changes.
2. **Aspect ratio lock**: Ratio must be identical across ALL segments. Mixing ratios in one project is prohibited.
3. **Model version lock**: Use MiniMax H3 exclusively for entire project. Switching models mid-project causes style drift.

### Audio Mixing Standards

1. **Voiceover ducking threshold**: When voiceover active, main melody must drop to ≤50% volume. Prevents narration being drowned out.
2. **Ambient continuity**: Ambient track must NOT have abrupt starts/stops. Use 2-second fade-in/fade-out at segment boundaries.
3. **SFX timing precision**: Action SFX must sync within ±0.1s of visual event. Delayed sound effects break immersion.

## Recommended Tools & Models

This workflow utilizes **MiniMax H3** for video generation, which provides stable output for Chinese ink painting aesthetics with strong motion consistency.

## Advanced Techniques

### Multi-layer Composition Simulation

For complex scenes (e.g., character in foreground + landscape background), generate as separate segments then composite:

1. Generate background plate (landscape only, with motion).
2. Generate character action (isolated subject, transparent-intended background).
3. Composite character over background in editing stage.

This prevents model from "mushing" foreground and background into one flat layer.

### Rhythmic Transition Pacing

Match transition speed to audio tempo:

- Fast-paced music → quick transitions (1-second handoff)
- Slow meditative music → long transitions (3-second lingering motion)

Adjust motion directive keywords: "swift" vs "graceful and slow" to control transition feel.