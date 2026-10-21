# Cinematic Product Video Production

## Core Methodology

### 1. Global Style Locking System

All outputs must strictly adhere to a unified visual language defined upfront. This is the highest-priority constraint — every frame, transition, and asset must reference this master style guide.

**Five-Dimensional Style Framework:**

- **Color Palette**: Define 3-5 core colors (e.g., deep space black, titanium gray, electric blue, cyan neon) plus 2-3 accent colors. All scenes inherit this palette.
- **Material Library**: Establish 5-8 material archetypes (e.g., brushed metal, dark glass, micro-textured fabric, linear light-emitting elements, semi-transparent tech plastic). Every product surface maps to one of these.
- **Lighting Rig Template**: Lock a standardized three-point lighting setup (key + fill + rim) plus atmospheric effects (edge scanning light, bottom glow halo). High contrast with darkened corners.
- **Particle System**: Define particle color (blue/cyan), density, motion paths (scan lines, holographic grids, data streams). Consistent across all segments.
- **Transition Vocabulary**: Permit only specific transition types (light wipe, digital glitch art, depth tunnel zoom). Ban soft dissolves.

**Style Lock Enforcement**: Create a master style reference document. Every segment generation prompt must explicitly reference this document. Any deviation triggers regeneration.

### 2. Layered Asset Architecture

Organize all visual assets into a hierarchical anchor system:

**Anchor Categories:**

