---

## name: celestial-megastructure-prompts description: Create art-directed Chinese celestial megastructure, cloud-palace, and monumental-architecture image prompts with a required matching image-to-video motion prompt. Use for 东方天宫、云上宫阙、巨型古建筑、史诗感国风场景、建筑概念图, requests beginning 天庭生图： or 天庭视频：, and requests to analyze or reproduce cinematic scale, shot variety, perspective, light, atmosphere, motion, and narrative world-building from similar references.

# 东方天宫巨构提示词

Create physically impossible worlds that still feel spatially credible: palaces above cloud seas, mountain-sized gates, roofed halls that become landscapes, and quiet human witnesses. Return a matching image-to-video prompt with every image prompt unless the user asks to omit it.

## Choose the scene deck before writing

Before drafting, choose exactly one primary **shot family**, one **figure mode**, one **light/material mode**, and zero or one **hero anomaly**. Read references/shot-atlas.md whenever the user supplies a broad reference pack, asks for multiple prompts, says the outputs look repetitive, or wants a video sequence. Read references/prompt-recipes.md for copy-ready templates and corrections. When the output will be executed by LibTV or another weaker instruction-following agent, also read references/libtv-hard-mode.md and use its hard mode.

- Shot family controls camera geometry. Do not default every image to a white-jade side colonnade.
- Figure mode controls scale. A distant scale token, a readable ceremonial witness, and an inhabited procession are different valid choices; never mix their instructions.
- Light/material mode controls emotional temperature. Blue-white daylight, red-and-gold side light, bronze dusk, and moonlit portal scenes are not interchangeable.
- A hero anomaly is one memorable impossible relation, such as a sky waterfall, a palace growing from a cliff, a moon inside a cosmic gate, a whale breaking a cloud sea, or a pine framed by a temple. Use at most one per frame. Let the architecture support it rather than compete with it.
- Treat a visible central stair, skyway, gate, or threshold as the **master geometry**, not a second anomaly. A selected anomaly may occupy one off-axis sector, but it must share the same depth system and never create a second vanishing point or competing destination.

## Match the reference before adding a story

When the user supplies a reference, identify in this order: **(1) dominant scale hierarchy, (2) camera geometry, (3) light/material palette, (4) selected figure mode, (5) hero anomaly or recurring motif**. Preserve this order in the prompt.

- Keep the reference's camera family. Do not convert a low upward interior, oblique side corridor, framed threshold, axial ascent, or telephoto distant view into a default centered facade.
- Treat a pine, waterfall, whale, portal, lamps, or scroll table as optional. Add one only when it is in the reference or requested by the user.
- Do not translate a white-jade celestial megastructure into a human-scale courtyard, complete ceremonial gate, or garden view. If the reference is about giant columns and cloud space, make those the subject.
- Use axial symmetry deliberately for an ascent, gate, or circular portal. Prefer oblique/asymmetric framing for side halls, threshold reveals, and architecture-as-landscape. Never globally ban symmetry.
- Choose either full material detail or **silhouette-veil** for a foggy reference. In silhouette-veil mode, keep the eave profile, structural mass, principal aperture, and rim light readable while surface detail dissolves into mist; do not force every wall and column to stay sharp.
- State the two highest drift risks in the diagnosis, then counter them in the positive and negative prompts.

## Extract the image logic

Make these decisions before writing. State a brief assumption only when the reference leaves one unknown.

 1. **Shot family and lens** — choose the camera geometry from the atlas; use either wide spatial expansion or telephoto compression, not both.
 2. **Primary scale relation** — make a column, roof, arch, stair, cliff-palace, corridor, or distant city visibly dominate the frame.
 3. **Figure mode** — specify count, approximate visual scale, placement, back/side-facing orientation, and one quiet action.
 4. **Normal-scale proof** — pair figures with a readable railing, lamp, stair, door, robe, table, or tile bay.
 5. **Hero relation** — define one legible relationship: people beneath a giant column, a palace beyond a threshold, a sky waterfall below a hall, a whale above a cloud ocean, or a moon framed by a gate. If an axis or threshold is visible, make it the master geometry; place any whale, waterfall, or pine off-axis without creating another spatial system.
 6. **Depth grammar** — define foreground, middle ground, distance, and sky/cloud layer. Repeated architecture must converge on one intentional vanishing point or circular/axial geometry.
 7. **Eastern architectural grammar** — name concrete parts: white-jade base, dragon-carved column, cinnabar pillar, dark timber beam, dougong, layered eaves, caisson ceiling, stone balustrade, bronze lamp, or wet stone platform.
 8. **Light and materials** — specify light direction, shadow density, limited palette, and whether the structure is in full detail or silhouette-veil; use real stone, lacquer, wood, bronze, water, mist, and cloud textures.
 9. **Narrative beat** — choose arrival, passage, worship, revelation, observation, breath/detail, or departure.
10. **Exclusions** — remove the most likely drift rather than adding vague quality words.

## Build the image prompt in this order

Write one continuous Chinese image prompt in this sequence:

`format and image type → shot family and dominant scale relation → camera position/lens/composition → foreground frame → one hero anomaly or structural relationship → selected figures and normal-scale proof → depth/vanishing grammar → Eastern architecture → light/materials/atmosphere → narrative emotion → exclusions`.

Prefer observable constraints over filler such as “8K”, “HDR”, or “masterpiece”. Do not claim a precise real-world distance unless it serves the story; use “across layers of cloud sea, impossibly distant yet still monumental” when appropriate.

## Use hard mode for weaker prompt agents

When the user says LibTV, another model follows the skill weakly, or prior results look small, generic, or atmospheric-but-flat, stop relying on the agent to infer visual hierarchy. Use **hard mode**.

