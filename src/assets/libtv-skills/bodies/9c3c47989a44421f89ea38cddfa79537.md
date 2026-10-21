# Metal Product Photo Retouching

## Core Methodology

### Multi-Model Parallel Generation Framework

**Purpose**: Eliminate guesswork by generating comparison outputs across multiple AI models simultaneously, allowing users to select the optimal result based on actual visual quality rather than technical specs.

**Execution Logic**:
- **Model Pool**: General image Pro (high-fidelity detail), General image V2 (balanced rendering), Seedream 5.0 Pro (photorealistic lighting), Lib Image (commercial optimization)
- **Parallel Processing**: All selected models process the same structured prompt concurrently
- **Output Comparison**: Present results in a table format with model names and node references for direct visual comparison
- **Selection Guidance**: No predetermined "best" model — user evaluates based on specific product material (brushed steel vs polished chrome), lighting requirements, and brand aesthetic standards

### Structure-Preserving Refinement Logic

**Critical Rule**: Product geometry (proportions, component relationships, structural features) must remain pixel-accurate to the source image. Changes are limited to surface quality enhancements only.

**Immutable Elements**:
- Component ratios (e.g., bolt head diameter : shaft length : nut width)
- Threading pitch and depth
- Mechanical features (knobs, buttons, seams, mounting points)
- Overall silhouette and viewing angle

**Mutable Elements**:
- Surface finish quality (remove scratches, oxidation, fingerprints)
- Material reflectivity (enhance mirror polish, brushed texture clarity)
- Background environment (replace cluttered real-world scenes with pure white studio backdrop)
- Lighting consistency (unify highlights, eliminate uneven shadows)

### Reference-Style Transfer vs Direct Generation

**Two Operational Modes**:

1. **Reference-Style Transfer** (when style example provided):
   - Analyze reference image for: metal finish type (mirror/brushed/matte), highlight intensity, shadow softness, background treatment
   - Extract lighting setup: key light position, fill light ratio, rim light presence
   - Apply learned aesthetic to target product while maintaining its unique structure
   - Use case: User has a "gold standard" retouched image and wants to replicate that exact quality level

2. **Direct Generation** (when no reference provided):
   - Apply learned conventions from conversation history: pure white seamless background, three-point studio lighting, high-key exposure
   - Default to commercial product photography standards: f/11 depth of field, no lens distortion, neutral color temperature
   - Prioritize defect removal over creative interpretation

## Workflow

### 1. Preparation Stage

**Pre-Generation Checklist**:
- User uploads source product photo (any background, any lighting condition acceptable)
- System inquires aspect ratio preference:
  - Standard options: 3:4 (vertical product card), 4:3 (horizontal catalog), 1:1 (social media square), 9:16 (mobile story), 16:9 (web banner)
  - Custom ratio: User specifies exact dimensions
- System inquires model selection (multi-select enabled):
  - General image Pro (recommended for intricate mechanical parts)
  - General image V2 (recommended for broader product categories)
  - Seedream 5.0 Pro (recommended for luxury/high-end positioning)
  - Lib Image (optional fourth comparison point)
- System inquires operation mode:
  - **Automatic Mode**: System selects optimal prompt parameters based on detected product category (fasteners, appliances, tools, etc.) and generates immediately
  - **Manual Mode**: User reviews/edits structured prompt before generation (for advanced users requiring specific technical control)

**Product Analysis** (automatic during preparation):
- Material identification: Stainless steel, brass, aluminum, chrome-plated, powder-coated
- Surface finish detection: Mirror polish, brushed, bead-blasted, machined
- Component inventory: Count discrete parts (e.g., bolt + nut + washer = 3 components)
- Defect mapping: Catalog visible scratches, dents, stains, oxidation spots for targeted removal

### 2. Initial Design Stage

**Prompt Framework Structure**:

[Product Category] + [Material Specification] + [Surface Quality Directive] + [Background Standard] + [Structural Constraint] + [Lighting Setup]

