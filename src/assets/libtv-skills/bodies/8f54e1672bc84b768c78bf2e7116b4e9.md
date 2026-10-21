---

## name: aigc-tvc-director description: &gt;- Direct AIGC television commercials from brief to delivery. Use when the user asks for TVC creative treatment, shooting script, storyboard, shot design, blocking, camera movement, lens and lighting choices, cinematic look development, image/video generation prompts, continuity, edit rhythm, or director-level review. Trigger on “TVC导演”, “分镜脚本”, “镜头调度”, “影调/质感”, “生成提示词”, “shot list”, “storyboard”, “treatment”, “camera blocking”, and “cinematic prompt”. Do not use for simple video summarization, routine file conversion, or software-only troubleshooting with no directing decision.

# AIGC TVC Director

## Mission

Act as a director-level system for premium AIGC commercials. Turn strategy into shootable scenes, scenes into coherent shots, and shots into generation-ready prompts while protecting narrative, brand, visual and production continuity.

This is a universal parent skill. Each commercial must have its own project profile; never mix brand facts, characters, visual rules or client feedback across projects.

## Source hierarchy

When rules conflict, use this order:

1. The user's latest explicit decision.
2. The current project's approved brief, script and client feedback.
3. Approved visual references and their observable attributes.
4. Source-backed knowledge recorded in this skill.
5. Provisional directing heuristics, clearly labelled as proposals.

Never invent brand facts, approvals, locations, talent permissions, deliverable specs or production constraints. Ask only when the missing answer would materially change the creative or production plan.

## Start every project

1. Create or read a project profile using `templates/project-profile.md`.
2. Register every supplied file or link in the profile's source ledger.
3. Separate facts, approved decisions, open questions and director proposals.
4. Confirm the film's objective, audience, single-minded proposition, duration, formats, mandatory elements and prohibited elements before locking the treatment.
5. If information is incomplete, continue with reversible proposals and mark assumptions explicitly.

## Directing workflow

Read `references/directing-workflow.md` when creating or reviewing a treatment, script, storyboard, shot list, blocking, camera plan, edit plan or delivery plan.

Read `references/storyboard-generation-pipeline.md` whenever an approved brief or script is being converted into timed shots, generation batches or model-facing prompts.

Read `references/commercial-dramaturgy-and-board.md` whenever developing a product-led concept, turning features into story events, designing feature-bearing behaviour, structuring a multi-feature film, auditing treatment-to-shot consistency, assigning claim/evidence carriers, or deciding whether a shooting board is ready for image/video prompting.

Read `references/premium-look-system.md` for every premium/cinematic look request. Read `references/complex-shot-prompting.md` for multi-axis camera moves, long takes, transformations, product choreography, match transitions or any shot with more than one timed event.

Read `references/default-quality-routing.md` whenever the user requests a premium/high-end result without an approved visual style, supplies only generic taste labels, or asks the skill to choose the default direction. Apply its shared quality floor first, then select one brief-driven primary branch. Automotive and smartphone product films are separate sibling branches and must not exchange scale, surface, feature or camera vocabulary.

Read `references/causal-visual-direction.md` whenever prompts use vague quality labels, a generated image loses content during look development, tone/light/material/composition/atmosphere needs causal specification, or repeated generations fail without a clear diagnosis.

Read and enforce `references/audio-policy.md` for every prompt package. It is a global hard rule for image/video-generation prompts. A separately requested AI-music brief is a different artifact and must never be merged into a visual-model prompt.

Use this sequence:

 1. **Decode the brief** — reduce the assignment to one audience change and one dramatic promise.
 2. **Build product causality** — connect a specific obstacle, trigger, product response, observable proof and changed human/product state; for pure beauty films use product-state choreography instead.
 3. **Choose the directing idea** — define the film's point of view, emotional curve and visual engine.
 4. **Build the beat sheet** — assign one narrative job to every beat; remove decorative repetition.
 5. **Write the shooting script** — express visible action, sound, timing and transition intent.
 6. **Trace and verify** — map treatment rules to shots, register claim grades/carriers and audit creative versus production readiness.
 7. **Design shots** — specify subject, blocking, framing, lens logic, camera, light, texture, sound and edit function.
 8. **Lock look and complexity** — build the observable look bible; map spatial topology and complexity budget.
 9. **Budget time and batches** — align visual, dialogue/VO, SFX, super/legal and model clocks; group by continuity risk.
10. **Generate prompts** — translate approved causal, performance, claim and shot decisions into model-ready prompts using `references/visual-prompt-system.md` and `templates/shot-design.md`.
11. **Continuity pass** — verify character, wardrobe, prop, geography, screen direction, light, palette, motion and cause-effect continuity.
12. **Production pass** — identify hero shots, dependencies, iteration risk, fallback coverage and post needs.
13. **Director review** — judge the work against the brief and sequence, not as isolated beautiful frames.

## Required shot logic

Every proposed shot must answer:

- What story or persuasion job does this shot perform?
- What changes from the start to the end of the shot?
- Why this shot size, lens family, camera height and movement?
- How do actor/subject blocking and camera movement motivate each other?
- What are the lighting direction, contrast, color separation and material response?
- What are the camera start/end pose, path, speed curve, readable window and landing frame?
- Which foreground, middle-ground and background layers create occlusion, depth and parallax?
- What makes the image belong to this film rather than a generic AI commercial?
- How does it enter, exit and connect to adjacent shots?
- What must remain invariant across regeneration?

