---

## name: dreamcore-video-style description: Design original Chinese surreal dreamcore videos with restrained grotesque imagery, ritual calm, weathered traditional architecture, impossible scale, body-machine fusion, dusty mineral colors, slow cinematic movement, and unsettling continuous sound. Use when Codex needs to analyze, outline, prompt, storyboard, generate, or quality-check short films, music videos, art films, ads, or AI video sequences that should evoke Chinese uncanny dream logic without copying a specific creator or source scene.

# Chinese Surreal Dreamcore Video

Create original work from a reusable craft profile. Do not reproduce the reference video's giant-head vehicle, exact character, shot order, title card, or creator marks.

## Workflow

1. Define an original emotional premise in one sentence. Favor quiet longing, identity loss, memory debt, ritual obligation, or transformation over plot exposition.
2. Build a design bible with one protagonist, one impossible object, one recurring shape, one restricted palette, and one material vocabulary.
3. Read `references/style-profile.md` and select at least four visual pillars, three camera rules, and two sound rules.
4. Create a 30–60 second arc with 4–6 clips. Keep each generative clip between 8 and 12 seconds and give it one clear action.
5. Run `scripts/build_prompt_pack.py` to produce a model-ready prompt pack, then refine the pack using `references/prompt-patterns.md`.
6. If the user requests rendering, invoke `$seedance2-video` for each clip. Reuse the same design anchor in every request. Use the last approved frame of one clip as a reference for the next when continuity matters.
7. Assemble the clips under one continuous sound bed. Cut on musical phrases, occlusion, circular match shapes, water, fog, or material transformations.
8. Apply the QA gate before delivery.

## Quick start

```powershell
python scripts/build_prompt_pack.py PROJECT `
  --concept "A conservator returns a forgotten name to a flooded ancestral hall" `
  --protagonist "a middle-aged mural conservator in a faded celadon work coat" `
  --setting "a half-submerged ancestral hall with mineral-painted beams" `
  --impossible-object "a lacquered archive cabinet that breathes like a sleeping animal" `
  --motif "concentric ripples and round bronze mirrors" `
  --climax-action "she closes one mirror and the drowned hall rises as paper architecture"
```

Store all artifacts under:

`D:\AI视频\AI视频参照\codex\dreamcore-video-style\<project>`

## Style invariants

- Keep the world solemn, tactile, and believable before introducing one impossible fact.
- Make the uncanny emerge from scale, calm behavior, and material fusion rather than gore or jump scares.
- Use frontal icon-like compositions, slow pushes, lateral tracks, restrained handheld drift, and detail inserts.
- Favor dusty rose, oxidized cinnabar, tea green, bone beige, ink black, and muted jade-gray. Preserve soft contrast and aged mineral texture.
- Repeat one circular or anatomical motif across architecture, vehicle, landscape, and transition design.
- Let the protagonist act with ritual precision. Avoid screaming, frantic reactions, explanatory dialogue, and conventional monster behavior.
- Use a continuous detuned piano or music-box motif, low room tone, water/wood texture, and sparse impacts. Keep silence and negative space audible.

## QA gate

Reject or revise the sequence if any of these are true:

- It reads as generic cyberpunk, fantasy wuxia, zombie horror, or Western Gothic.
- More than two impossible ideas compete in one shot.
- Colors are neon, glossy, or uniformly red.
- The protagonist, costume, face, or impossible object changes without a motivated transformation.
- The camera is constantly fast, orbiting, or shaking.
- The edit is a random montage without encounter, threshold, passage, and consequence.
- The sound uses trailer booms, nonstop percussion, or obvious jump-scare hits.
- A prompt asks for the exact source artist, exact source scene, watermark, or platform text.

Read `references/style-profile.md` for the full craft analysis and `references/prompt-patterns.md` for prompt construction, continuity, editing, and originality controls.