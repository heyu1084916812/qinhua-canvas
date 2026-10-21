# Fashion Product Video Production

## Core Methodology

### Product-Scene Decoupling

Treat video production as independent layer isolation: Product Layer (garment attributes) determines anchor images, Scene Layer (spatial aesthetics) determines empty scene shots, Narrative Layer (shot sequence) orchestrates temporal rhythm. Product Layer is immutable, Scene/Narrative Layers adapt to brand positioning. Core logic: first freeze product identity through static anchor images, then build scene vocabulary through empty environment shots, finally weave narrative through shot sequencing with scene-action alternation.

### Style-Driven Consistency System

Define visual consistency through style lookup tables mapping product attributes to scene aesthetics:

- Light-colored silk/lace → French cream style (off-white + pale apricot, silk bedding, plaster molding)
- Cotton plaid/stripe → Japanese wooden style (rice white + light wood, tatami, shoji screens)
- Solid modal/minimalist → Modern minimalist (pure white + gray, floor windows, metal fixtures)
- Warm-toned flannel/print → Vintage film style (warm yellow + teal, rattan, aged wood)

Each style encodes: spatial elements, color system, material tendency, atmosphere keywords. Style selection drives ALL downstream outputs (model anchor image, scene shots, video shots) to guarantee unified visual language.

### Empty Scene Integration Logic

Empty scene shots (environment-only, no model) serve three narrative functions:

- Opening anchor (0-8s): establish spatial context before model entry
- Transitional buffer (mid-sequence): 2-3s scene detail shots between action blocks to avoid visual fatigue
- Closing mood lock (23-30s): wide scene shot after model freeze to seal emotional tone

Empty scene content requirements: must reflect selected style's signature elements, leave spatial margin for model entry or text overlay, include subtle motion cues (curtain sway, light refraction, steam rise) for video integration. Shot count matches video structure: 30s standard = 3-4 empty scene shots (1 opening + 1-2 transitions + 1 closing).

### 30-Second Narrative Arc

Three-act structure with explicit scene insertion:

- Act 1 (0-8s): **Empty scene fade-in** (scene shot: morning light through window, natural bedding folds) → model enters frame, wide-to-medium push, establish garment silhouette + environment aesthetics
- Act 2 (9-22s): Product detail + lifestyle action. Model performs 1-2 daily activities, close-up/detail shots, **intersperse 1-2 empty scene close-ups** (book pages, potted plant, wood grain) as pacing breaks, cut back to model dynamics
- Act 3 (23-30s): Model emotional freeze, camera pull/dissolve to **wide empty scene** (same space or extended corner), soft light wraps space, final freeze on serene domestic atmosphere, text overlay ready

Action vocabulary (relaxed daily, non-provocative): morning stretch, sofa lean, window-side cup holding, barefoot walking, cross-legged reading, gentle garment hem adjustment, wall lean.

## Workflow

### 1. Preparation Stage

**Input Checklist:**

- 1 product image (flat lay or hanger shot) — REQUIRED
- Scene preference (bedroom/living room/balcony/bay window) — optional
- Lighting atmosphere (morning/afternoon warm sun/dusk/soft lamp) — optional
- Model temperament (sweet/cool/mature/languid) — optional
- Scene style selection or custom description — optional

**Product Feature Extraction**:Analyze and document: garment type (nightdress, robe, separates, onesie, bathrobe), color, neckline design, sleeve length, skirt/pant length, fabric (cotton, silk, modal, flannel), decorative details (lace trim, print, buttons, belt). Product features are immutable reference for all downstream generation.

**Style Auto-Matching**:If user does not specify style, apply style lookup table based on product color + fabric. If specified as "custom", require user to provide spatial elements, color system, material tendency description. Once style is locked, it governs model anchor, empty scene shots, and all video segments.

### 2. Initial Design Stage

**Model Anchor Image Prompt Framework:**

```
[Commercial e-commerce photography] + [Asian female model, natural makeup, real skin texture] + [100% product feature reproduction: {garment type}, {color}, {fabric texture}, {decorative details}] + [Environment: {style spatial elements}, {style color system}, soft natural/lamp light, bokeh] + [Composition: medium/full shot, highlight silhouette and drape, sitting/leaning posture if needed] + [Atmosphere: {style keywords}, comfortable languid feel, domestic atmosphere]
```

**Empty Scene Shot Prompt Framework:**

```
[Commercial spatial photography, empty scene, no person] + [Style environment: {style spatial elements}, light source positioning, material detail visible] + [Composition: wide/medium, clean with breathing room, reserve left/right margin for model entry] + [Subtle motion cues: curtain sway, light spot shift, steam rise] + [Atmosphere: {style keywords}, cinematic feel, dynamic atmosphere, no text, no person]
```

**Video Segment Prompt Framework:**

```
[Act/Segment label] + [Duration] + [Empty scene indicator OR model action] + [Shot scale: wide/medium/close-up/detail] + [Camera movement: fixed/slow push-pull/dissolve] + [Atmosphere: {style keywords} + comfortable domestic feel, cinematic soft light, high fabric texture quality, serene relaxation]
```

Explicitly mark empty scene insertion points and duration in segment descriptions.

