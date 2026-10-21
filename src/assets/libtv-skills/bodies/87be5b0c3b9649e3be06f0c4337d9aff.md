# Commercial Beauty Portrait Generation

## Core Methodology

### Element Fixation Framework

This skill uses a **Fixed-Variable Dimensional Isolation** approach to maintain visual consistency across a model portfolio while allowing controlled variation. The framework divides all visual elements into two categories:

**Fixed Dimensions (Immutable)**: These elements remain pixel-consistent across all outputs to establish series coherence:

- Hair: style, color, length, parting, styling method
- Wardrobe: garment type, color, neckline design, sleeve length, fabric drape
- Pose: body orientation, hand position, shoulder alignment, gesture specifics
- Expression: smile type, mouth openness, eye contact direction
- Framing: shot type, compositional cropping boundaries
- Camera: focal length, aperture, lighting setup, shadow density
- Aspect ratio: output dimensions

**Variable Dimensions (Controllable)**: These elements change deliberately to create portfolio diversity:

- Model identity: facial structure, features, skin tone, facial proportions
- Makeup intensity: natural vs defined, color saturation levels
- Background: solid colors, textures, environmental context
- Accessories: jewelry, props (when specified)

### Reference-Based Facial Transfer Logic

When working with reference images for facial features:

1. **Structural extraction**: Identify face shape (oval, round, heart), eye spacing, nose bridge height, lip fullness from reference
2. **Variation control**: Use descriptive terms like "清秀" (delicate), "立体" (dimensional), "柔和" (soft) to guide away from exact duplication while maintaining aesthetic direction
3. **Distinction enforcement**: When regenerating, explicitly request "全新模特" (entirely new model) or "五官明显区别" (distinctly different features) to prevent AI from repeating the same face

### Commercial Beauty Lighting Framework

**High-key Studio Setup** for flawless skin rendering:

- Light distribution: 均匀无阴影 (even, shadowless) — eliminates unflattering shadows on face/neck
- Tonality: 高调柔光 (high-key soft light) — creates bright, airy aesthetic typical of beauty/skincare advertising
- Skin effect: 玻璃肌 (glass skin) — translucent, dewy finish with natural highlights on cheekbones and nose bridge
- Technical parameters: 85mm portrait lens at f/5.6 — shallow depth of field isolates subject, f/5.6 balances sharpness with soft background

## Workflow

### 1. Preparation Stage

**Element Inventory Checklist**:

- \[ \] Reference image for facial structure (if required)
- \[ \] Wardrobe reference image (if custom garment needed)
- \[ \] Fixed element specification list (hair, clothing, pose, expression, framing, camera, aspect ratio)
- \[ \] Variation dimensions (what should change: model identity, makeup, background)

**Key Decisions**:

- Shot type: 近景胸景 (medium close-up/bust shot) captures head-neck-shoulder line, ideal for beauty/fashion portfolio
- Consistency anchor: Which fixed elements are non-negotiable for series coherence? (e.g., same hairstyle + same pose + same lighting)
- Variation scope: How much facial diversity is acceptable? (slight variation vs entirely different models)

### 2. Initial Design Stage

**Prompt Structure Framework**:

```
[Shot type] + [Model ethnicity/age] + [Facial structure reference (if any)] + [Fixed hair] + [Fixed wardrobe] + [Fixed pose] + [Fixed expression] + [Skin texture] + [Makeup style] + [Camera specs] + [Lighting setup] + [Background] + [Quality standards] + [Aspect ratio]
```

**Execution Approach**:

1. Start with reference image (if provided): "参考{{ reference }}的脸型轮廓与五官风格" (reference the facial structure and feature style of \[image\])
2. Specify fixed immutable elements with high precision:
   - Hair: "黑色直发中分低马尾,发丝光滑" (black straight hair, center part, low ponytail, smooth strands)
   - Wardrobe: "米白色长袖上衣,露肩挖肩设计,双肩镂空,圆领,面料柔软垂坠" (off-white long sleeve, shoulder cutout design, round neck, soft drape fabric)
   - Pose: "左手手指微微弯曲轻碰下巴,身体侧身对镜头,肩膀一前一后" (left hand fingers slightly bent touching chin, body angled to camera, shoulders staggered front-back)
   - Expression: "俏皮微笑不漏齿" (playful smile, teeth not showing)
3. Specify variable elements with aesthetic direction:
   - Model: "年轻亚洲女性,鹅蛋脸,双眼皮大眼,高挺鼻梁,饱满唇" (young Asian female, oval face, double-eyelid large eyes, high nose bridge, full lips) — descriptive but not prescriptive
   - Skin: "无瑕玻璃肌,肌肤细腻水润发光,肤色均匀白皙" (flawless glass skin, dewy luminous, even fair complexion)
   - Makeup: "裸妆感,平直柔和眉,极淡眼影,纤细眼线,水润蜜桃唇,轻盈腮红" (natural makeup, soft straight brows, minimal eyeshadow, thin liner, dewy peach lips, light blush)
4. Lock technical parameters: "85mm人像镜头,f/5.6光圈,高调柔光棚拍,均匀无阴影,近景胸景,头颈肩线条,3:4竖版,2K分辨率,超写实,商业广告质感"

### 3. Iteration Stage

**Optimization Dimensions**:

