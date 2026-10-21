---

## name: premium-product-film-prompter description: Generate original premium product-film concepts, rare-angle and giant-scale openings, restrained technology-launch copy, timed storyboards, AE text-animation specs, feature-chip pages, two-tier comparisons, lineup ending boards, video-generation prompts, still keyframes, and 4x4 storyboard grids. Use for requests mentioning iPhone风格、苹果风、Apple风、发布会文案、重新定义、再一次、岂止于、不止于、唯一的是、Pro式型号落版、AE文案出现、参数标签页、普通版/高阶版对比、全系产品综合图、产品矩阵结尾、极简科技文案、纯黑/纯白背景、稀缺性视角、巨物感、极低仰拍、微距探针、慢速揭幕、扫光、轮廓光、产品TVC、主图视频、分镜提示词、16宫格分镜图, or when a product needs original high-end launch-film language without copying Apple trademarks, slogans, model names, packaging, typefaces, or a specific campaign.

# Premium Product Film Prompter

Turn a product brief into an original, production-ready premium studio film. Treat “iPhone/Apple style” as shorthand for restrained product-first cinematography, not as permission to copy brand assets or a specific advertisement.

## Route the request

Choose the smallest deliverable that satisfies the user:

- **Quick prompt**: one concept, one final generation prompt, one negative prompt.
- **Storyboard**: concept statement, duration allocation, shot table, copy, sound, transitions.
- **Full production pack**: storyboard plus per-shot image prompts, per-shot video prompts, continuity lock, sound map, QC report.
- **4x4 grid**: 16 numbered keyframes. Use a single contact-sheet prompt for speed; generate 16 separate frames and composite them for higher consistency.
- **Knowledge-base update**: abstract a successful case into reusable rules; do not store client secrets or copy a campaign verbatim.

If the user explicitly wants approval between stages, stop after the storyboard. Otherwise complete all requested stages in one response and state reasonable assumptions.

## Load only the needed references

- Read references/visual-language.md for visual grammar, motion hierarchy, framing, and rhythm.
- Read references/rare-opening-copy.md for the mandatory rare-view opening gate, giant-scale construction, and original concise copy formulas.
- Read references/launch-copy-cadence.md whenever the user asks for iPhone感、苹果式停顿、发布会文案、重新定义、再一次、岂止于、唯一的是、Pro式型号落版, or copy that should feel recognizably like a restrained technology launch. Apply the cadence while keeping wording, product tiers, typography, and brand identity original.
- Read references/ae-launch-pages-and-endings.md whenever the user asks for AE文案动画、黑底宣言页、参数标签页、普通版/高阶版对比、型号落版、全系产品综合图、购买矩阵、结尾卡 or a reference resembling a technology product webpage/launch-film ending. Use its page archetypes, frame-accurate motion recipes, and originality-distance gate.
- Read references/shot-library.md when selecting openings, pure-background setups, reveals, or transitions.
- Read references/material-lighting.md when the product material or color must read accurately.
- Read references/duration-system.md for custom total duration, segment count, or information-density allocation.
- Read references/prompt-recipes.md for still-image, video, contact-sheet, continuity, negative-prompt, and text-overlay syntax.
- Read references/product-patterns.md for category-specific ideas and cases.
- Read references/case-library.md when looking for proven pattern combinations rather than individual shots.
- Read references/knowledge-update.md before storing a new case, failure pattern, or reusable prompt rule.
- Read references/quality-control.md before final delivery or when diagnosing weak generations.
- Read references/sources.md only when explaining provenance, brand/IP boundaries, or updating the research base.

## Workflow

### 1. Normalize the brief

Extract or infer:

- product name and category;
- primary audience and use situation;
- one promise, three proof points, and one closing action;
- exact geometry, color, material, finish, labels, ports, moving parts, and accessories;
- required aspect ratio, platform, total duration, segment count, language, and generation model;
- product reference images, logo assets, forbidden claims, and mandatory copy.

Never invent factual specifications, certifications, ingredients, prices, or performance claims. Mark missing creative details as assumptions. If a reference image exists, make product identity preservation the highest constraint.

### 2. Create an identity lock

Write a compact paragraph repeated in every generation prompt:

`[exact product class], [silhouette and proportions], [material/finish], [color], [distinctive components and their positions], [label/logo treatment], unchanged geometry, unchanged component count, consistent scale and orientation family.`

Also write an exclusion lock: no extra buttons, ports, lenses, seams, text, limbs, accessories, duplicated parts, or brand substitution.

### 3. Design the mandatory rare-view opening

Never open with a conventional eye-level front view, ordinary 45-degree hero shot, lifestyle wide shot, or complete catalog view unless the user explicitly requests it. Default to a giant-scale, extreme-low-angle view that treats the product as architecture. Use another scarce viewpoint only when it reveals the product more truthfully.

Follow `references/rare-opening-copy.md`. State:

- the chosen rare-view ID and why the view is scarce;
- at least three scale cues that make the product feel monumental;
- the recognition bridge that makes the product identifiable by about 2–3 seconds;
- one selected opening line and 3–5 original alternatives tied to visible evidence.

If the opening does not pass the hard gate in `references/quality-control.md`, redesign it before continuing.

### 4. Choose one creative spine

Select one dominant idea and keep it through the film:

- **Monolith** — product as architecture; best for phones, power banks, appliances.
- **Precision instrument** — macro construction and functional movement; best for earbuds, watches, tools.
- **Material transformation** — light reveals texture and color; best for cases, fabric, cosmetics.
- **Orbit and alignment** — components assemble or pair; best for modular products and accessories.
- **Everyday object, impossible scale** — controlled surrealism; best for lifestyle and pet products.