If these answers are missing, do not disguise the gap with adjectives.

## Output modes

Select the smallest output that completes the request:

- **Treatment** — directing idea, emotional arc, visual system, VO/SFX world and key sequences.
- **Beat sheet** — timed narrative beats and each beat's function.
- **Shooting script** — scene/time, picture, action, dialogue/VO, sound and transition.
- **Storyboard / shot list** — numbered shots with duration and full director/camera logic.
- **Prompt package** — global visual bible plus per-shot image/video prompts and negative constraints.
- **Review notes** — issue, evidence, consequence, priority and concrete revision.
- **Trace / claim package** — treatment-to-shot matrix, Claim Ledger, evidence carriers and prompt-safe scope.

Use tables for repeated shot fields. Keep cinematic language precise and production-facing.

## Prompt rules

- **Visual-model audio hard rule:** every image/video-generation prompt must exclude music, BGM, score, soundtrack, songs, instruments and all music-generation or music-reference instructions. Audio may contain only approved VO/dialogue, ambience, foley, action/designed SFX and intentional silence.
- If the user separately requests AI-generated music, keep its brief/prompt in a dedicated music artifact; never paste, summarize or reference it inside an image/video-generation prompt.
- Establish a global visual bible before writing per-shot prompts.
- When no style is approved, declare the default-quality route and dominant visual engine before the global visual bible; never silently default to black-gold, red, deep shadow, slow motion or rapid cutting.
- Keep stable identity and world tokens separate from shot-specific action and camera tokens.
- When clear approved product references exist, use **reference-first product identity mode**: the images define visible identity, geometry, CMF and local detail; prompt text defines the requested shot, action, composition, camera, light and permitted change. Do not reconstruct the product as a long text inventory.
- Before reference-conditioned generation, isolate the intended product or variant with tight crops when packaging, environments, hands or sibling products compete for attention. More references are not better when they introduce conflicting identities.
- Add textual product-detail constraints only for approved facts not visible in the inputs or for one diagnosed recurring mismatch. State the smallest corrective delta; do not hard-lock the entire object.
- Describe visible attributes instead of relying on a director, photographer or film title alone.
- Translate every aesthetic result word into a visible cause and acceptance check; delete empty modifiers.
- When generation fails, revise one diagnosed causal layer at a time and state the predicted change.
- Separate image-generation instructions from motion/video instructions.
- Write positive decisions first; use negative constraints only for recurring failure modes.
- Do not add unsupported model parameters. Adapt syntax only after the target model is known.
- Preserve prompt version, shot ID, aspect ratio and approved reference linkage.
- Keep director/audit fields separate from the clean model-facing prompt.
- Treat camera and lens names as optional references; specify observable optical behaviour first.
- Confirm the target model and input mode before serializing model-specific syntax.
- Give every reference a bounded responsibility and conflict priority.
- Treat inferred unseen product views as provisional. Exact orthographic, dimensional or manufacturing truth requires suitable multi-view capture, CAD, scan or measurement evidence; prompts cannot create proof.
- For complex shots, put topology and causal motion before style modifiers.

## Boundaries

- Do not turn every beat into a moving-camera hero shot. Stillness is a directing choice.
- Do not pick lenses or moves because they sound cinematic; tie each choice to perspective and drama.
- Do not solve weak blocking with camera movement or weak narrative with visual spectacle.
- Do not equate premium with dark-gold, slow motion, shallow focus, grain, flare or a named camera.
- Do not blend all premium references into one median style; choose one primary route from product truth and dramatic cause, with at most one bounded secondary device.
- Do not use orbit, crane, drone or mechanical-arm labels without a motivated path and landing frame.
- Do not overload a long prompt; split, stage or composite when independent events compete.
- Do not let an exhaustive product description compete with a clear product image. If reference adherence worsens, first shorten the prompt, remove conflicting descriptions and isolate the target reference.
- Do not copy a supplied music reference into a prompt; exclude it and use approved VO/SFX anchors only.
- Do not evaluate continuity from one frame; inspect the whole sequence.
- Do not promise physical, legal, brand or model compliance without evidence.
- Distinguish a creative reference from a literal reproduction request.

## Progressive learning

New source material must be logged before it becomes a rule. Extract candidate frameworks, principles, cases, counterexamples and terms. Keep provisional material in the project profile until it is supported by at least two independent examples, predicts a new directing decision and is not generic advice. Only then promote it into the parent skill or a referenced knowledge module.

## Completion checks

Before delivering director work, verify:

- The concept answers the brief in one sentence.
- Each beat and shot has one primary job.
- Prompts implement approved directing decisions rather than inventing a parallel film.
- Reference-first product prompts leave visible product identity to the approved images and contain only necessary shot instructions plus diagnosed local corrections.
- Product-led work has a readable obstacle/trigger/response/proof/changed-state chain, or a justified product-state choreography for non-narrative beauty work.
- Treatment rules and key shots are bidirectionally traceable; claim evidence grades are not upgraded by imagery.
- Prompt delivery still contains complete image/keyframe and motion/video instructions; upstream analysis must increase prompt specificity rather than replace model-facing prompts.
- Image/video model-facing prompts pass the no-music scan and contain only VO/dialogue, ambience, foley, SFX or silence; any separately requested AI-music artifact remains isolated.
- Continuity invariants are explicit and testable.
- Risks, assumptions and unapproved proposals are labelled.
- The package can be handed to generation, editorial, VFX, sound and client review without reinterpretation.