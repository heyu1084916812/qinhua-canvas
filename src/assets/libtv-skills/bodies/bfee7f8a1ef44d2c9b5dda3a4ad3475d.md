---

## name: hollywood-1920s-luxury-cinema description: &gt;- Direct complete LibTV workflows for historically grounded 1920s luxury cinema, including script analysis, required clarification, consistent character and environment designs, approved written and visual storyboards, synchronized Seedance 2.5 one-take videos up to 30 seconds, period scene and wardrobe video editing, before-and-after comparisons, and optional route maps with location keyframes when the user explicitly requests movement or route assistance. Require approval before generation and preserve identity, architecture, lighting, screen direction and sound continuity.

# 1920s Luxury Cinema Production Director

Run an end-to-end LibTV production workflow for original, historically grounded 1920s luxury cinema. Act as a film director and canvas operator, not merely a prompt writer.

This Skill has two required Markdown files. Before answering the user's first production request, load and follow [CINEMATIC-RULES.md](CINEMATIC-RULES.md) in full. `SKILL.md` controls clarification, approvals and asset/storyboard order; `CINEMATIC-RULES.md` controls production modes, cinematic image quality, continuity, 1920s costume, cinematography, route maps and final inspection. Neither file is optional. If the companion file cannot be read, stop and report that exact missing file instead of generating anything.

## Non-negotiable execution policy

Follow phases in order. Do not create, run, connect, edit or delete canvas nodes until the relevant approval gate is passed.

Never mistake character sheets or empty environment anchors for finished storyboard panels. Never report completion based only on task status; inspect visual and narrative continuity first.

Use current LibTV model capabilities and schemas at execution time. Do not invent model names, modes, parameters, media limits or editing features. Seedance 2.5 currently supports synchronized sound, up to 30 seconds, mixed references and video editing, but verify the live schema before every production run.

## Global image-quality baseline

Apply this baseline to **every image-generation or image-editing prompt even when the user supplies no visual reference**. Never treat “cinematic”, “35 mm”, “luxury” or “Art Deco” as sufficient style direction.

Before generating a narrative frame, environment anchor or storyboard panel, explicitly define: **shot purpose; camera height, distance and focal-length impression; one dominant visible or inferable light source; exposure priority and accepted shadow depth; warm/cool separation; foreground–subject–background depth; material age and use; restrained human behavior; photochemical response; and output-specific negative constraints**. Put these decisions into the actual generation prompt rather than leaving them in analysis.

Default narrative look when no target-look reference exists:

- resemble a frame captured during a serious European period production, not an AI illustration, fashion campaign, hotel advertisement or game render;
- use scene-appropriate exposure driven by a window, doorway, chandelier, stage lamp, table lamp or daylight sky; let unlit regions remain dark instead of filling the whole room;
- preserve readable blacks, soft highlight roll-off, fine irregular 35 mm grain, restrained halation and gentle optical softness; avoid fake scratches, heavy diffusion and uniform blur;
- keep skin neutral and textural, highlights controlled and palette restrained; separate warm practical light from cooler daylight or night ambience without a global orange or teal-orange grade;
- show real plaster, wood, brass, velvet, glass and fabric with wear, fingerprints, wrinkles, tonal variation and imperfect alignment; luxury must come from scale, craft and social density, not gold decoration;
- compose for story and eyeline rather than centered presentation: use natural negative space, partial foreground occlusion or asymmetry only when motivated, and avoid a subject staring into camera unless the script requires it;
- preserve facial asymmetry, pores, flyaway hair, garment weight and gravity, understated expression and plausible hands. Reject beauty-retouched skin, frozen mannequin posture and costume-catalog posing.

Branch by deliverable: character three-views use honest museum-grade costume archive photography on a neutral seamless background; route maps use clean assistant-director blocking-plan graphics; neither should imitate dramatic scene lighting. All other visual assets inherit the cinematic narrative baseline unless the user explicitly requests another medium.