- **Product Anchors (A-PRODUCT-##)**: Core product shots from 3-5 angles (front 3/4, side profile, exploded view, detail close-up). These are immutable references.
- **Character Anchors (A-CHAR-##)**: Human models with tech-wear styling (matte black asymmetric jacket, smart glasses, holographic wristband). Lock face, skin tone, body proportions.
- **Scene Anchors (A-SCENE-##)**: Environmental templates (futuristic living room, near-future bedroom, virtual meeting room, outdoor terrace). Reusable across segments.
- **Brand Anchors (A-LOGO/A-BRAND-##)**: Logo variations (standalone, with tagline, animated) following brand guidelines.

**Anchor Consistency Rules:**

- Product identity (model number, form factor, color) must be pixel-perfect across all segments
- Character identity (facial features, wardrobe) must remain constant across all scenes
- Environmental lighting and material treatment must match scene anchor templates

### 3. Multi-Segment Narrative Framework

Structure the video as a sequence of 8-12 narrative segments, each serving a distinct storytelling function:

**Segment Typology:**

1. **Brand Intro & Product Reveal (0-8s)**: Establish brand presence, reveal product in hero lighting
2. **Exterior Showcase & Material Detail (9-16s)**: Rotate product, extreme close-ups of textures
3. **Internal Structure Explode (17-27s)**: Disassemble product to show engineering, components float with holographic labels
4. **Component Deep Dive (28-34s)**: Macro shots of key components (optical engine, heat dissipation, speaker array)
5. **Function Demonstration (35-44s)**: Show product in action (auto-focus, keystone correction, wireless casting)
6. **Use Case Scenario A (45-54s)**: Lifestyle scene 1 (living room setup, human interaction)
7. **Use Case Scenario B (55-60s)**: Lifestyle scene 2 (bedroom ceiling projection, outdoor usage)
8. **Brand Outro & Hold Frame (61-68s)**: Product returns to center, logo appears, slow zoom out to stillness

**Segment Connection Logic**: Extract final frame of Segment N → use as starting frame of Segment N+1. This ensures visual continuity across cuts.

### 4. Director's Shot List Methodology

For each segment, create a complete director's breakdown:

**Shot Specification Template:**

- **Framing**: Wide / Medium / Close-Up / Extreme Close-Up (with frame percentage occupied by subject)
- **Camera Position**: Angle in degrees (e.g., 30° elevated, 15° low-angle), distance from subject
- **Camera Movement**: Type (dolly push, arc rotation, pan, tilt) + speed parameter (slow 0.5x, normal 1x, fast 2x) + easing curve
- **Lens Focal Length**: Equivalent focal length in mm (affects spatial compression)
- **Timeline Breakdown**: Action sequence broken down by 0.5s increments
- **Lighting Setup**: Key light position/intensity, fill light ratio, rim light color, special effects (edge scan timing)
- **Particle Details**: Color/density/motion direction/spawn pattern
- **Transition Out**: Type + duration (e.g., light wipe 0.8s, glitch transition 0.3s)
- **Director's Intent**: One-sentence core emotional/functional goal for this shot
- **Production Notes**: Critical risks (avoid model identity drift, prevent overexposure, ensure logo legibility)

## Workflow

### 1. Preparation Stage

**Input Checklist:**

- \[ \] Product image (1 high-res photo, white background or scene shot)
- \[ \] Product specifications: dimensions, materials, key features, selling points
- \[ \] Brand guidelines: logo files, color palette, typography, tone
- \[ \] Target audience: demographics, use cases, pain points
- \[ \] Optional: reference videos, mood boards, competitor analysis

**Style Lock Creation:**

1. Analyze product image → extract dominant colors → map to style palette (e.g., gray metal → titanium gray + electric blue accents)
2. Identify key materials → assign to material library (e.g., fabric grill → micro-textured fabric archetype)
3. Map product selling points → visual metaphors (e.g., "high brightness" → intense beam projection; "smart connectivity" → holographic data streams)
4. Define character styling: Select wardrobe (tech-wear: matte black, asymmetric cuts, glowing accents), accessories (smart glasses, wristband), posture (upright, confident, minimal gestures)
5. Lock transition vocabulary: Based on brand tone, choose 2-3 transition types (e.g., light wipe for premium feel, glitch art for edgy brands)
6. Document everything in a master style reference file

**Anchor Asset Generation:**

- Generate 3-5 product anchor images from different angles
- Generate 1-2 character anchor images with consistent identity
- Generate 3-4 scene environment anchors
- Generate brand logo anchor with proper styling

**Segment Planning:**

- Draft 8-12 segment outline with timing allocation
- Assign narrative function to each segment (reveal / detail / function / lifestyle / outro)
- Identify key transitions between segments
- Calculate total runtime (default 60s, adjustable)

### 2. Initial Production Stage

**Batch Segment Generation:**

- Generate segments 1-5 in parallel (maximum 5 concurrent jobs to avoid system overload)
- Each segment prompt must:
  - Explicitly reference anchor assets ("Use A-PRODUCT-01 as base model")
  - Cite master style guide ("Follow color palette: deep black + electric blue + cyan neon")
  - Include director's shot list elements (framing, camera movement, lighting, particles)
  - Specify transitions ("Transition out: light wipe 0.8s from left to right")
- Wait for batch completion → quality check → proceed to segments 6-8

**Segment Quality Audit:**

For each generated segment, verify:

- \[ \] Product identity match: Does the product look identical to anchor? (Check form factor, color, logo placement)
- \[ \] Style adherence: Does color palette match master guide? Are materials rendered correctly?
- \[ \] Character consistency (if present): Same face, same wardrobe?
- \[ \] Technical quality: No artifacts, no text corruption, no model distortion
- \[ \] Narrative clarity: Does the shot convey its intended function?

If any check fails → regenerate with corrected prompt.

**Director's Shot List Creation:**

For each segment:

1. Analyze generated video → extract actual framing, camera movement, timing
2. Write complete shot specification following the template (see Core Methodology §4)
3. Add director's intent and production notes
4. Generate 1-2 storyboard frames per segment (key composition moments)
5. Store all shot lists in a master director's document

### 3. Iteration & Refinement Stage

**Segment-Level Refinement:**

Based on user feedback, identify specific issues:

- **Product visibility issues**: "Projector not visible in bedroom scene" → Regenerate with explicit placement ("Projector on nightstand, lens pointing to ceiling")
- **Missing content**: "No projection screen visible" → Add specific prompt element ("Projection beam hits ceiling, clear image of \[content\] displayed")
- **Style drift**: "Background too bright" → Reinforce style lock ("Deep space black background, high contrast, darkened corners")
- **Character inconsistency**: "Person looks different" → Re-reference character anchor ("Use A-CHAR-01, same face, same wardrobe")

**Multi-Segment Regeneration Strategy:**

If a scene spans multiple segments (e.g., living room scene = 2 segments), regenerate them as independent videos then merge:

1. Split into atomic actions (e.g., Segment A: activate projector; Segment B: projection appears)
2. Generate each independently with clear start/end states
3. Merge with appropriate transition (e.g., fade-to-black 0.4s)

**Extension & Addition:**

To add new content mid-production:

1. Extract final frame of preceding segment → use as starting anchor for new segment
2. Generate new segment with explicit bridging ("Continue from \[preceding segment final frame\], then \[new action\]")
3. Insert into segment sequence → re-merge final video

**Final Assembly:**

1. Verify segment order matches narrative arc
2. Merge all segments with specified transitions
3. Add background music (sync mood to narrative: mysterious intro → energetic demo → aspirational lifestyle → calm outro)
4. Verify total runtime

**Cover Image Generation:**

- Extract hero shot from Brand Intro segment OR generate dedicated cover
- Composition: Product on right (3/4 front angle), projection beam to upper left, brand text on left (three-line hierarchy: main title + subtitle + English tagline)
- Text styling: Main title (cold white + cyan glow outline), subtitle (titanium gray), tagline (electric blue, wide letter-spacing)
- Background: Deep space black with bottom cyan glow, high contrast, darkened corners

## Key Constraints & Standards

### Immutable Rules (Never Violate)

- **Product Identity Lock**: Product model, color, form factor, logo placement must be pixel-identical across all segments. Any drift triggers regeneration.
- **Style Palette Lock**: All colors must map to the master palette. Warm tones (orange, yellow, beige) are strictly forbidden unless explicitly in the product's original colors.
- **Character Identity Lock**: If human characters appear, facial features, skin tone, body proportions must remain constant. Wardrobe must follow the tech-wear style guide.
- **Background Restriction**: All backgrounds must be dark (deep space black or dark gradient). Light backgrounds, daylight scenes, natural outdoor lighting are forbidden.

### Fidelity Rules (Maximize Realism)

- **Material Rendering**: Metal surfaces must show brushed texture + cold light reflection. Glass must show multi-layer coating refraction. Fabric must show micro-texture weave.
- **Lighting Realism**: Three-point lighting mandatory. Key light must be cooler than fill light. Rim light must be cyan/blue. Edge scanning light must move at consistent speed (0.5-1s sweep duration).
- **Particle Behavior**: Particles must flow along logical paths (around product surfaces, through component gaps, along data transmission lines). Random scatter is forbidden.
- **Physics Compliance**: Exploded components must float in logical spatial arrangement (closer to camera = lower in frame). Gravity direction must be consistent.

### Consistency Rules (Maintain Continuity)

- **Cross-Segment Bridging**: Final frame of Segment N must visually connect to first frame of Segment N+1. Extract and reuse end frames as start anchors.
- **Scene Anchor Adherence**: When multiple segments occur in the same environment (e.g., living room), all must reference the same scene anchor. Furniture layout, lighting setup, wall color must be identical.
- **Transition Type Consistency**: Use only the approved transition types from the style guide. Maintain consistent transition duration (0.3-0.8s).
- **Temporal Rhythm**: Maintain consistent pacing within segment categories (e.g., all detail shots are 6-8s, all lifestyle scenes are 9-12s).

### Production Quality Standards

- **Resolution**: Minimum 1080p, prefer 4K for final output
- **Frame Rate**: 24fps for cinematic feel, 30fps for web platforms
- **Text Legibility**: All holographic labels, UI text, brand copy must be readable. Font size ≥ 5% of frame height. Contrast ratio ≥ 4.5:1.
- **Audio Sync**: Background music tempo must match visual rhythm. Beat hits should align with key visual moments (product reveal, transition points).

## Recommended Tools & Models

- **Image Generation**: Use Seedream 5.0 Pro for product anchors, character anchors, scene environments, and cover images. Supports high-fidelity material rendering and precise color control.
- **Video Generation**: Use Seedance 2.0 for all video segments. Supports start frame anchoring (ensures cross-segment continuity) and camera movement control.
- **Video Editing**: Use built-in video merge tools for segment assembly, transition application, and audio mixing.

## Advanced Techniques

### Exploded View Animation Logic

For internal structure segments:

1. **Pre-Explode State**: Product exterior intact, digital scan lines sweep across surface (0-2s)
2. **Shell Transparency**: Outer casing fades to 30% opacity, internal components become visible (2-4s)
3. **Component Separation**: Components eject outward in logical groups:
   - Optical engine (lens + prism) → upward
   - Heat dissipation (fins + fan) → left/right
   - Speaker array → downward
   - Mainboard → backward Each component group moves 15-25% of frame width from center
4. **Label Appearance**: Holographic name tags fade in next to each component (4-6s)
5. **Particle Flow**: Cyan particles flow between components, visualizing functional connections (4-8s)
6. **Reassembly**: Components return to origin in reverse order, shell opacity returns to 100% (8-10s)

### Multi-Modal Scene Adaptation

For lifestyle segments with multiple sub-scenes:

- Generate each sub-scene as an independent 4-6s video
- Use environment-appropriate transitions:
  - Indoor-to-indoor: digital glitch art (0.3s)
  - Indoor-to-outdoor: light wipe (0.6s)
  - Scene-to-product-closeup: depth tunnel zoom (0.4s)
- Maintain character identity across sub-scenes by re-referencing character anchor

### Adaptive Cover Generation

**Path 1 (Product Image Input)**: Analyze product → generate cover from scratch

**Path 2 (Existing Cover Analysis)**: Read existing cover → extract composition rules → regenerate with optimizations:

- Improve text hierarchy (larger main title, clearer subtitle)
- Enhance projection beam (wider fan, more particles)
- Strengthen product lighting (more pronounced rim light)
- Adjust color balance (deeper blacks, brighter cyan accents)