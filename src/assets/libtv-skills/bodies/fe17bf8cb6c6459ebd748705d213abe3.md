# Game Character Entry Video with Intelligent Style Matching

## Core Methodology

### Framework 1: Visual Style Recognition System

The skill operates on an automatic visual parsing pipeline that extracts design language from uploaded character images. The core logic:

**Character → Visual Markers → Style Database → Matched Template**

When a character image is uploaded, the system analyzes:

- **Costume/Armor Type**: fabric, metal plates, synthetic materials, cybernetic implants
- **Material Texture**: glossy plastic, weathered leather, holographic projections, rusty iron
- **Color Palette**: neon vs. earth tones vs. pastel vs. monochrome
- **Weapon Category**: firearms, melee weapons, magic staffs, energy blades
- **Overall Atmosphere**: futuristic vs. medieval vs. horror vs. anime

These markers are cross-referenced against a style database with 7 predefined templates:

1. **Cyberpunk**: prosthetics, neon colors, holographic UI, rain-soaked streets
2. **Fantasy RPG**: plate armor, warm gold tones, parchment textures, castle environments
3. **Modern Military**: tactical gear, camo patterns, kevlar materials, war zones
4. **Anime/2D**: school uniforms, vibrant pastels, crystal buttons, sky castles
5. **Wasteland**: rust, duct tape repairs, gas masks, nuclear deserts
6. **Gothic Horror**: Victorian robes, blood red, candle halos, foggy graveyards
7. **Japanese Warring States**: samurai armor, lacquered wood, cherry blossoms, battlefields

Each style template contains:

- **Color System**: 4-5 dominant colors with specific hex ranges
- **UI Material Library**: texture descriptions (frosted glass, oak wood, rusty metal)
- **Equipment Naming Convention**: style-specific terminology ("Phantom Grip" vs. "Lion Heart Gauntlet")
- **Scene Environment Vocabulary**: location archetypes per style
- **Audio Signature**: sound effect categories (electronic blips vs. bell chimes)

### Framework 2: Locked Structure + Dynamic Variables

The 15-second narrative follows a fixed 5-act structure, but all visual/textual elements are variables:

**Fixed Timeline Skeleton**:

- 0-2s: Main Menu (camera overhead → character sits → menu UI)
- 2-4s: Left Arm Equipment Swap (zoom to left arm → panel slides in → equipment change)
- 4-7s: Right Arm Weapon Customization (orbit to right side → grid UI → modular replacement)
- 7-8.5s: Configuration Confirmation (pull back → button flash → UI collapse → relaxed pose)
- 8.5-10s: Loading Transition (loading bar 0%→100% → environment darkens → light effect)
- 10-15s: World Load Complete (character stands → 3rd person view → HUD appears → walks into scene)

**Dynamic Variables Per Act**:

TimelineFixed Camera MotionVariable Elements0-2sHigh angle overhead shotGround color, menu UI material, player ID/level text2-4sSmooth zoom to left armPanel texture, equipment names, transformation action4-7sOrbit to right sideGrid UI style, component icons, disassembly motion7-8.5sPull back to mid shotButton label, UI collapse animation, relaxed pose (sword plant/cigarette light/candy eat)8.5-10sStaticLoading bar fill animation, transition light effect10-15sThird-person behind viewEnvironment details, HUD layout, resource bars, footstep sound

### Framework 3: Text Customization Layer

All text content is treated as overrideable variables:

- **Player ID**: default "SILVER_KNIGHT" / "NEON_RUNNER" / etc. based on style
- **Level**: default LVL 45
- **Left Arm Equipment**: \[Equipment A\] / \[Equipment B\] (user can replace)
- **Weapon Components**: Hand / Forearm / Elbow / Upper Arm parts (4 slots)
- **Scene Options**: 3-4 location names per style
- **Confirmation Button**: "Holy Blessing" / "JACK IN" / "Engage" / etc.
- **Resource Bars**: Mana/Energy/Ammo depending on style

Users can override any text element without affecting the visual style matching.

## Workflow

### 1. Preparation Stage

**Required Input**:

- 1 character image (any resolution, portrait or full-body)

**Optional Input**:

