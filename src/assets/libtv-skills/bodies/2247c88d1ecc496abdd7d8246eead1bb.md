---

## name: create-consistent-character-sheets description: Create identity-consistent character design images in two controlled stages: first a full-body front-view character sheet on a pure white background, then a matching front/side/back three-view turnaround using the approved image as the identity reference. Use when users ask for 白底角色设定图、角色正面全身图、人物定妆图、角色一致性、三视图、turnaround sheet, or prompts/workflows for consistent 2D, 3D, anime, Chinese animation, chibi, game, or photorealistic characters.

# Create Consistent Character Sheets

Create the approved front-view identity anchor before creating a three-view sheet. Preserve identity and costume construction over decorative variation.

## Collect the brief

Extract or infer only these fields:

- `style`: select one entry from references/style-presets.md, or preserve the user's named style.
- `identity`: age range, gender presentation, face shape, facial features, skin tone, hair shape/color, and distinctive marks.
- `costume`: silhouette, layers, materials, colors, footwear, accessories, and attachment positions.
- `body`: height impression, proportions, and build.
- `constraints`: elements that must appear or must not appear.

Ask at most one concise question only when a missing detail would materially change the character. Otherwise choose conservative defaults and state them briefly.

## Build the identity lock

Write a compact internal `IDENTITY_LOCK` before generating anything. Convert every visible attribute into a stable, concrete description. Include exact left/right placement for asymmetric details. Do not use vague personality adjectives where visible traits are needed.

Treat these as immutable after the front view is approved:

- facial geometry and apparent age
- hairstyle outline, parting, length, and color
- body proportions and skin tone
- costume silhouette, layer order, colors, materials, closures, and hems
- accessory count and exact attachment position
- distinctive marks and their left/right orientation

Do not add new jewelry, patterns, props, makeup, or costume layers during the three-view stage.

## Stage 1: Generate the white-background front view

Compose the prompt in this order:

1. selected style preset
2. `character design sheet, single character`
3. complete `IDENTITY_LOCK`
4. `full body, strict front view, facing camera, neutral standing pose, arms naturally separated from torso, feet fully visible`
5. `pure seamless white background, even neutral studio lighting, no cast shadow, centered composition`
6. `clear costume construction, accurate anatomy, clean silhouette, high detail`

Add negative constraints: `no text, no labels, no border, no scene, no furniture, no props unless specified, no cropped feet, no duplicate person, no extra limbs, no dynamic pose, no tilted body, no perspective distortion`.

Generate one character only. Never combine the front view and three views in the first image. If the tool supports aspect ratio, prefer portrait 2:3 or 3:4.

Inspect the result before continuing. Reject it if the face is unclear, the body is cropped, the pose is not frontal, the background is not white, or the costume cannot be reconstructed from the image. Regenerate Stage 1 until usable.

## Approval gate

Use the Stage 1 image as the canonical visual reference. If the user is actively reviewing results, obtain approval before Stage 2. If the request explicitly asks for the complete workflow in one pass, choose the best valid Stage 1 result and continue.

## Stage 2: Generate the consistent three-view sheet

Supply the approved Stage 1 image to the image-editing or reference-image mechanism. Do not rely on text alone when an image reference can be passed.

Use this instruction structure:

`Using the supplied character image as the strict identity and costume reference, create one orthographic character turnaround sheet showing exactly three full-body views of the same character: front view, left side view, and back view, arranged left to right at equal scale. Preserve [IDENTITY_LOCK] exactly. Keep identical face, head size, hairstyle, body proportions, costume construction, colors, materials, accessory count and placement. Neutral standing pose, arms slightly away from torso, feet aligned, eye-level orthographic presentation, pure seamless white background, even neutral lighting, no cast shadow, generous spacing between views.`

Add negative constraints: `no three-quarter view, no mirrored asymmetry, no redesign, no alternate outfit, no color shift, no hairstyle change, no age change, no body-shape change, no missing accessories, no added accessories, no overlapping figures, no crop, no text, no labels, no perspective distortion`.

Prefer landscape 16:9 or 3:2. Require exactly three figures. Keep view order explicit and do not request facial expression variants in the same image.

## Validate consistency

Compare the three-view output against the approved front view:

- face, hairline, hair length, and head-to-body ratio match
- front costume construction matches the anchor
- side and back views logically continue seams, layers, hems, and fasteners
- asymmetric details remain on the character's anatomical side rather than the viewer's side
- colors and materials do not drift
- all three figures have equal scale, aligned feet, neutral poses, and complete bodies
- the sheet contains exactly front, left side, and back views on pure white

If one category fails, regenerate Stage 2 with a short correction focused only on that category while reusing the same reference image. Do not rewrite the character or loosen the identity lock.

## Deliver

When image generation is available and the user asks to make images, generate the images rather than returning prompts only. When the user asks for prompts, return:

1. the normalized character brief
2. the Stage 1 prompt
3. the Stage 1 negative prompt
4. the Stage 2 prompt
5. the Stage 2 negative prompt

Keep the prompt wording compatible with general image models unless the user names a specific platform.