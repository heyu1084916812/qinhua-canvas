---

## name: photo-to-line-art description: Convert a supplied photo or image into a clean black-and-white hand-drawn line-art illustration, coloring-page sketch, or simple ink outline in the style of a reference line drawing. Use when the user asks to transform an image into the style of Image 2, line art, black outline drawing, coloring page, hand sketch, simplified comic outline, or printable outline while preserving the original subject, pose, and composition.

# Photo To Line Art

Use this skill to turn a user-supplied image into a clean black-and-white line drawing while preserving the original subject, pose, camera angle, and major composition.

## Workflow

1. Inspect the source image before editing.
2. If the user provides a target/reference style image, inspect it too. Otherwise inspect `assets/style-reference.png` and use the default style in `references/style-guide.md`.
3. Use image editing/generation with the source image as the required reference. Include the style guide constraints in the prompt.
4. Ask for a missing source image only when no image has been supplied or no previous image is available to edit.

## Prompt Pattern

When editing the image, adapt this prompt:

```text
Transform the provided photo into a clean black-and-white hand-drawn line-art illustration.
Preserve the same subject identity, pose, proportions, camera angle, foreground/background relationships, and major objects.
Render as bold smooth black ink outlines on a plain white background, like a simple coloring-book page or loose comic sketch.
Simplify textures into sparse contour lines. Remove photographic color, shadows, gradients, realistic lighting, and surface detail.
Keep only essential interior lines that explain form, clothing, face, joints, wheels, props, and silhouettes.
Avoid crosshatching, grayscale shading, sketchy noise, filled black areas, heavy background detail, text, watermarks, and added objects.
```

For the user's specific Image 1 -&gt; Image 2 example, emphasize:

- Low-angle skateboard scene and original board/rider placement must remain recognizable.
- Thick rounded black outlines should define the skateboard deck, trucks, wheels, rail, clothing, pads, socks, face, and hair.
- Background should become white or nearly white with minimal horizon/rail lines only.
- Output should feel like a casual marker drawing rather than a polished vector trace.

## Quality Check

Before finalizing, verify:

- The result is monochrome black linework on white or near-white.
- The source composition is still clearly recognizable.
- The subject has not been replaced with a different person, object, pose, or camera angle.
- Details are simplified enough for a coloring page but not so sparse that key objects disappear.

If the image tool adds color or gray shading, retry with stronger wording: "pure black outlines only, no color, no grayscale, no shadows, white background."