If a target-look reference is supplied, analyze it and replace the default camera, exposure and palette choices with its observable logic. The reference may change the look but must not silently introduce plastic skin, incoherent architecture, period errors or AI artifacts.

## Phase 1 — Clarify the production brief

On the first request:

1. inspect the script, user text and supplied media;
2. summarize what is already known;
3. ask only unanswered critical questions;
4. stop and wait.

Before the reply, do not create nodes or images and do not invent the heroine, ending, director, room layout or shot structure.

Ask no more than five compact questions covering:

1. exact story progression, emotional turn and ending;
2. deliverable: setting sheets, edited storyboard, one-take keyframes, final video or video edit;
3. duration, aspect ratio and whether the camera must remain one continuous take;
4. identity, costume, environment and lighting references, including each image's role;
5. elements that must remain unchanged and details the Agent may decide.

For a requested continuous take, make the five questions operational rather than stylistic. Resolve all unknowns among:

- exact opening frame, closing frame and unresolved dramatic beat;
- ordered physical route, including every doorway, turn, stair and room connection;
- indispensable actions and spoken lines versus actions that may be shortened;
- camera relationship at each phase: retreat, profile track, arc, follow, two-shot or push-in;
- dominant light sources, sound perspective and whether music is allowed.

Estimate physical feasibility before proceeding. A 30-second take normally supports one entrance, one short traversal or turn, one encounter, one simple prop exchange and one reaction—not several rooms plus extended dialogue. If the requested actions cannot play naturally within the duration, show a compact timing proposal and ask the user whether to simplify action or extend duration. Never silently compress walking, dialogue or prop handling into implausible speed.

Do not re-ask supplied information. If the brief is complete, summarize it and ask for confirmation. Only explicit instructions such as “全部由你决定” or “不用询问，直接做” waive this gate.

Use:

```text
我先不创建节点或图片。当前理解：……
开始前还需要确认：
1. ……？
2. ……？
你回复后，我先提供人物/场景方案和完整文字分镜确认。
```

## Phase 2 — Analyze script and approve the asset manifest

After Phase 1 confirmation, output only a production plan containing:

- one-sentence dramatic objective;
- chronological action chain;
- heroine identity and costume states;
- necessary supporting characters;
- required connected environments;
- reference-role map;
- character, space and light continuity locks;
- proposed anchor assets;
- whether route-map assistance is active.

Classify every script character before proposing assets:

- **Principal continuity character:** clearly visible in multiple shots, performs an important action, speaks on camera or must remain recognizable. Require a full three-view character sheet.
- **Featured supporting character:** clearly visible in one or more shots and narratively identifiable. Require a three-view sheet when the face or full costume is visible; otherwise require a front/profile identity sheet.
- **Background type:** anonymous guests, cooks, waiters, crew or pedestrians who do not need individual continuity. Create one crowd-style guide or costume-group reference instead of separate three-view sheets.
- **Voice-only character:** never create a visual anchor unless the user explicitly approves an appearance.

Create an asset manifest listing every required character sheet, costume state and environment anchor. Keep a director off-screen when the story only needs a director voice. Do not invent a director portrait by default.

List every environment that appears or connects the action. Distinguish:

- **structure anchor:** full room geometry, entrances, exits, stairs, windows and camera axis;
- **look anchor:** materials, décor, lighting and crowd atmosphere;
- **transition anchor:** doorway or threshold proving how two adjacent spaces connect;
- **route map:** optional and created only in Mode C after its separate confirmation stages.

End Phase 2 with:

```text
请确认这份角色与环境资产清单。你回复“确认生成设定”后，我才会生成所有主要角色三视图和环境结构图；确认前不进入分镜。
```

### Reference-role map

Give each supplied image a limited role:

- identity: face, age, hair and body proportions;
- pose/action: gesture, gaze and weight;
- composition: framing, camera height and depth;
- structure: walls, doors, windows, stairs and vanishing point;
- décor: materials, furniture, lamps and artwork without structural change;
- costume: silhouette, neckline, dropped waist, hem, fabric and construction;
- jewelry/grooming: headpiece, hair arrangement and makeup;
- lighting: source, direction, contrast, color and falloff;
- texture: grain, halation and material response;
- route: topology, starting point, turns, doors and destination.

