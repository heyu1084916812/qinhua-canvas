---

## name: weisenandesen description: "Convert short Chinese scene ideas, characters, settings, or story fragments into complete image-generation prompts with retro cinematic aesthetics: structured symmetry, varied camera angles, playful staging, bright non-gray vintage 1960s-1970s color, theatrical handmade sets, restrained deadpan characters, fairy-tale/book/theater mood. Use when the user asks for film-still-like prompts, composed retro scenes, interesting camera choices, or wants to avoid stiff front-facing portraits, poster, illustration, ad, influencer photo, cyberpunk, horror, messy, cartoon, plastic AI looks, or visible center seams crossing faces."

# Weisenandesen

## Overview

Transform brief user ideas into Chinese image prompts that look like quiet retro film stills: strongly symmetrical by default, staged, tactile, carefully arranged, emotionally restrained, and visually playful. Do not invoke a named director as a style shortcut; express the look through concrete visual rules.

## Required References

Before producing prompts, read these files as needed:

- `style_rules.md`: visual grammar extracted from the reference images.
- `prompt_formula.md`: construction formula and output contract.
- `negative_prompts.md`: reusable reverse constraints.
- `checklist.md`: final quality gate before answering.
- `examples.md`: sample expansions for common short ideas.

## Workflow

1. Identify the user's core subject: person, animal, object, location, action, and emotional situation.
2. Choose one camera/composition mode from `style_rules.md`. Default to strict frontal symmetry with a level camera, horizontal horizon, and no tilted perspective, especially for architecture, rooms, counters, vehicles, stations, facades, empty scenes, and single-subject tableaux. Use side-on tableau, overhead stage view, through-window framing, corridor depth, close-up still life with person partly visible, low/waist-level view, or two-plane foreground/background staging only when they still preserve a clear horizontal/vertical order.
3. Build the scene with an implied order: repeated architectural or prop elements, color blocks, frames-within-frames, rows, shelves, tables, windows, stairs, or gift/box/object arrangements. Never create a visible vertical seam, pole, tile line, wire, sign support, or architectural joint that splits a face or body.
4. Expand the scene with tactile period detail: painted walls, practical lamps, numbered signs, luggage, clocks, doors, windows, trays, folded cloth, old machines, shelves, tickets, flowers, boxes, or handwritten labels.
5. Assign a restrained emotional beat plus a small action: reaching, pausing mid-step, looking sideways, sitting on the floor, peeking through a doorway, holding one object, turning away, crouching, leaning, sorting, waiting, or listening.
6. Build a bright retro palette from `style_rules.md`, keeping colors clean, warm, luminous, slightly vintage, and filmic. Avoid muddy gray haze.
7. Add reverse constraints from `negative_prompts.md`.
8. Check against `checklist.md`.

## Output Format

Always answer in this exact structure:

```markdown
画面标题：
构图：
完整提示词：
色彩方案：
人物与动作：
场景与道具：
氛围：
反向限制：
适合比例：
```

## Core Rules

- Write in Chinese unless the user asks otherwise.
- Make the prompt directly usable for image generation.
- Make the result look like a film still, not a poster, illustration, ad, influencer portrait, or concept art.
- Use concrete visual language: lens angle, staging, color, props, surfaces, light, expression, and spacing.
- Preserve the user's subject; enrich the scene without replacing it.
- Avoid copying identifiable characters, plots, costumes, logos, signs, or proprietary elements from references.
- Do not include named-director shorthand in the final prompt.

## Fast Defaults

If the user gives only a short idea, use these defaults:

- Camera: 默认使用正面平视、相机水平、地平线水平的静止电影镜头，尤其适合建筑正立面、房间、柜台、车站、空镜和单人舞台式画面。需要变化时，可使用侧面平视、隔窗/隔门框、长廊纵深、低机位腰平或轻微俯视，但仍必须保持画面不歪、不斜拍、不荷兰角.
- Composition: 默认强中央对称或严格正面对称；也可以是柔性对称、左右重复、框中框、成排道具、走廊纵深或前景/背景两层调度，但必须有清晰水平线、垂直线和左右平衡。中轴由布景暗示而不是画成实体线，不允许竖线穿过脸、头部或身体.
- Set: 手工搭建的电影布景, 可见几何墙面、门框、窗框、台阶、柜台、长廊或舞台纵深.
- Color: 1960s-1970s 复古胶片色, 明亮干净、暖调补光、不发灰, 粉、薄荷绿、湖蓝、芥末黄、奶油白、砖红、暖棕、橙金任选 2-4 色.
- Performance: 表情克制, 安静, 微妙冷幽默, 但动作要有情境：翻看、递出、偷看、坐下、转身、蹲下、停在半步、拿着一个不合时宜的小道具，不要总是正面站立.
- Ratio: 默认 `3:2` 或 `4:3`; 长廊、车厢、柜台可用 `16:9`; 单人、门框、建筑正立面和空镜可用 `2:3` 或 `9:16`.