- Start the final image prompt with the subject hierarchy and visible frame occupation: name the one giant structure, state that it presses against or exits the frame, and state its dominant region. Do not start with generic mood words.
- Include exactly one camera geometry, one vanishing system, one figure mode, one light mode, and zero or one anomaly. Never ask a weaker model to mix several attractive ideas by itself.
- State at least one normal-scale proof and at least two depth mechanisms: cropped foreground structure, repeated elements, a readable skyway/stair, or separated cloud layers.
- Name three to five concrete Chinese structural/material terms. Use a limited material pair or trio; “ancient Chinese palace” alone is insufficient.
- State a cold shadow region and a warm directional light source. Lock cloud/mist to reveal depth rather than cover the subject.
- Put all prohibitions in a separate negative prompt. In the positive prompt, describe only what must appear; avoid a long chain of negated concepts that weak image models may render.
- Run the hard-mode checklist in the reference before delivering. If any required lock is absent, rewrite the prompt rather than adding more decorative nouns.

## Keep grandeur structural, not decorative

Make the image feel large through relationships rather than indiscriminate enlargement:

- Crop a near column, roof, beam, arch, or platform beyond the frame when the chosen shot family calls for pressure or a reveal.
- Make rails, tiles, water channels, lamps, column bays, or eaves repeat into one shared depth system.
- Keep the far structure monumental after atmospheric perspective. Use full detail when the reference supports it; in silhouette-veil mode, haze may hide surface detail but must not erase the mass, eave outline, main aperture, or directional rim light.
- Use two to four depth layers. A single giant facade against clouds looks like a backdrop, not a world.
- Use a near roof, beam, opening, column, or opposing eaves as a frame within the frame for threshold shots.
- Let figures serve the selected narrative role. Avoid detailed faces unless the user explicitly asks for a character portrait; this is an architecture-first skill.

## Vary a series without losing one world

Lock architectural era/materials, cloud height, costume palette, light direction, and any recurring motif. Then vary the shot family rather than only changing the title.

For a set of five or more frames, use at least four shot families, three different camera geometries, and two light/material modes. Use each hero anomaly at most once unless it is the explicit story subject. Avoid repeating the same side corridor, centered gate, or pine-and-gate composition in consecutive frames. A reliable five-beat order is: establishing scale → passage/inhabitation → revelation/anomaly → quiet architectural breath → departure or world-wide view.

## Always pair image and video prompts

Treat the approved still as the **first frame**, not a loose reference. If duration/platform is unspecified, write for a restrained 5–6 second shot.

Write the video prompt in this order:

`first-frame preservation → duration and one camera motion → cloud/mist motion → anomaly or motif micro-motion → figure micro-action → slow light change → stability locks`.

- Match camera motion to the selected shot family; use the motion mapping in references/shot-atlas.md. Choose one action only.
- Keep composition, architecture, people count/placement, costumes, main relation, and primary anomaly fixed.
- Animate environment before architecture: layered clouds drift, mist moves lightly, water falls/reflects, and light shifts slowly.
- Allow figures only micro-actions: robe movement, breathing, looking outward, or a few distant steps. Do not request close facial performance.
- For an axis-plus-side-spectacle composition, move only slowly forward along the existing axis. Keep the anomaly in its existing side sector and let it complete only one natural continuation (for example one whale arc and spray settling), without a second leap, crossing the axis, or blocking the luminous destination.
- Explicitly prohibit shake, fast flight, geometry morphing, structural collapse, extra people, disappearing figures, face swaps, and text. Do not introduce a spectacle absent from the first frame.

## Diagnose and revise

Change one lever at a time:

- **Ordinary large building:** add normal-scale proof, frame-breaking foreground architecture, and a distant subject that remains huge.
- **Flat image:** add foreground occlusion, repeated elements, a shared vanishing point, and one more cloud/structure depth layer.
- **Looks like a game scene:** reduce glow, neon, saturation, crowds, and decorative clutter; increase material specificity and directional light.
- **Chinese architecture becomes generic fantasy:** replace vague “ancient palace” with named structural parts and a limited material palette; exclude Roman/Greek/Gothic/European classical architecture.
- **Turns into a courtyard or scenic gate:** remove unsupported pine/garden motifs, crop a giant structural element, and state the reference’s actual camera geometry.
- **Too centered or too asymmetric:** switch only if the selected family requires it—axial for ascents/portals, oblique for corridors/thresholds/landscapes.
- **People dominate or disappear:** select the correct figure mode, state placement and role, and omit face detail; do not merely repeat a percentage.
- **Memorable but generic:** use one specific hero anomaly or structural relationship; remove unrelated spectacle.
- **Fog erases the building:** switch to silhouette-veil and lock the dark mass, eave contour, main door/opening, and warm rim instead of demanding sharp detail everywhere.
- **Side spectacle breaks the composition:** restore the stair/skyway/threshold as master geometry; keep the anomaly in one side sector, use only one splash/source, and preserve the central destination unobstructed.
- **Series looks monotonous:** rotate the next frame to an unused shot family, light mode, and camera movement while keeping world continuity.

## Delivery standard

For a normal request, deliver: a short shot diagnosis, one copy-ready positive image prompt, a compact image negative prompt, a matching copy-ready image-to-video prompt, a compact video negative prompt, and two targeted revision options. When a reference exists, name its dominant hierarchy, shot family, figure mode, and two drift risks. For multi-shot film requests, deliver numbered no-text keyframes first and pair every keyframe with its own reference-based video prompt. In LibTV hard mode, put the finished image prompt and its negative prompt first, remove optional variants unless requested, and use the explicit structural locks from `libtv-hard-mode.md`.