### 3. Iteration Stage

**Product Fidelity Audit**:Cross-check all outputs against product image for: garment type match, color accuracy, fabric texture representation, decorative detail presence. If any deviation occurs in model anchor or video shots, regenerate with reinforced product description.

**Style Consistency Audit**:Verify model anchor image, all empty scene shots, and all video segments strictly follow the selected style's spatial elements, color system, and atmosphere keywords. If style drift occurs (e.g., mixing Japanese wooden elements with French lace), regenerate offending outputs with style constraint reinforcement.

**Empty Scene Integration Check**:Confirm empty scene shots appear at designated narrative positions (opening/transitions/closing), duration matches script (2-4s per shot), and transition feels natural (not abrupt cuts). If pacing feels rushed or disjointed, adjust empty scene shot duration or add one transition shot.

**Compliance Scan**:Scan all model actions and poses for: sexual suggestiveness, excessive exposure, provocative expressions, see-through wardrobe malfunctions, vulgar composition. If any detected, replace with compliant action from action vocabulary. Scan empty scene content for: implicit items, vulgar elements. Nightwear display must emphasize fabric comfort, design aesthetics, and domestic relaxation atmosphere, with zero sexualized tendency.

**Negative Prompt Reinforcement**:For final video generation, apply negative prompt template covering: distorted fingers, extra limbs, garment deformation, fabric texture distortion, see-through wardrobe malfunction, exposure, low quality, eerie expressions, action twitching, camera shake, frame tearing, {product-specific terms like "print distortion", "button misalignment"}. For empty scene shots, add: person in frame, product intrusion, random text, cluttered composition.

## Key Constraints & Standards

**Immutable Rules:**

- Product features (type, color, fabric, details) extracted from input image are the ONLY source of truth; never invent or modify product attributes
- Selected style must govern ALL outputs (anchor, empty scenes, video segments) without exception; partial style application is prohibited
- Empty scene shots must contain ZERO human presence; any person in empty scene shot requires regeneration

**Fidelity Rules:**

- Garment type, color, fabric texture, decorative details in video must be pixel-level identical to anchor image
- Model identity (face, skin tone, body proportions) must remain consistent across all video segments with model presence
- Fabric drape behavior must match material properties (silk flows, cotton holds shape, flannel has volume)

**Narrative Structure Rules:**

- 30s video must follow three-act structure: opening (0-8s with empty scene lead-in), middle (9-22s with action + 1-2 empty scene transitions), closing (23-30s with empty scene mood lock)
- Empty scene shots must occupy 20-30% of total duration (6-9s out of 30s)
- Shot scale progression must cover: wide → medium → close-up/detail → wide, avoiding single-scale monotony
- Camera movement bias: fixed shots and slow push-pull/dissolve; avoid aggressive shakes or rapid cuts

**Style Consistency Rules:**

- Spatial elements must strictly match style definition (e.g., Japanese wooden = tatami + shoji screens, not Western furniture)
- Color system must stay within style's defined palette (e.g., French cream = off-white + pale apricot + pale pink, not saturated colors)
- Atmosphere keywords from style definition must appear in ALL prompt outputs

**Compliance Rules:**

- Model actions must fall within "relaxed daily, non-provocative" vocabulary; actions not in vocabulary require user confirmation
- Zero tolerance for: sexual suggestiveness, excessive exposure (cleavage/underwear visible), provocative expressions, see-through shots, vulgar compositions
- Empty scene content must not contain: sexually implicit items (e.g., adult toys, suggestive props), vulgar decorations

**Technical Quality Rules:**

- All outputs must specify "commercial photography", "high quality", "clear fabric texture" terminology
- Video resolution and frame rate must meet e-commerce platform standards (1080p minimum, 24-30fps)
- Background music (if added) must match style atmosphere (e.g., Japanese wooden → piano + acoustic guitar + nature sounds; French cream → soft jazz + strings)

## Recommended Tools & Models

Use Seedance 2.0 VIP for video generation to ensure high-quality output with stable model consistency and fabric texture rendering. Use Lib Navo Pro for static anchor images and empty scene shots to maintain visual consistency with video segments.

## Output Specification

Deliver four-component package with explicit segment labeling:

**【Selected Style】:** {Style name + core spatial elements + color system + atmosphere keywords}

**【Model Anchor Image Prompt】:** {Complete prompt following framework, embedding style elements}

**【Empty Scene Shot Prompt】:** {Complete prompt following framework, no person, style-matched environment}

**【Video Prompt】:**

- **【Opening (with empty scene, 0-8s)】** {Empty scene fade-in description (specific scene details, \~3s)} → {Model entry, wide-to-medium progression}
- **【Middle (interspersed empty scenes, 9-22s)】** {Model action 1 + detail shots} → {Empty scene transition (specific elements, 2s)} → {Model action 2} → {Empty scene transition (specific elements, 2s)} → {Model composition shot}
- **【Closing (empty scene freeze, 23-30s)】** {Model emotional freeze} → {Dissolve to wide empty scene (specific spatial description), final freeze, text overlay ready}

**【Negative Prompt】:** {Base template + product-specific terms + empty scene exclusions}