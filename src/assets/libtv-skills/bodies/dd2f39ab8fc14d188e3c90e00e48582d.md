# White Background ID Portrait

## Core Methodology

### 1. Facial Feature Extraction Framework

When processing reference images, extract facial features across 6 dimensions:

- **Eye Structure**: Shape (almond/round/narrow), eyelid type (monolid/double/inner double), size relative to face
- **Nose Profile**: Bridge height (flat/medium/high), tip shape (round/pointed), nostril width
- **Mouth Characteristics**: Lip thickness (thin/medium/full), mouth width, natural resting position
- **Face Shape**: Classification (round/oval/V-shaped/square), jawline definition, cheekbone prominence
- **Skin Tone**: Undertone (cool/warm/neutral), lightness level (fair/medium/tan)
- **Age Markers**: Facial roundness (children have fuller cheeks), feature proportions, bone structure definition

Each dimension must be documented explicitly before generation to ensure accurate replication.

### 2. Fixed Styling Anchor System

To maintain consistency across all outputs, certain elements are locked as fixed anchors:

- **Hairstyle Anchor**: Male subjects receive black short hair with side part, close to scalp, smooth texture — this overrides any reference image hairstyle
- **Clothing Anchor**: Gray-white T-shirt for all subjects — simple, formal, appropriate for ID photography standards
- **Background Anchor**: Pure white (#FFFFFF), zero gradient, zero noise
- **Composition Anchor**: 3:4 vertical format, frontal view at eye level, eyes positioned at upper 1/3 of frame

These anchors create a unified visual system while allowing facial features to vary.

### 3. Age-Based Hierarchical Organization

Archiving follows a two-level folder structure:

- **Level 1 (Gender)**: 男孩 (Boys) / 女孩 (Girls)
- **Level 2 (Age Range)**: 5-7岁 / 8-10岁 / 11-13岁 / 14-15岁 / etc.
- **File Naming**: Sequential numbering within each age range (男孩1, 男孩2, 男孩3...)

Before archiving, MUST query existing assets in target folder to find highest existing number, then increment from that point to avoid naming conflicts.

## Workflow

### 1. Preparation Stage

**Input Checklist**:

- Reference images (optional but recommended for accurate facial features)
- Gender selection (男孩/女孩)
- Age specification (exact age or auto-detect from reference)
- Model selection (General image Pro recommended)
- Batch quantity

**Pre-Generation Analysis**:

- If reference images provided: Extract all 6 facial feature dimensions and document explicitly
- If no reference: Use age-appropriate generic features (children = rounder faces, larger eyes relative to face; teenagers = more defined bone structure)
- Determine age range folder for archiving (5-7岁/8-10岁/etc.)
- Query existing assets in target folder to determine next sequential number

### 2. Initial Generation Stage

**Prompt Framework Structure**:

```
[Fixed Anchors] + [Extracted Facial Features] + [Age Markers] + [Technical Specifications]
```

**Execution Approach**:

1. Apply fixed anchors first: black short hair with side part, gray-white T-shirt, pure white background, 3:4 vertical composition
2. Layer in extracted facial features: "\[eye structure\], \[nose profile\], \[mouth characteristics\], \[face shape\]"
3. Add age-appropriate markers: For children (4-10 years) emphasize "round cheeks, soft facial features, large eyes relative to face"; for teenagers (11-15 years) "more defined jawline, mature bone structure"
4. Technical specs: "Professional ID photo, frontal view, eyes at upper third, even soft lighting, sharp focus on face"

**Generation Settings**:

- Model: General image Pro
- Format: 3:4 vertical
- Lighting: Soft, even, no harsh shadows
- Focus: Sharp detail on facial features

### 3. Quality Check & Archiving Stage

**Quality Audit Checklist**:

- ✅ Hairstyle: Black short hair, side part, close to scalp, smooth texture (no long hair, no other colors)
- ✅ Clothing: Gray-white T-shirt visible (no other colors, no patterns)
- ✅ Background: Pure white #FFFFFF (no gradients, no shadows, no texture)
- ✅ Composition: 3:4 vertical, frontal view, eyes at upper 1/3
- ✅ Facial Features: Match documented extraction (eye shape, nose profile, mouth, face shape)
- ✅ Age Markers: Appropriate facial proportions for specified age range
- ✅ Expression: Natural, neutral, slight warmth (not blank/robotic)

**Archiving Protocol**:

1. Determine gender folder: 男孩 or 女孩
2. Determine age range subfolder: 5-7岁, 8-10岁, 11-13岁, 14-15岁, etc.
3. Query existing assets in that subfolder to find highest number
4. Increment by 1 for new file: If highest = 男孩3, next = 男孩4
5. Archive with confirmation message: "✅ Archived as 男孩/\[age-range\]/男孩\[N\]"

**Batch Handling**:

- For multiple images in one session, archive sequentially: 男孩1, 男孩2, 男孩3...
- Document all archiving in summary table format for user confirmation

## Key Constraints & Standards

### Immutable Rules (Never Compromise)

- Hairstyle MUST be black short hair with side part for male subjects — reference image hairstyles are ignored
- Clothing MUST be gray-white T-shirt — no other colors, patterns, or styles
- Background MUST be pure white #FFFFFF — zero tolerance for gradients, shadows, or color contamination
- Composition MUST be 3:4 vertical, frontal view, eyes at upper 1/3 — no creative angles

### Fidelity Rules (Accuracy Targets)

- Facial features must match reference image extraction across all 6 dimensions (eye/nose/mouth/face/skin/age)
- Age markers must be appropriate: children (4-10) = round cheeks + soft features; teenagers (11-15) = defined bone structure
- Expression must be natural and neutral with slight warmth — avoid blank robotic stares or forced smiles

### Consistency Rules (Cross-Output Coherence)

- All outputs in a single batch must use identical hairstyle anchor (black short side part)
- All outputs must use identical clothing anchor (gray-white T-shirt)
- All outputs must use identical background anchor (pure white)
- Lighting setup must be consistent across batch (soft, even, no harsh shadows)

### Archiving Rules (File Management Standards)

- MUST query existing assets before archiving to avoid naming conflicts
- MUST use two-level folder structure: \[Gender\]/\[Age-Range\]/\[FileName\]
- MUST use sequential numbering within age range folders
- MUST confirm archiving with explicit message: "✅ Archived as \[full path\]"

## Recommended Tools & Models

Use General image Pro for high-fidelity facial feature generation and consistent styling across batches.