# Product Video Storyboarding

## Core Methodology

### Product DNA Matrix — Translate Physical Attributes to Sensory Language

Before visualizing any shots, decode the product through 4 sensory dimensions:

- **Taste dimension**: Identify core flavor profiles (bitter, sweet, sour, spicy, umami), convert to sensory descriptors (e.g. crisp, mellow, pungent, refreshing)
- **Touch dimension**: Map tactile properties (crispy, soft, sticky, smooth), convert to physical sensations (e.g. airy, dense, crumbly, elastic)
- **Visual dimension**: Extract color palette (deep brown, emerald green, amber), define form language (flowing, layered, textured)
- **Emotional dimension**: Capture psychological payoff (healing, awakening, indulgent, restrained)

Example (matcha chocolate pie): Taste=bitter-sweet; Touch=dense+crispy; Visual=brown+green; Emotion=zen+indulgent

This matrix becomes the visual DNA governing all shot design decisions.

### 3+1 Selling Point Framework — Build Trust Through Layered Evidence

Every product pitch needs 3 concrete dimensions + 1 emotional anchor:

1. **Ingredient-level trust** (origin/variety): "Uji matcha", "A2 dairy", "single-origin cacao" — builds perceived quality through specificity
2. **Process/composition-level proof** (quantified claims): "64% dark chocolate", "3g tea powder", "12-hour cold fermentation" — numbers eliminate doubt
3. **Experience-level problem-solving** (friction removal): "non-sticky", "individual packaging", "ready-to-eat" — addresses hidden pain points
4. **Emotional-level resonance** (lifestyle benefit): "a moment of Kyoto calm", "adult escape", "zen afternoon" — justifies premium positioning

This structure ensures both rational justification and emotional pull coexist.

### Rhythmic Shot Sequencing — Breathing Intervals, Not Uniform Duration

Product videos require varied shot durations (2–5s per shot) to create natural viewing rhythm:

- **Short shots (2–3s)**: Detail close-ups, quick transitions, action peaks (e.g. breaking apart, biting)
- **Medium shots (4s)**: Process demonstrations, ingredient showcases, primary product angles
- **Long shots (5s)**: Emotional scenes, lifestyle contexts, final call-to-action holds

Group shots into 15-second narrative blocks — each block has a thematic purpose (e.g. opening tone-setting, tactile explosion, rational proof, emotional closure). A 60s video = 4 blocks × 15s, with 12–17 total shots.

This rhythm prevents monotony and matches human attention span patterns.

### Character Design Synchronization — Separate Identity from Variables

For character-driven product videos, define immutable vs variable elements:

**Immutable elements (character identity)**:

- Skin tone, facial structure, body proportions
- Hand shape, nail condition, jewelry style
- Overall aesthetic (minimal/natural/luxe)

**Variable elements (per shot)**:

- Body pose, hand gesture, camera angle
- Lighting direction, shadow intensity
- Scene props, background context

Generate a **character design panel** first — a reference sheet showing:

- Hand close-up (skin tone, nail style, gesture range)
- Profile/three-quarter face (hair, makeup, expression)
- Overall style cues (clothing, accessories, aesthetic)

Every storyboard shot must reference this panel to maintain visual continuity. Never generate shots before locking character identity.

## Workflow

### 1. Preparation Stage

**Product DNA Extraction**:

- Fill the 4-dimension sensory matrix (taste/touch/visual/emotion)
- Identify 3+1 selling points (ingredient/process/experience/emotion)
- Define visual tone triplet: color palette (cool-white/warm-yellow/dark), lighting style (hard/soft), prop aesthetic (matte/wood/glass)

**Script Framework Development**:

- Set video duration (30s/60s) and rhythm structure (15s block count)
- Map selling points to narrative arcs (opening → tactile proof → rational evidence → emotional closure)
- Calculate shot count budget: 60s video = 4 blocks × 3–5 shots = 12–20 total shots

**Character Design Requirements** (if applicable):

- Determine character role: faceless hands-only / profile-only / full character
- Prepare product reference images (packaging, product shots) for visual alignment
- Decide character aesthetic must match product tone (zen/modern/luxe/minimal)

### 2. Initial Storyboard Development

**Step 2.1: Character Design Panel** (if character-driven)

Do NOT proceed to shot generation without character identity locked. Generate a single reference panel containing:

- Hand gesture examples (3–5 poses)
- Profile/side face (expression range)
- Overall aesthetic markers (clothing style, accessories, color palette)

This panel is the visual anchor for all subsequent shots. Every shot prompt must reference this panel explicitly.

**Step 2.2: Group-by-Group Storyboard Generation**

Never generate all shots at once. Follow this sequence:

1. **Build shot table per 15s group**:

   - Each row = 1 shot with shot number, duration (2–5s), content description, technique note
   - Example row: | S03 | 3s | Chocolate shell macro texture | Extreme detail, establish premium |

2. **Generate shots group-by-group** (confirm each group before next):

   - Group 1 (0–15s): Tone-setting shots (product intro, atmosphere)
   - Group 2 (15–30s): Tactile/action shots (breaking apart, close-ups, eating)
   - Group 3 (30–45s): Rational proof shots (ingredients, measurements, packaging)
   - Group 4 (45–60s): Emotional resolution (lifestyle scene, product array, CTA)

3. **Shot generation prompt structure**:

   ```
   [Shot number + content description] + [character reference if applicable] + [lighting + composition + color tone] + [specific technique note]
   ```

   Example: "S05: Hand touching pie surface, fingers slightly pressing, ASMR close-up. Reference character panel for hand style. Soft directional light from left, matte dark tray, cool-white tone. Technique: non-sticky texture proof."

