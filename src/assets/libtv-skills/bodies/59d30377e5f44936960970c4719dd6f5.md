---

## name: create-visual-rhyme-transition description: Create one short transition video between exactly two supplied images by identifying and preserving shared visual anchors such as geometry, layout, color, material, and motion direction. Use when a user asks for a seamless match transition, visual-rhyme transition, material morph, radial transformation, or grid-propagation transition from a start image to an end image. Output one 4–6 second transition rather than a full film.

# Create Visual Rhyme Transition

## Overview

Turn two visually related or seemingly unrelated images into one continuous transition. Find the strongest shared visual anchor, keep that anchor stable, and transform corresponding elements rather than hiding the change with a cut or global crossfade.

Read references/validated-patterns.md when selecting a transition family, writing the generation prompt, or diagnosing a failed result.

## Enforce the Input Contract

Require exactly:

- One start image.
- One end image.

Accept these optional controls:

- Duration; default to 5 seconds and keep it between 4 and 6 seconds.
- Aspect ratio; default to the supplied images' shared ratio.
- Visual tone or realism level.
- Motion strength; default to low or medium.

If the images use different aspect ratios, normalize them without cropping out the intended anchors. If the start/end roles are unclear, ask the user to identify them.

Default to a locked camera, no captions, no narration, and no music. Do not expand the request into a multi-scene film.

## Analyze the Pair

Inspect both images before generating. Compare:

1. Geometry and topology: circles, radial segments, grids, parallel lines, silhouettes.
2. Position and scale: center point, occupied area, horizon, vanishing point.
3. Perspective and camera angle.
4. Dominant colors and brightness distribution.
5. Materials and textures.
6. Elements that can map one-to-one.
7. Backgrounds that can change independently without breaking continuity.

Choose one primary anchor and no more than two supporting anchors. Prefer structural similarity over semantic similarity.

Create an internal map with these fields:

FieldMeaningAnchorThe point, contour, axis, or grid that must not driftStart elementThe visible source elementEnd elementIts target counterpartTransformationThe physical-looking change between themInvariantPosition, size, direction, or rhythm that remains stable

If there is no credible common anchor, do not force a direct morph. Ask for a tighter crop, a reframed image, or a bridge frame that introduces compatible geometry.

## Select the Transition Family

Use the narrowest family that explains the pair:

- **Circular or radial texture morph:** Keep the center and diameter fixed while radial fibers, glow, liquid, smoke, or surface material becomes the target.
- **Segmented radial morph:** Map panels, spokes, ribs, petals, blades, or folds one-to-one around a fixed center.
- **Grid or linear propagation:** Lock one cell or line, then let windows, tiles, keys, pixels, or modules convert outward in an ordered wave.
- **Contour match:** Preserve the dominant outline while the interior material and surrounding scene change.

Do not choose a family only because the subjects share a color. Color may support the transition but should not be the sole anchor.

## Compose the Generation Prompt

Write the prompt in this order:

1. State the locked camera and fixed anchor.
2. Name the start and end elements explicitly.
3. Describe element-level mappings using physical verbs such as unfold, split, grow, stretch, crystallize, ignite, dissolve into particles, or route into lines.
4. Describe how the background changes separately and continuously.
5. Require high fidelity to both supplied frames.
6. Forbid failure modes that are relevant to the pair.

Use a prompt pattern like:

```text
Locked camera. Keep [anchor] fixed in position, scale, and perspective.
[Start element A] continuously transforms into [end element A] as
[start element B] becomes [end element B]. Preserve [invariant].
The background changes from [start background] into [end background]
without a cut. Begin exactly from the supplied start image and settle
exactly into the supplied end image. No global crossfade, no camera
orbit, no extra objects, no duplicated structures, no warped geometry.
```

Avoid vague instructions such as “smoothly transform image one into image two.” They usually produce crossfades, arbitrary style changes, or anchor drift.

## Set Timing and Generation Controls

For a 5-second result, use this rhythm:

- 0.0–0.7 seconds: hold and establish the start frame.
- 0.7–3.8 seconds: reveal a continuous, readable transformation.
- 3.8–5.0 seconds: settle and hold the exact end frame.

Scale these phases proportionally for other durations.

Use start/end-frame generation when available. Give the end-frame constraint the highest priority. Keep creativity and motion strength low to medium unless the user requests an expressive interpretation.

## Validate the Result

Inspect the beginning, midpoint, and ending:

- The first frame closely matches the supplied start image.
- The last frame closely matches the supplied end image.
- The primary anchor does not visibly drift, rotate, or change scale without a reason.
- The midpoint exposes a readable element mapping rather than a global dissolve.
- The geometry remains plausible; circles do not become accidental ellipses and grids do not collapse.
- No extra subject, duplicate structure, hard cut, sudden pop, or unrelated style appears.

Retry only the failed dimension:

- For anchor drift, reinforce fixed center, fixed scale, fixed perspective, and locked camera.
- For a crossfade, describe more element-level mappings and forbid global dissolve.
- For a weak end match, lower creativity and strengthen end-frame fidelity.
- For a sudden pop, start the transformation earlier and extend the conversion phase.
- For excessive stylization, constrain materials, palette, lighting, and realism.

## Deliver

Return the best 4–6 second video and one concise sentence naming the visual anchor and the main mapping. Do not add a narrative treatment unless the user asks for one.