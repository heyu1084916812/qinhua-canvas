# AI Image Quality Repair

## Core Methodology

### Dual-Stage Reconstruction Framework

This skill uses a **structural decomposition → detail synthesis** pipeline to repair degraded AI-generated or processed images:

**Stage 1 (Structural Reconstruction)**: Convert the problem image into a clean 3D wireframe model preview using Image2Image mode. This strips away surface artifacts (blur, over-smoothing, smudging) and extracts the underlying geometric structure.

**Stage 2 (Detail Restoration)**: Use the original problem image + Stage 1 wireframe as dual references in a multi-reference generation model (LibNano Pro). The original provides color/texture memory; the wireframe provides clean structure — combining them produces a repaired high-fidelity output.

This two-pass approach addresses the common failure mode where direct single-pass repair either preserves artifacts or over-corrects and loses original character.

### Quality Control Dimensions

**Resolution axis**: 1K (fast preview) / 2K (standard web use) / 4K (print/commercial)

**Quality tier axis** (Stage 1 only): Low (speed priority) / Standard (balanced) / High (maximum fidelity)

**Aspect ratio locking**: All outputs maintain user-specified aspect ratio across both stages to prevent composition distortion.

## Workflow

### 1. Preparation Stage

**Input checklist**:

- Problem image exhibiting one or more artifacts:
  - Blur/soft focus (insufficient sharpness)
  - Over-smoothing/plastic skin texture (AI over-processing)
  - Smudging/detail loss (common in AI upscaling/style transfer)
- No style or scene restrictions — universal applicability

**Pre-execution decisions**:

- Aspect ratio selection (standard tokens: 1:1, 3:4, 4:3, 9:16, 16:9, 9:21, 21:9)
- Stage 1 resolution + quality tier
- Stage 2 resolution

### 2. Initial Design Stage — Two-Pass Execution

**Stage 1: Structural Reconstruction (Image2Image)**

- Use problem image as reference input
- Apply Blender-style 3D wireframe conversion prompt (strips surface texture, isolates geometry)
- User-selected resolution (1K/2K/4K) + quality tier (Low/Standard/High)
- Lock aspect ratio to user-specified value
- Output: Clean structural reference image

**Stage 2: Detail Restoration (LibNano Pro)**

- Dual-reference setup:
  - Reference A: Original problem image (preserves color palette, texture intent)
  - Reference B: Stage 1 wireframe output (provides clean structural guidance)
- Apply detail restoration prompt (synthesizes clean details from dual references)
- User-selected resolution (1K/2K/4K, independent of Stage 1 choice)
- Maintain same aspect ratio as Stage 1
- Output: Final repaired image

### 3. Iteration Stage

**Resolution adjustment**: If Stage 2 output lacks expected detail, retry with higher resolution tier (e.g., 2K → 4K). Stage 1 does not need regeneration.

**Quality tier adjustment** (Stage 1): If wireframe structure is too simplified or noisy, regenerate Stage 1 with different quality tier:

- Low → Standard: if structure is too coarse
- Standard → High: if fine details (hair, fabric texture) are lost in wireframe
- High → Standard: if wireframe is overdetailed and introduces new noise

**Aspect ratio correction**: If output composition feels cramped or stretched, verify aspect ratio matches original intent. Regenerate both stages with corrected ratio.

**Batch consistency**: When repairing multiple images from the same source (e.g., a photoshoot), use identical resolution/quality/aspect ratio settings across all images to maintain visual coherence.

## Key Constraints & Standards

### Immutable Rules

- **Aspect ratio consistency**: Both stages MUST use the same aspect ratio token. No mid-workflow ratio changes allowed.
- **Dual-reference requirement**: Stage 2 MUST include both original image and Stage 1 output as references. Single-reference execution will fail to balance structure vs. texture.
- **Model assignment**: Stage 1 uses Image2Image mode; Stage 2 uses LibNano Pro. Do not swap models.

### Quality Standards

- **Structural integrity**: Stage 1 wireframe must preserve all major compositional elements (subject pose, scene layout, object placement) from original.
- **Texture preservation**: Stage 2 output must retain original color palette and material characteristics (e.g., fabric type, skin tone, lighting mood).
- **Artifact elimination**: Final output must show measurable improvement in target metrics:
  - Blur: increased edge sharpness
  - Over-smoothing: restored micro-texture (skin pores, fabric weave)
  - Smudging: clear object boundaries, no color bleeding

### User Interaction Points

- **Aspect ratio query**: Always ask user to specify aspect ratio at workflow start. List standard options (1:1, 3:4, 4:3, 9:16, 16:9, 9:21, 21:9) and allow custom input if needed.
- **Stage 1 quality query**: Present three options (Low/Standard/High) with use case guidance:
  - Low: fast iteration, simple subjects
  - Standard: recommended default
  - High: complex subjects with fine details
- **Stage 2 resolution query**: Ask separately from Stage 1 (user may want lower-res preview in Stage 1, high-res final in Stage 2).

## Recommended Tools & Models

- **Stage 1**: Use Image2Image mode with Blender-style wireframe conversion prompt
- **Stage 2**: Use LibNano Pro for multi-reference detail synthesis