---

## name: pv-director description: Direct game, film, animation, and IP promotional videos from an idea, script, assets, or reference images into a concise, high-hook PV package. Use for trailer/PV story development, scene structure, directing, storyboard scripts, timed animatics, action staging, video-generation planning, or PV sound design—especially when the work must be visually legible, generation-ready, and editable.

# PV Director

Turn a project premise into an emotionally escalating, production-ready promotional video. Prioritize memorable visual hooks, clear cause-and-effect, readable action, and a strong final image over exhaustive world exposition.

## 1. Lock the brief before writing

Extract and label these fields. Treat user-provided facts and assets as `LOCKED`; do not silently overwrite them.

- Format: game PV, character PV, cinematic trailer, launch trailer, short-form promo, or teaser.
- Duration, aspect ratio, frame rate, platform, dialogue/subtitle/music constraints.
- World premise, protagonist, antagonist, central threat, audience promise.
- Reference assets: character appearance, weapons, props, locations, lighting, color, and camera language.
- Must-show moments, forbidden elements, and prior continuity decisions.

If a missing decision materially changes the script, ask one concise question. Otherwise mark it `PROVISIONAL` and proceed.

## 2. Build a PV, not a plot summary

Use a compressed emotional curve:

```text
Hook → threat/context → protagonist action → escalation → reversal or scale reveal → final hook
```

For a 60–90 second PV, aim for 4–7 scenes. Each scene must change one of: information, danger, power, location, or emotional state. Start with a visual event in the first 3 seconds; establish the central promise by 10 seconds; reserve the most iconic image, action, or reveal for the final third.

Do not explain every rule of the world. Let an action, object, environment change, or reaction carry the information.

## 3. Write scenes as visible cause and effect

For every scene, define:

```text
Start state → trigger → character choice → resistance → outcome → handoff
```

For silent PVs, replace exposition with visible evidence. A character must make a readable choice, even if the choice is only to leave, aim, protect, retrieve, or confront.

Use off-screen action only when it increases mystery or pace. If an event is intentionally hidden, show its consequence clearly enough for the next scene to make sense.

## 4. Direct performance and space

Write concrete, filmable behavior—not labels such as “epic,” “cool,” or “intense.” Specify:

- Where each character starts, faces, moves, and exits.
- What must be visible (`P1`), useful but secondary (`P2`), or optional texture (`P3`).
- The fixed geometry that anchors continuity: doors, lanes, walls, elevations, cover, light sources, and weapon stations.
- Screen direction and combat axis before staging action.

Keep one dominant action per beat. Give decisive reactions enough time to read. Never make a character perform a task that their clothing, props, confinement, injury, or established ability does not support.

## 5. Design shots separately from generation clips

`Shot` is a final editorial cut. `Generation Clip` is one continuous piece of generated footage.

For each shot, provide:

FieldIncludeID and durationEditing duration; normally keep readable shots at 1 second or longer unless an intentional flash cut.Story functionWhat the viewer learns or feels.Framing and movementLens/angle/height plus one primary camera move.ActionOne clear primary action and its result.ContinuityEntry state, exit state, screen direction, prop/weapon hand, lighting state.SoundEssential environment, Foley, weapon, creature, or transition sound.CutHard cut, action cut, sound bridge, or motivated wipe/occlusion only when needed.

Split a Generation Clip whenever it asks for multiple camera angles, multiple complex actions, a major VFX change plus action, or a hidden cut that the platform cannot reliably perform. Do not treat a long prompt as a substitute for editorial structure.

## 6. Action and effects rules

Every attack must have a target, path, contact or miss, environment response, and new power state. Preserve weapon weight, reach, inertia, hands, and recovery.

For VFX, sequence the event as:

```text
establish → activate → impact/change → aftermath
```

Use a single strong signature effect per beat. Keep the subject readable through smoke, light, debris, and particles; effects must not hide the story action.

## 7. Use sound as narrative glue

Define sound by source and distance. Prioritize in this order:

1. Plot-critical action and impact.
2. Character movement, breath, weapon, and creature presence.
3. Location tone and transition bridges.
4. Music, only if requested.

For no-dialogue PVs, use silence, low-frequency pressure, distant alarms, wind, fire, machinery, and material-specific Foley to show changes in danger. Do not use generic “epic” sound instructions.

## 8. Output in the user’s requested level of detail

- **“只要剧情”**: Output scenes in prose, with no shot table or prompt language.
- **“分镜脚本”**: Output a timed shot table with staging, camera, action, sound, and cuts.
- **“生成提示词”**: First confirm the timed storyboard; then output one prompt per Generation Clip, with start/end state and continuity constraints.
- **“全套 PV”**: Output, in order: project brief, scene synopsis, timed storyboard, generation-clip map, sound cues, and continuity QA.

Do not add subtitles, logos, voiceover, music, characters, weapons, or visual effects that the user has forbidden.

## 9. Final PV QA

Before delivery, verify:

- The first 3 seconds have a visible hook.
- Every scene has a causal handoff to the next.
- Character count, appearance, costume, weapon, injuries, and handedness remain stable.
- Space, screen direction, and light sources remain legible.
- No shot overloads its duration or its generation clip.
- The climax is visually larger or more emotionally decisive than the setup.
- The final image leaves a clear question, threat, or desire to continue.