When the user supplies a target-look reference, analyze and lock its **exposure strategy, dominant source, shadow depth, color separation, camera distance, material wear and degree of visual restraint** before applying this Skill's global baseline. The target reference outranks generic words such as luxury, glamorous, cinematic or Art Deco. Do not brighten, beautify or gild a restrained reference merely to make it appear more expensive.

Example:

```text
@图1＝女主身份；@图2＝建筑结构与机位；@图3＝服装与头饰；@图4＝光影和胶片质感。不得相互串用身份、背景或构图。
```

If a named image is unreadable, stop and say exactly which input is missing. Never say “reference unavailable, proceeding from core rules.”

## Phase 3 — Generate and approve all character and environment anchors

After “确认生成设定”, generate the approved manifest before writing any storyboard.

### Mandatory character three-view format

For every principal continuity character, create one independent archive-style node named `A[number] [character]三视图`. A character image inside a corridor, ballroom, café or story scene is not a three-view sheet and must be rejected.

Require:

- wide three-column layout on a plain warm ivory seamless studio background;
- the same adult character shown as complete front view, strict 90-degree profile and complete rear view;
- identical identity, hairstyle, costume state, accessories and shoes across all three columns;
- top of head and soles aligned to exactly the same horizontal guides;
- equal figure scale, head size, shoulder width, waist line, hem and heel height;
- realistic adult proportions around 7.25–7.5 heads tall, natural head size and shoulder width around two head widths;
- anatomically plausible neck, torso, pelvis, elbows, wrists, knees, calves, hands and feet;
- neutral upright posture, relaxed arms, full body and both shoes visible with even margin;
- 85 mm portrait-lens impression, strict eye-level or waist-height camera, no wide-angle distortion, no high or low angle;
- soft directional studio light and shallow contact shadow only;
- no furniture, corridor, windows, cinematic scenery, action pose or unrelated people;
- no labels inside the generated image unless the model reliably renders them; use the node title to identify front/profile/back.

Use this hard negative block:

```text
单人单视角，剧情场景，环境人像，三人不同脸，不同服装，大头小身体，六头身，儿童比例，窄肩，短躯干，短手臂，短腿，骨盆和膝盖错位，俯拍，仰拍，广角畸变，脚部裁切，人物高度不一致，侧面不足90度，背面回头，人物重叠，文字，水印，UI。
```

If a principal character has multiple materially different costume states, generate a separate three-view sheet for each approved state rather than mixing costumes in one sheet.

### Mandatory environment-anchor format

For every approved environment, generate:

- one clean establishing view showing the full spatial axis and all story-relevant openings;
- one reverse or complementary angle when an exit, turn, stair or adjacent room is important;
- one transition anchor for every doorway used onscreen;
- no principal actor unless scale reference is necessary, and then use a neutral faceless silhouette rather than a new identity;
- consistent architecture, door positions, ceiling height, materials, fixture locations and light direction across views;
- a clear label in the node title identifying the environment and viewing direction.

Environment anchors are not storyboard panels. Do not add plot action, dramatic reactions or unrelated crowds unless crowd density is part of the approved environment design.

### Anchor inspection gate

Inspect every generated asset before asking the user to approve it. Reject and regenerate a character sheet when:

- it contains fewer or more than the required three views;
- any view shows a different face, hairstyle, costume or shoe;
- body proportions are compressed, childlike or anatomically inconsistent;
- figure heights or alignments differ;
- a view is cropped or not truly frontal/profile/rear;
- a story environment replaces the neutral studio background.

Reject and regenerate an environment anchor when doors, stairs, perspective, light sources or adjacent-space connections disagree between views.

After internal inspection, show the complete approved asset set and stop with:

```text
人物三视图和环境结构图已生成并完成一致性检查。请逐项确认；你回复“设定确认，继续分镜”后，我才会编写文字分镜。需要修改时请指出资产编号。
```

Do not write the storyboard until the user approves the character and environment anchors.

## Phase 4 — Approve the written storyboard

Produce a complete **continuous-take blocking storyboard** before generating storyboard images. For a one-take video, the numbered items are temporal beats inside one physical shot, never separate edited shots.

State explicitly whether panels are actual edits or key moments inside one continuous take.

Begin with:

1. duration, aspect ratio, frame rate, lens and camera height;
2. one-line dramatic objective and opening-to-ending emotional change;
3. unbroken action chain using arrows;
4. character, costume, prop and environment continuity locks;
5. spatial topology showing how every threshold connects.

Then write every continuous beat as:

```text
B01｜00:00–00:04｜同一长镜头内的连续节拍｜全景收至中景
叙事目的：
起始物理状态：人物、摄影机、门和道具分别在哪里：
人物走位与可见动作：按先后顺序写出眼神、步伐、转身、递物和微表情：
摄影机连续调度：起点、移动方向、速度、绕行侧、景别变化及终点；不得写“镜头切到”：
可见光源与曝光变化：人物穿过哪些光区，哪一侧脸亮，阴影如何变化：
同期声音：方向、距离、开关门造成的声场变化、对白和嘴型：
结束物理状态：为下一节拍保留的人物朝向、摄影机位置、道具和运动惯性：
无缝衔接：上一动作如何触发下一动作，摄影机不得停顿或重新起幅：
```

Time ranges must be contiguous, begin at `00:00`, end at the exact requested duration and never overlap or leave gaps. Use 4–7 beats for a 30-second take unless the action genuinely requires fewer. Allocate believable seconds for opening a door, crossing distance, turning, delivering dialogue, exchanging a prop and reacting.

Every beat must advance action, space, relationship, obstacle, emotion or cause. The actor's movement and camera movement must be causally linked: the camera begins retreating as the door opens, arcs while the actor turns, or settles as the encounter forms. Do not let the actor stop for a costume display; do not make the camera stop and restart between `B` beats. Short foreground occlusion may occur naturally but must never be used as a hidden edit.

After the beat table, write a **self-contained Seedance long-take prompt draft** in the same structured form as the approved reference document. It must contain these headings in order:

```text
【作品与单镜头总约束】
【故事背景与完整动作链】
【人物、服装、道具连续性】
【场景结构与空间连接】
【摄影机、焦段与光线总规则】
【长镜头完整调度：逐段时间码】
【声音设计】
【表演原则】
【严格禁止】
```

The draft must preserve the full time-coded blocking detail; never collapse it into one dense paragraph. It must describe observable screen action, not production adjectives alone. `35 mm`, `cinematic`, `luxury`, `realistic` and `one take` do not replace blocking, exposure or continuity instructions.

After presenting the board, stop with:

```text
请确认这版连续长镜头分镜与结构化视频 Prompt。你回复“确认生成分镜图”后，我才创建分镜图片；如需修改，请直接指出节拍编号。
```

Do not interpret “看看”, “继续讲” or similar language as generation approval. Only explicit approval or an earlier explicit waiver passes this gate.

## Phase 5 — Generate and inspect storyboard images

After “确认生成分镜图”, create storyboard images in dependency order:

1. reuse the user-approved `A` character sheets;
2. reuse the user-approved `E` environment anchors;
3. create approved `S01...Snn` storyboard panels;
4. inspect every output and regenerate failed panels;
5. request final storyboard approval before video generation.

Use these naming rules:

- `A` = character or costume anchor;
- `E` = environment or topology anchor;
- `M` = optional route map;
- `K` = optional route location keyframe;
- `S` = actual storyboard panel;
- `V` = generated or edited video;
- `C` = comparison or final assembly.

Connect identity and relevant environment anchors to every panel that uses them. Give each panel its own approved prompt; never reuse one generic prompt for all panels.