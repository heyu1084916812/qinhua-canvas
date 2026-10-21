---

## name: fluorescent-rock-color-zhiguai-style description: Use this skill when designing, prompting, storyboarding, generating reference images for, or quality-checking original Chinese literary AI videos that need the 荧光岩彩 × 宣纸皮肤 × 中式童话志怪 visual system. It defines the palette, materials, camera, movement, continuity anchors, negative constraints, and web-render workflow for short vertical films without copying a living director, artist, game, film, or existing character design.

# 荧光岩彩 × 宣纸皮肤 × 中式童话志怪

## Purpose

Create original short-form Chinese literary videos with a stable, recognizable visual grammar. Use the workflow structure of a production bible: research, story premise, identity locks, five reference images, four ten-second shots, transition anchors, audio plan, negative prompt, and QA.

Read `references/style-profile.md` before writing prompts.

## Workflow

1. Choose a public-domain Chinese literary source and identify one emotional contradiction rather than retelling the whole plot.
2. Write a forty-second story with four beats: establish the rule, deepen fascination, reveal a cost, leave a resonant image.
3. Lock one protagonist using age, face shape, hair, garment silhouette, one accessory, and two dominant colors.
4. Lock one recurring object. Keep its material, scale, count, glow color, and screen direction unchanged.
5. Define exactly five reference frames: character, world, object, turning point, finale.
6. Write four independent ten-second prompts. Each prompt must repeat the identity, palette, materials, lens language, and negative constraints.
7. Design each shot as establish → one action → stable exit frame. Do not put two transformations in the same clip.
8. Render by image-to-video when possible. Use the previous clip's last frame as the next clip's first frame.
9. QA identity, material separation, screen direction, temporal causality, and the absence of contemporary objects or random text.

## Non-negotiable style rules

- Style: 荧光岩彩 × 宣纸皮肤 × 中式童话志怪.
- Palette: 孔雀石绿 #2B6A62、靛青 #17263D、朱砂 #A83932、旧金 #B89A59、宣纸白 #D8CEB8。.
- Materials: 粗宣纸、矿物颜料、金箔、木版印痕、墨渍、萤火；人物不是塑料3D。.
- Camera: 50–100mm压缩空间、平面图案构图、慢推与微距；偶尔做横向卷轴移动。.
- Motion: 二维岩彩画面产生轻微层间视差；纸脸飘动似水中水草，节奏克制。.
- Sound: 纸张摩擦、毛笔刮纸、木鱼单击、远处市声倒放、女声轻哼；禁止跳吓音效。.
- Keep uncanny events calm and legible; do not replace concept with gore or jump scares.
- Do not invoke Dreamcore unless a separate project explicitly requests it.
- Do not name a living director or living visual artist in prompts. Translate influence into era, lens, lighting, blocking, texture, and editing traits.
- Do not reproduce a recognizable commercial adaptation. Use original faces, costumes, props, and silhouettes.

## Prompt order

Use this order in every video prompt:

1. format and duration;
2. protagonist identity lock;
3. recurring object lock;
4. location and time;
5. one timed action;
6. palette and material;
7. lens and camera path;
8. exit-frame requirement;
9. negative prompt.

## Quality gate

Reject or retry when any of these occur:

- face, costume, accessory, or object count changes;
- generic neon, generic fantasy CGI, or plastic skin overrides the material system;
- the camera shakes without narrative cause;
- the main event happens before the spatial setup is readable;
- a transition reverses screen direction;
- text, watermark, UI, or a contemporary prop appears;
- the image is traceable to a named commercial adaptation.