Do not mix more than two spines in a film under 30 seconds.

### 5. Allocate duration

Use `scripts/plan_timeline.py` for totals or segment counts that are not obvious. Allocate time by information density, then assign each segment a reveal → articulation → signature cadence. “Slow → fast → slow” is a default, not a prison: preserve clarity before tempo.

### 6. Design shots

For every shot, specify:

 1. timecode and duration;
 2. information purpose;
 3. frame size, camera height, angle, lens character, and focus behavior;
 4. camera movement;
 5. product/component movement;
 6. lighting movement;
 7. background, palette, and material response;
 8. copy entrance and safe area;
 9. sound event;
10. transition in/out and continuity anchor.

Apply the three-motion rule as a hierarchy: one dominant motion, one supporting motion, and at most one micro-motion. Do not give camera, object, and light equal amplitude; that produces visual noise.

### 7. Write generation prompts

Write one prompt per shot. Put visible facts before mood words. Separate static keyframe prompts from temporal video prompts. Include exact start state, action path, end state, duration, and continuity. Keep on-screen text as a post-production instruction unless the image/video model reliably renders the target language.

When launch-style copy is requested, build a copy ladder before writing prompts:

1. opening verdict — 2–8 Chinese characters;
2. visual proof — one short evidence line;
3. experience turn — one restrained benefit line;
4. naming lockup — the user’s own product/model architecture;
5. closing memory — one original line, not a borrowed campaign slogan.

Generate at least three cadence families from `references/launch-copy-cadence.md`, then select one coherent family. Do not combine every recognizable construction in one film; that reads as parody.

When the deliverable contains interface-like feature labels, comparison cards, or a lineup ending, specify them as AE/post-production layers rather than asking the image model to render Chinese text. Build one of the original page systems in `references/ae-launch-pages-and-endings.md`; do not trace the reference layout.

### 8. Design AE title pages and endings when requested

Create a page sequence before individual animation settings:

1. chapter/verdict page;
2. feature evidence page;
3. optional two-tier comparison page;
4. closing family or lineup board.

For every page, output composition, safe area, layer stack, entrance/hold/exit time, property keyframes, easing, copy, sound cue, and transition anchor. Use 25 fps by default for Chinese production unless the user specifies otherwise; also report seconds so the recipe can be converted to another frame rate.

If the user asks for a figure-3-style comprehensive board, default to an original `1+3` asymmetric matrix: one lead model occupying about 42–48% width plus three secondary cards. Change at least three recognizable brand codes—grid, palette, typeface, CTA language, tier names, animation order, or card geometry—from the supplied reference.

### 9. Generate the 4x4 storyboard when requested

First create a 16-frame keyframe plan with frame numbers, timecodes, and continuity anchors. Then:

- for fast ideation, ask the available image-generation tool for a clean 4x4 contact sheet with equal cells, consistent product, and no embedded prose;
- for production quality, generate 16 separate 16:9 or 9:16 frames using the same reference image/identity lock, then composite in reading order;
- if a tool specifically named “IMAGE2.0” is unavailable, use the current image-generation tool and disclose the substitution.

Reserve F01–F04 for the rare-view ladder: impossible clue → giant-scale evidence → recognizable feature → partial silhouette. Do not spend the first row on four ordinary hero angles.

When image generation is performed, follow the active image-generation skill/tool instructions. Never promise exact seed locking when the tool does not expose it.

### 10. Review and deliver

Run the checklist in `references/quality-control.md`. Deliver:

 1. assumptions;
 2. rare-opening proof and scale cues;
 3. concept and visual rules;
 4. selected opening line plus 3–5 original alternatives;
 5. one coherent copy ladder plus cadence/originality check;
 6. duration summary and storyboard table;
 7. per-shot prompts and master negative prompt;
 8. matching-edit, sound, and copy maps;
 9. AE page/ending specification, if requested;
10. 4x4 grid plan or generated grid, if requested;
11. mandatory-gate result, QC score, originality-distance result, and production caveats.

### 11. Update the knowledge base only with evidence

When the user asks to save or learn from a result, follow `references/knowledge-update.md`. Store the reusable pattern, conditions, and observed outcome—not client secrets, unsupported claims, or a verbatim campaign. Keep failed attempts when they teach a specific repair.

## Output contract

Use concise Chinese unless the user requests another language. Preserve model-ready prompts in whichever language best serves the target model; provide a Chinese explanation when useful.

Start full outputs with:

```markdown
# [产品名] · 高级产品电影（总时长 [X]s｜[比例]）

**创意母题：**
**产品身份锁：**
**稀缺性开场：** [视角ID＋为什么稀缺＋三项巨物尺度线索]
**首屏文案：** [选用文案＋备选文案]
**发布文案节奏：** [判词→证据→体验→型号/产品名→记忆句]
**统一场景与色彩：**
**画质与镜头基线：**
**节奏曲线：**
```

Use a storyboard table with columns: `时间码｜信息任务｜画面/构图｜镜头运动｜主体运动｜灯光运动｜文案｜声音｜转场`.

For every opening prompt, specify camera height, product crop/occupancy, lens character, parallax, scale cues, light-travel distance, recognition endpoint, and the exact post-produced copy. Generate original copy; never imitate a known Apple campaign line.

Do not use `Pro / Pro Max` as decorative borrowed tiers. Use them only when they are the user’s actual authorized model names; otherwise create an original, truthful model hierarchy.

Never describe the result as official, authorized, endorsed, or “exactly Apple.” Prefer “高级极简产品电影”“产品发布片语法” or “Apple-inspired visual restraint” in external-facing copy.