1. **Facial Variation Control**:

   - Issue: "五官太相似" (features too similar to previous output)
   - Solution: Add "重新生成全新模特" (regenerate entirely new model) or "五官明显区别" (distinctly different features)
   - Verification: Compare facial proportions (eye spacing, nose width, lip shape) — should have noticeable differences while maintaining same aesthetic standard

2. **Pose Refinement**:

   - Issue: Hand position unclear or unnatural
   - Solution: Granular gesture description — "手指微微弯曲" (fingers slightly bent) vs "手指伸直" (fingers straight)
   - Verification: Hand should contact face gently without distorting facial features; fingers visible and naturally posed

3. **Wardrobe Fit Calibration**:

   - Issue: Garment details lost or inaccurate
   - Solution: Provide reference image + detailed verbal description: "露肩挖肩设计,双肩镂空" (shoulder cutout design, both shoulders hollowed out)
   - Verification: Cutout areas should expose skin, fabric drape should follow body contours naturally

4. **Framing Adjustment**:

   - Issue: Composition too tight or too loose
   - Solution: Specify exact framing: "近景胸景,胸部以上,重点展示头颈肩线条" (medium close-up bust shot, chest and above, emphasizing head-neck-shoulder line)
   - Verification: Full head visible with no cropping, neck and upper chest included, shoulders define frame bottom

**Consistency Audit Checklist** (Run before accepting output):

- \[ \] Hair: Center part? Low ponytail? Black color? Smooth texture?
- \[ \] Wardrobe: Correct color? Shoulder cutout present? Neckline accurate? Fabric drape natural?
- \[ \] Pose: Left hand touching chin? Body angled? Shoulders staggered?
- \[ \] Expression: Smile playful? Teeth concealed?
- \[ \] Framing: Bust shot? Head-neck-shoulder visible? No awkward cropping?
- \[ \] Camera/Lighting: High-key? Shadowless? Soft light? Skin has glass finish?
- \[ \] Aspect ratio: 3:4 vertical?

**When to Regenerate vs Refine**:

- **Regenerate** (start over): Fixed elements incorrect (wrong hairstyle, wrong garment, wrong pose), facial features fail to differentiate from previous output
- **Refine** (iterate): Minor adjustments to expression intensity, hand position micro-adjustments, subtle lighting tweaks

## Key Constraints & Standards

### Immutable Consistency Rules

1. **Hair**: 黑色直发中分低马尾 (black straight hair, center part, low ponytail) — style, color, parting, and tying method must be identical across all outputs
2. **Wardrobe**: 米白色长袖露肩上衣,圆领 (off-white long sleeve with shoulder cutouts, round neck) — color, sleeve length, neckline, cutout design non-negotiable
3. **Pose**: 左手轻碰下巴,侧身,肩膀一前一后 (left hand touching chin, body angled, shoulders staggered) — hand gesture, body orientation, shoulder alignment fixed
4. **Expression**: 俏皮微笑不漏齿 (playful smile, no teeth showing) — smile type and mouth closure locked
5. **Framing**: 近景胸景 (medium close-up bust shot) — compositional cropping boundaries consistent
6. **Technical**: 85mm f/5.6, 高调柔光棚拍, 均匀无阴影 (high-key soft studio light, even shadowless) — camera and lighting setup identical
7. **Format**: 3:4竖版, 2K分辨率 (3:4 vertical, 2K resolution) — aspect ratio and output quality locked

### Facial Differentiation Standards

- Each regenerated model must have **明显区别的五官** (distinctly different features)
- Variation dimensions: face shape (oval vs round vs heart), eye size/spacing, nose bridge height/width, lip fullness, facial bone structure
- Acceptable similarity: Same ethnic aesthetic (Asian beauty standard), same age range (young female), same skin quality (flawless glass skin)
- Unacceptable similarity: Identical facial proportions, recognizable as same person, AI repeating previous face

### Skin & Makeup Fidelity Rules

1. **Skin texture**: 无瑕玻璃肌 (flawless glass skin) — translucent, dewy, luminous finish with natural highlights on high points (cheekbones, nose bridge, forehead)
2. **Skin tone**: 均匀白皙 (even fair complexion) — no discoloration, blemishes, or uneven patches
3. **Makeup intensity**: 裸妆感 (natural makeup look) — makeup present but imperceptible, enhances features without obvious artificiality
4. **Lip finish**: 水润蜜桃唇 (dewy peach lips) — glossy, hydrated appearance, soft peachy tone (not bold or matte)

### Compositional Quality Standards

1. **Head clearance**: 头部完整露出无裁切 (full head visible with no cropping) — top of head must have breathing room, no awkward forehead cropping
2. **Neck-shoulder line**: 重点展示头颈肩线条 (emphasize head-neck-shoulder line) — graceful neckline clearly visible, shoulder slope defines frame bottom
3. **Hand placement**: Fingers must contact chin/face area naturally without obscuring key facial features (eyes, nose, mouth)
4. **Background**: 纯白背景 (pure white background) — clean, no gradients or textures, complete isolation of subject

### Lighting & Atmosphere Standards

1. **Shadow elimination**: 均匀无阴影 (even shadowless) — no harsh shadows on face, neck, or body; beauty lighting eliminates unflattering contours
2. **Highlight placement**: Natural highlights (not artificial-looking) on forehead, cheekbones, nose bridge, collarbone
3. **Overall tonality**: 高调 (high-key) — bright, airy, optimistic mood suitable for beauty/skincare/fashion commercial use
4. **Realism**: 超写实 (hyperrealistic) — photographic quality, not illustrated or stylized; commercial advertising finish