Example breakdown for bolt assembly:
- Product Category: "蝶形螺栓组件,不锈钢材质,把手+螺杆+螺母完整组合" (butterfly bolt assembly, stainless steel, complete handle+shaft+nut combination)
- Material Specification: "镜面抛光金属质感" (mirror-polished metal texture)
- Surface Quality Directive: "产品完美无瑕,去除所有划痕、污渍、指纹" (product flawless, remove all scratches, stains, fingerprints)
- Background Standard: "纯白色电商背景,专业棚拍" (pure white e-commerce background, professional studio photography)
- Structural Constraint: "保持产品比例结构不变,螺纹细节清晰" (maintain product proportions and structure unchanged, threading details clear)
- Lighting Setup: "金属高光自然流畅,三点布光" (metal highlights natural and smooth, three-point lighting)

**Execution Sequence**:
1. Generate prompts in Chinese (user's working language per conversation context)
2. Submit identical structured prompt to all selected models simultaneously
3. Set aspect ratio uniformly across all generation tasks
4. Track generation progress with model-specific node IDs
5. Compile results into comparison table upon completion

### 3. Iteration Stage

**Multi-Dimensional Optimization** (if user requests refinement):

**Dimension 1: Material Fidelity**
- Check: Does brushed texture show directional grain? (parallel lines, not random noise)
- Check: Does mirror polish show environment reflections? (gradient light falloff, not flat gray)
- Check: Does chrome plating show color-accurate blue tint? (not pure white)
- Adjustment method: Add material-specific keywords ("拉丝质感清晰" for brushed, "高光自然流畅" for polished)

**Dimension 2: Defect Removal Completeness**
- Check: Are scratches fully eliminated? (not blurred, but regenerated as clean surface)
- Check: Are weld seams/mold lines removed or preserved? (depends on product type — functional hardware keeps seams, decorative items remove them)
- Check: Are logo/branding elements intact? (never remove intentional markings)
- Adjustment method: Add "去除[specific defect type]" or "保留[specific feature]" to prompt

**Dimension 3: Lighting Consistency**
- Check: Does primary highlight cover 20-30% of the metal surface? (not overexposed)
- Check: Are shadows soft-edged? (gradient transition, not hard cutoff)
- Check: Is rim light present on product edges? (subtle separation from background)
- Adjustment method: Specify "柔和阴影" (soft shadows), "边缘光" (rim light) in prompt

**Dimension 4: Background Cleanliness**
- Check: Is white background perfectly uniform? (RGB 255,255,255 ±5 tolerance)
- Check: Are there any background artifacts? (no residual shadows, no color contamination from original environment)
- Adjustment method: Emphasize "纯白色背景" (pure white background), "无杂物" (no clutter)

**Batch Consistency Audit** (when processing multiple products for same catalog):
- Lighting angle must remain identical across series (measure highlight position relative to product center)
- Background brightness must not vary (use histogram to verify uniform RGB values)
- Camera perspective must stay locked (same viewing angle for comparable product sizes)

**Regeneration Decision Rules**:
- **Accept immediately**: Structure preserved + defects removed + background clean + material looks correct
- **Regenerate with refined prompt**: One dimension failed (e.g., scratches still visible) → add specific constraint
- **Switch models**: Persistent failure across refinements → try different model from pool
- **Escalate to manual mode**: Automatic mode produces inconsistent results after 3 attempts → switch to manual prompt editing

## Key Constraints & Standards

### Immutable Structural Rules

1. **Geometric Preservation**: Product outline, component proportions, and spatial relationships must match source image within 5% tolerance. Measure keypoint distances (e.g., bolt head corner-to-corner) to verify.
2. **Mechanical Detail Fidelity**: Threading direction (left-hand vs right-hand), knob rotation indicators, screw slot type (Phillips/flathead/hex) must remain accurate to source.
3. **Component Count Invariance**: If source shows 3 washers stacked, output must show 3 washers (not 2, not 4).

### Surface Quality Standards

4. **Defect-Free Surface**: Zero tolerance for scratches, dents, oxidation spots, fingerprints, dust particles, or water stains visible in final output.
5. **Material Texture Authenticity**: Brushed metal must show unidirectional grain pattern; mirror polish must show crisp reflections; powder coating must show slight orange-peel texture.
6. **Edge Sharpness**: Machined edges (chamfers, fillets) must remain crisp, not softened or blurred during refinement.

### Background & Lighting Standards

7. **Pure White Background**: RGB values (255, 255, 255) ±5 tolerance. No gradients, no shadows cast onto background (shadows only on product itself for depth).
8. **Studio Lighting Simulation**: Three-point lighting setup implied — key light at 45° (creates main highlight), fill light at camera position (lifts shadows to visible detail), rim light from behind (separates product from background).
9. **Highlight Coverage**: Primary highlight should cover 20-30% of the most reflective surface. Overexposure (>50% blown-out white) is unacceptable.

### Multi-Model Generation Standards

10. **Minimum Model Count**: Always generate with at least 2 models (preferably 3) to provide meaningful comparison. Single-model output defeats the framework's purpose.
11. **Prompt Consistency**: All models in a batch must receive identical prompts (same Chinese text, same parameters). Only aspect ratio and model name differ.
12. **Result Presentation**: Outputs must be organized in a comparison table showing model name and node ID, enabling immediate visual evaluation.

### Language & Aspect Ratio Standards

13. **Prompt Language**: Generate all prompts in Chinese (用户's working language per conversation evidence).
14. **Aspect Ratio Flexibility**: Support user-defined ratios beyond standard presets (e.g., 5:7 for custom product card dimensions).
15. **Ratio Application Uniformity**: All models in a generation batch must use identical aspect ratio.

## Recommended Tools & Models

- **General image Pro**: Ideal for high-detail mechanical products requiring precise edge rendering and fine texture preservation (threading, knurling, machined surfaces). Recommended for luxury/precision product categories.
- **General image V2**: Balanced performance across diverse product types. Suitable as the "baseline" model for general metal product retouching when unsure which specialized model to choose.
- **Seedream 5.0 Pro**: Excels at photorealistic lighting simulation and natural highlight rendering. Recommended for products where aesthetic presentation outweighs technical accuracy (e.g., decorative hardware, lifestyle appliances).
- **Lib Image**: Additional comparison option for e-commerce-optimized outputs. May sacrifice some material authenticity for higher perceived commercial appeal.

**Model Selection Strategy**:
- **Fasteners/Industrial Parts**: General image Pro + General image V2
- **Appliances/Consumer Products**: Seedream 5.0 Pro + General image Pro  
- **Decorative Hardware**: Seedream 5.0 Pro + Lib Image
- **Unknown Category**: All four models for comprehensive comparison

## Advanced Techniques

### Style Transfer from Reference Image

When user provides a reference retouched image alongside the product photo:

1. **Extract Reference Characteristics**:
   - Screenshot reference image's highlight pattern (shape, intensity, coverage area)
   - Analyze shadow softness (measure gradient width in pixels)
   - Identify background treatment (pure white vs subtle gradient vs reflected environment)

2. **Translate to Prompt Adjustments**:
   - High-contrast highlights → add "强烈金属高光" (intense metal highlights)
   - Soft diffused lighting → add "柔和均匀布光" (soft even lighting)
   - Visible reflections → add "环境反射清晰" (clear environment reflections)

3. **Apply to Target Product**:
   - Maintain target product's unique structure
   - Transfer only the lighting/material treatment style
   - Verify that transferred style doesn't conflict with target material type (e.g., brushed texture style doesn't work on mirror-polished products)

### Batch Processing Optimization

When retouching 10+ products for a unified catalog:

1. **Generate Master Template**: Retouch the most representative product first with all 4 models, select the best output.
2. **Prompt Templatization**: Save the winning prompt as template, replace only the product-specific keywords (e.g., "螺栓" → "螺母").
3. **Lighting Locking**: Use identical model + aspect ratio for entire batch to ensure lighting consistency.
4. **Staged Review**: Generate in groups of 5, review for consistency before proceeding to next batch.
5. **Consistency Verification**: Overlay multiple outputs in Photoshop at 50% opacity — highlights should align spatially if lighting is truly consistent.