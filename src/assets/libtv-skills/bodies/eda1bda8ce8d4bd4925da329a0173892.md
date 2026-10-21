---

## name: create-fogbound-cinema description: 'Create or revise still images, prompts, storyboards, and coherent shot sequences in the bundled fogbound cyan-blue cinematic language: low-key pre-dawn light, layered mist, blue-black silhouettes, restrained film texture, and grounded observational camerawork. Use when the user asks for 雾蓝电影感、冷青蓝夜景、低调战争电影质感, asks to match the bundled reference images, or wants another subject translated into this specific look. Do not trigger for every generic request containing “cinematic.”'

# Create Fogbound Cinema

Translate a requested subject into the reference set's visual language without copying its exact people, objects, or framing.

## Workflow

1. Read references/style-language.md before drafting or generating.
2. Separate the requested subject from the reference content. Preserve the style invariants; introduce soldiers, trenches, rifles, barbed wire, dead trees, or period uniforms only when the user requests them.
3. Default to **adapted match**: preserve lighting, atmosphere, palette, framing logic, and texture while changing the subject. Use a strict match or a light-touch match only when the user asks.
4. Choose the shot scale and reference subset from references/shot-recipes.md. Use the smallest useful subset, normally 2–4 images.
5. Build the prompt in this order:
   - story beat and emotional state
   - subject, action, and continuity anchors
   - shot scale, camera height, blocking, and movement
   - setting, foreground occlusion, and atmospheric depth
   - soft overcast light and silhouette separation
   - near-monochrome cyan-blue grade and compressed highlights
   - lens behavior, focus, and restrained film texture
   - explicit exclusions
6. When the user requests an actual bitmap, use the available image-generation capability with the selected files from `assets/references/` as style references. State that the references govern style only and that the new frame must not reproduce an exact composition.
7. For a sequence, lock subject identity, wardrobe, props, weather, terrain, light direction, travel direction, and grade before generating individual shots. Vary shot scale and camera position, not the world state.
8. Inspect the result at full frame. Revise one class of variables at a time: first composition, then light/atmosphere, then color/texture, then continuity.

## Non-Negotiable Style Invariants

- Keep the frame near-monochrome cyan-blue, with blue-black shadows and no clean whites.
- Use low-key, diffuse pre-dawn, blue-hour, or heavily overcast illumination.
- Build depth with mist and tonal layers rather than dramatic beams or glossy contrast.
- Keep figures readable mainly through silhouette, overlap, scale, and movement.
- Favor lateral observation, negative space, imperfect spacing, and grounded camera positions over heroic poster staging.
- Keep texture tactile and subdued: damp air, soil, fabric, haze, modest grain, and gentle optical softness.
- Preserve 16:9 unless the user specifies another format.

## Guardrails

- Do not reduce the look to a uniform blue overlay. Preserve local depth, material separation, and fog gradients.
- Do not add orange practicals, teal-orange split grading, neon cyan, hard sunlight, polished armor, glossy skin, excessive bloom, heavy vignette, crushed featureless blacks, or conspicuous digital sharpening unless requested.
- Do not add reference-specific war content to unrelated subjects.
- Do not imitate a named filmmaker or reproduce a recognizable source frame. Describe and apply the observable visual properties instead.
- Do not force every shot into silhouette. Permit restrained facial detail in close-ups while keeping the tonal ceiling low.

## Completion Check

Confirm that:

- the subject and action match the request;
- the frame reads as dimensional before it reads as blue;
- the brightest fog or sky remains muted;
- the composition feels witnessed rather than staged;
- the selected shot contributes a distinct narrative function;
- sequence continuity survives across adjacent frames;
- no unrequested reference motif has leaked into the new scene.