4. **Aspect ratio consistency**: Lock aspect ratio at preparation stage (16:9 for landscape, 9:16 for vertical social media). ALL shots in ALL groups must use identical aspect ratio. Never mix orientations mid-project.

**Step 2.3: Product Reference Integration**

For shots requiring product visibility (not abstract/atmospheric shots), explicitly include product reference image in the generation prompt. Product packaging colors, logo style, and form language must remain consistent across all product-visible shots.

### 3. Iteration & Video Assembly

**Shot-Level Refinement Checklist**:

- **Character continuity audit** (if applicable): Compare each new shot against character design panel. Skin tone, hand shape, facial structure must be pixel-identical. If deviation detected, regenerate with explicit panel reference.
- **Lighting consistency**: Within each 15s group, lighting direction/intensity should remain stable unless narrative justifies a shift (e.g. moving from indoor to outdoor).
- **Color palette coherence**: Product colors (e.g. brown chocolate + green matcha) must maintain consistent saturation/hue across all shots. Oversaturated or undersaturated shots break visual flow.
- **Rhythm validation**: Play shot sequence mentally — do 2s shots feel abrupt? Do 5s shots drag? Adjust duration if pacing feels off.

**Video Assembly Workflow**:

1. **Multi-image video generation**: Use video generation tool (e.g. Seedance 2.5) to convert storyboard shots to motion. Input structure:

   - First video node: Group 1 + Group 2 shots (0–30s)
   - Second video node: Group 3 + Group 4 shots (30–60s)
   - Each node receives ALL shots in that segment as sequential image references

2. **BGM integration**: Select background music matching emotional tone (zen/upbeat/minimal). Typical BGM length should match or slightly exceed video duration to allow fadeout. Add BGM as separate audio layer.

3. **Final compositing**: Merge video segments + BGM into single timeline. Verify:

   - Shot transitions align with music beats/phrases
   - No visual jump cuts between groups (lighting/color should flow)
   - Final CTA hold duration allows viewer action (minimum 3s)

## Key Constraints & Standards

### Immutable Rules — Never Violate

- **Character identity lock**: Once character design panel is confirmed, facial features/skin tone/body proportions CANNOT change across any shots. Even minor deviations destroy viewer trust.
- **Aspect ratio consistency**: ALL shots in a single project must use identical aspect ratio. Mixing 16:9 and 9:16 is prohibited.
- **Product color fidelity**: Product packaging colors and brand colors (if specified) must remain accurate across all shots. Do not allow AI to reinterpret brand green as teal or brown as orange.

### Fidelity Standards — Quality Gates

- **Shot duration variance**: Each shot must fall within 2–5s range. Shots under 2s feel rushed; shots over 5s lose attention.
- **Group balance**: Each 15s group should contain 3–5 shots. Groups with 2 shots feel sparse; groups with 6+ shots feel chaotic.
- **Lighting transition logic**: Hard light-to-soft light transitions require narrative justification (e.g. moving from close-up to wide scene). Arbitrary lighting shifts break immersion.
- **Prop consistency**: If a wooden tray appears in S02, it cannot become a glass plate in S05 without explicit scene change. Maintain prop continuity within narrative blocks.

### Consistency Audit Protocol

**Pre-video-generation checkpoint**:

- Line up all shots in sequence → scan for character identity drift
- Check color temperature consistency (cool vs warm tones should not flip randomly)
- Verify product always appears in correct orientation (logo readable, product right-side-up)

**Post-video-generation checkpoint**:

- Watch assembled video at 0.5x speed → identify jarring transitions
- Verify shot durations match storyboard plan (2s/3s/4s/5s as specified)
- Confirm BGM volume does not overpower product ASMR moments (breaking, crunching sounds)

## Recommended Tools & Models

Use Seedance 2.5 for multi-image-to-video generation. This tool accepts multiple image references as input and generates coherent video sequences maintaining visual consistency across shots.

## Advanced Techniques

### Layered Scene Construction — Separate Product from Context

For maximum flexibility, conceptualize each shot as 3 independent layers:

1. **Product layer**: The physical item being sold (immutable within a project)
2. **Character/hand layer**: Human elements (consistent identity, variable poses)
3. **Environment layer**: Background, props, lighting (varies per narrative block)

This mental model allows swapping environments (indoor/outdoor/studio) while keeping product and character visually locked. Example: same hand holding same pie can appear against black studio backdrop (S02), wooden table (S13), or window-lit scene (S14).

### ASMR Amplification in Tactile Shots

For close-up action shots (breaking, biting, touching):

- Specify "macro lens" perspective to exaggerate texture detail
- Request "shallow depth of field" to isolate the action moment
- Add sound design cues in shot notes: "crisp snap sound", "soft crunch", "paper tear" — even though storyboard is visual, these notes guide video generation toward ASMR-friendly motion

### Emotional Contrast Sequencing

Structure the 4-block narrative as an emotional arc:

- Block 1: Curiosity (what is this?)
- Block 2: Desire (I want to touch/taste it)
- Block 3: Trust (this is high quality)
- Block 4: Resolution (I should buy it)

Each block's lighting, pacing, and shot selection should escalate this arc. Block 1 uses mysterious dark tones; Block 2 adds warm tactile light; Block 3 introduces clinical bright proof shots; Block 4 returns to soft emotional glow.