- Player ID (if not provided, auto-generated based on style)
- Level number (default: 45)
- Equipment names (if not provided, auto-generated from style library)
- Scene preference (if not provided, auto-selected from style environment vocabulary)
- Text language (default: matches user's input language)

**Pre-Generation Checklist**:

- \[ \] Character image uploaded and accessible
- \[ \] Visual style recognized (cyberpunk/fantasy/modern/etc.)
- \[ \] All text variables populated (auto-generated or user-provided)
- \[ \] Sound effect timeline prepared (15 keyframe entries)
- \[ \] Negative prompt assembled (excludes non-matching styles)

### 2. Initial Design Stage

**Step 1: Visual Analysis**

Run character image through style recognition:

- Extract dominant colors → map to color system
- Identify material textures → select UI material library
- Detect weapon/armor type → choose equipment naming convention
- Assess overall mood → pick scene environment vocabulary

**Step 2: Template Assembly**

Construct the full English prompt using this structure:

```
15-second seamless continuous shot, [style keyword] game cinematic. 
0-2s: High angle overhead shot, [character appearance] sits on [matched color] ground, looking up at camera. Left side game menu UI with [matched UI material]: START NEW GAME, CONTINUE (highlighted), SETTINGS, EXIT GAME. Top right player profile: [Player ID] LVL [Level]. A cursor clicks "CONTINUE". 
2-4s: Camera smoothly zooms to left arm. A [matched UI material] panel slides in: "LEFT ARM EQUIPMENT". "[Equipment A]" is selected then slides to "[Equipment B]". [matched left arm transformation action]. 
4-7s: Camera smoothly orbits to right side. New UI slides in: "ARMAMENT CUSTOMIZATION" grid showing hand, forearm, elbow, upper arm components with [matched UI decoration]. Selection rapidly cycles through parts. [matched right arm disassembly/reassembly action]. 
7-8.5s: Camera pulls back to mid shot. "[confirmation button text]" button flashes. Clicked. All UI panels collapse inward and vanish. [matched relaxed pose description]. 
8.5-10s: A LOADING bar appears at bottom, filling rapidly from 0% to 100%. The [matched color] environment darkens, [matched transition light effect] seeping in. 
10-15s: As [he/she] stands up, the full [matched style] environment loads around [him/her]: [matched scene detailed description]. Camera settles into third-person behind [him/her], showing [his/her] back. HUD elements fade in: mini-map top left, [matched resource indicators] bottom right. A quest marker appears. [He/She] steps into [matched environment], [matched footstep sound]. 
Consistent [matched style] aesthetic, [matched tone and material keywords], no cuts, one smooth continuous camera motion, every UI interaction has distinct interactive sound effects matching the [matched style] theme. 16:9, 15 seconds.
```

**Step 3: Sound Effect Timeline**

Generate 13 keyframe sound descriptions matching the style:

- Cyberpunk: electronic blips, arc discharge, quantum hum
- Fantasy: bell chimes, harp arpeggios, metal resonance
- Modern: tactical beeps, kevlar friction, gunmetal clicks
- Anime: crystal chimes, sparkle effects, energetic whooshes

**Step 4: Negative Prompt**

Assemble style-exclusion keywords:

- If cyberpunk → exclude "medieval armor, magic runes, warm golden tones, parchment textures"
- If fantasy → exclude "neon lights, sci-fi elements, modern technology, plastic textures"

### 3. Iteration Stage

**Optimization Dimension 1: Style Accuracy**

Check consistency:

- \[ \] UI material matches character costume material (e.g., no oak wood UI for cyberpunk character)
- \[ \] Color palette aligns (e.g., no warm gold for wasteland aesthetic)
- \[ \] Equipment names fit genre (e.g., "Nano Cable" not "Dragon Scale")
- \[ \] Scene environment matches (e.g., no cherry blossom gardens for military operative)

**Optimization Dimension 2: Text Customization**

When user requests text changes:

- Player ID → replace in "Top right player profile" section
- Equipment names → replace in "LEFT ARM EQUIPMENT" and weapon component lists
- Scene name → replace in "environment loads around" section
- Confirmation button → replace button label text
- Language → regenerate all text content in requested language (keep prompt structure in English)

**Optimization Dimension 3: Style Override**

When user says "change to \[style\] style":

- Ignore auto-recognition result
- Load specified style template
- Regenerate all variable elements (colors, UI materials, equipment names, scenes)
- Re-output full prompt

**When to Accept**:

- Style recognition result matches character visual markers
- All text variables are populated (no \[placeholder\] markers remain)
- Sound effect timeline has 13 entries
- Negative prompt excludes at least 4 non-matching style elements

**When to Regenerate**:

- User explicitly requests style change
- User provides new text content
- User requests "make it more \[adjective\]" (adjust color intensity, UI material, scene lighting)

## Key Constraints & Standards

### Immutable Rules

1. **Timeline Structure**: The 5-act structure (0-2s / 2-4s / 4-7s / 7-8.5s / 8.5-10s / 10-15s) MUST remain fixed. Do not shorten or lengthen any segment.

2. **Camera Continuity**: The entire 15 seconds must be ONE continuous shot with smooth camera motion. No cuts, no scene transitions, no fade-to-black.

3. **Act Markers**: Each time segment must explicitly start with its timestamp (e.g., "0-2s:", "2-4s:") in the prompt.

4. **UI Interaction Count**: Exactly 4 UI panels appear: Main Menu → Left Arm Panel → Weapon Grid → Confirmation Button → Loading Bar → HUD. No more, no less.

### Style Fidelity Rules

5. **Color System Consistency**: Once a style is matched, its color palette (4-5 colors) must appear in: ground color, UI highlights, transition light effects, and environment lighting. Do not mix color systems from different styles.

6. **Material Texture Consistency**: UI material (holographic glass / oak wood / rusty metal / etc.) must match character costume material category. E.g., if character wears fabric, use parchment/cloth UI textures, not glass.

7. **Terminology Consistency**: Equipment names, scene names, button labels must use vocabulary from the matched style's naming convention. E.g., cyberpunk uses "Phantom Grip", "Nano Cable"; fantasy uses "Lion Heart Gauntlet", "Silver Wing Pauldron".

8. **Sound Effect Signature**: All 13 sound keyframes must use audio descriptors from the matched style's audio signature. E.g., cyberpunk uses "electronic", "arc", "quantum"; fantasy uses "bell", "harp", "metal resonance".

### Technical Standards

 9. **Aspect Ratio**: Must output "16:9, 15 seconds" at end of prompt.

10. **Language Split**: The main prompt body must be in English (for model compatibility). Text content placeholders (Player ID, equipment names, button labels, scene names) can be in user's language.

11. **Negative Prompt Requirement**: Must include at least 4 specific exclusion terms targeting non-matching styles. Generic terms like "low quality", "blurry" are insufficient.

12. **Sound Timeline Format**: Output as a bullet list with exact timestamps (to 0.5s precision), event description, and style-matched sound effect term.

## Recommended Tools & Models

Use Minimax Hailuo H3 for video generation. This model specializes in long-duration continuous shots with complex camera motion and UI overlays.

## Example

**Input**: Character image showing a silver plate armor paladin with blue cape, holding a greatsword

**Auto-Matched Style**: Fantasy RPG

**Generated Prompt** (excerpt):

```
15-second seamless continuous shot, fantasy RPG game cinematic. 0-2s: High angle overhead shot, a noble paladin in gleaming silver plate armor with a flowing blue cape sits on warm golden marble floor, looking up at camera. Left side game menu UI with oak wood and gold rivet textures: START NEW GAME, CONTINUE (highlighted with golden glow), SETTINGS, EXIT GAME. Top right player profile: SILVER_KNIGHT LVL 45. A cursor clicks "CONTINUE". 2-4s: Camera smoothly zooms to his left arm. An oak-framed parchment panel slides in: "LEFT ARM EQUIPMENT". "狮心臂甲" is selected then slides to "圣光护腕" with magical chime sounds. His left gauntlet magically reconfigures, plates shifting and realigning, a soft blue rune glowing brighter on the back of his hand...
```

**Sound Effect Timeline** (excerpt):

- 0.5s: Cursor movement → Soft blip
- 1.5s: Click continue → Sacred bell chime
- 2.5s: Panel slides in → Parchment unfold sound
- 3.0s: Switch equipment → Magical chime
- 3.5s: Bracer locks → Metal locking sound

**Negative Prompt**:

```
blurry text, distorted UI, jittery animation, broken perspective, missing sound effects, static pose, non-fantasy style, sci-fi elements, modern technology, neon lights, plastic textures
```