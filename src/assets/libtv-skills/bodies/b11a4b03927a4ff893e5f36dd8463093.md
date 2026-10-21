---

## name: create-grounded-wasteland-cyberpunk\
description: Create a single photorealistic grounded cyberpunk environment image from a user's scene idea, using weathered megastructures, exposed infrastructure, restrained hazard colors, atmospheric weather, and believable signs of everyday life. Use when a user asks to turn a location, building, street, vehicle, or landscape into realistic wasteland cyberpunk, industrial cyberpunk, tropical cyberpunk, corporate dystopian, or lived-in future-city concept art. Avoid franchise-specific characters, logos, text, and exact compositions.

# Create Grounded Wasteland Cyberpunk

## Overview

Turn one concise scene idea into one cinematic environment image. Make the future feel constructed, regulated, repaired, inhabited, and physically possible rather than decorating a normal city with generic neon.

Read references/[style-language.md](http://style-language.md) before composing the final prompt.

## Collect the Brief

Require one subject or location, such as:

- A market under an elevated transit line.
- A coastal hotel reclaimed by vegetation.
- An agricultural convoy crossing a flooded plain.
- A guarded parking structure during heavy rain.

Accept optional time, weather, camera distance, aspect ratio, population level, and accent color. Use these defaults when absent:

- Time: overcast late afternoon.
- Weather: humid haze after rain.
- Camera: wide environmental establishing shot at human eye level.
- Aspect ratio: 16:9.
- Population: sparse, with small figures for scale.
- Output: one image.

Do not require a reference image from the user.

## Build the Scene in Layers

Design the image from large to small:

1. **Megastructure:** Establish one dominant concrete, steel, or composite mass with believable engineering and a clear function.
2. **Infrastructure:** Add external pipes, cable bundles, scaffolds, maintenance bridges, vents, barriers, drains, antennas, service modules, and safety rails.
3. **Human adaptation:** Add repairs, improvised shade, graffiti-like abstract marks, patched surfaces, tarps, small stalls, reused machinery, or vegetation.
4. **Operational signals:** Use original, unreadable or abstract hazard markings, lane paint, edge lighting, and small status lamps. Do not reproduce existing brands or legible copyrighted signage.
5. **Atmosphere:** Choose rain, wet reflections, steam, dust, smoke, humidity, harsh sunlight, or low fog according to the brief.
6. **Scale evidence:** Include a few small people, vehicles, palms, doors, or maintenance equipment to make the architecture feel massive.

Preserve a clear visual hierarchy. Keep one dominant structure, one route through the frame, and one controlled accent-color system.

## Apply the Style Grammar

Use these invariants:

- Favor weathered concrete, oxidized steel, dirty glass, rubber, asphalt, painted utility surfaces, and exposed cabling.
- Combine advanced technology with visible maintenance, scarcity, regulation, and decay.
- Keep the palette mostly charcoal, concrete gray, dusty olive, muted teal, and dirty beige.
- Use safety yellow as the main accent; add restrained red-orange or cyan only when needed.
- Make lighting physically motivated by sun, work lights, warning strips, vehicle lamps, or signage.
- Allow vegetation, moisture, dirt, posters, and temporary structures to interrupt rigid architecture.
- Use cinematic realism with fine material detail, atmospheric depth, and mild sensor or film grain.

Avoid turning every surface into neon. Avoid clean utopian towers, glossy showroom materials, rainbow lighting, floating hologram clutter, superhero compositions, and empty decorative sci-fi corridors.

## Choose a Scene Mode

Select one mode based on the brief:

- **Sun-bleached tropical decay:** Strong hazy backlight, faded concrete, scaffolding, palms, invasive greenery, dirty yellow-green accents.
- **Rain-soaked industrial district:** Cool gray daylight, wet asphalt, pipes and cable bridges, steam, sparse red and safety-yellow light.
- **Controlled security zone:** Heavy shadow, hard barriers, fences, ramps, red-orange warning light, minimal green status light.
- **Civilian neon undercroft:** Dense cables, patched walls, small machines and stalls, wet reflections, restrained cyan-magenta highlights within a dirty olive environment.
- **Rural corporate machinery:** Vast field or desert, monumental utility vehicles, dust or crop spray, small human scale, muted blue-gray air.

Do not mix every mode into one image. Choose one primary mode and borrow at most one secondary trait.

## Compose the Prompt

Write one continuous natural-language generation prompt in this sequence:

1. Scene and dominant subject.
2. Camera, composition, and scale.
3. Architecture and functional infrastructure.
4. Human traces and environmental wear.
5. Weather and physically motivated light.
6. Palette, materials, realism, and exclusions.

Name concrete visual evidence instead of relying on the phrase “cyberpunk style.” For example, describe external cable trunks, repaired concrete, sodium warning strips, rain-polished asphalt, and tiny maintenance workers.

End with concise constraints:

```text
Original worldbuilding, no existing franchise logo or character, no
legible brand text, no watermark, no rainbow-neon overload, no glossy
utopian skyline, no clean showroom surfaces, no implausible floating
objects.
```

## Generate and Validate

Generate one image using the requested aspect ratio. Inspect it before delivery:

- The scene reads as a believable place with a clear function.
- The advanced technology is integrated into infrastructure rather than pasted on.
- Weathering and human use appear across multiple surfaces.
- Accent colors occupy a minority of the frame.
- Lighting has identifiable physical sources.
- The composition contains foreground, midground, and background depth.
- No copied logo, recognizable franchise character, artist signature, watermark, or legible brand text appears.
- The result is not dominated by purple-blue neon.

Retry by correcting only the failed dimension. For generic neon results, strengthen materials, function, weathering, and daylight or practical lighting. For visual clutter, remove secondary objects and restore one dominant structure.

## Deliver

Return one finished environment image. If the platform exposes the generation prompt, also return the concise final prompt used to create it.