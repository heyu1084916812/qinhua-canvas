# AI Micro-Film World Rule Engine

## Core Methodology

### Framework 1: World Physics Enforcement — The Reality Consistency Matrix

AI-generated video suffers from "spatial-temporal amnesia" — characters teleport, props vanish, timelines break. This framework enforces real-world physics through three ledgers:

**Spatial Ledger** — Every scene starts with a coordinate table:

- Character initial position (entry point)
- Movement vector sequence (path tracking)
- Exit position and timestamp
- Rule: A character cannot appear at Position B without a movement transition from Position A

**Temporal Ledger** — Time is unidirectional:

- T+00: Scene baseline timestamp
- Each character has entry time + exit time
- Rule: An exited character cannot reappear without re-entry justification
- Rule: A not-yet-arrived character cannot appear in current scene

**Equipment Lifecycle Ledger** — Props have birth/death cycles:

- Wear timestamp (when equipment first appears)
- Remove timestamp (when equipment is taken off)
- Remove shot verification (must have visible removal action)
- Re-wear timestamp + narrative reason
- Rule: Equipment cannot vanish between frames without removal shot
- Rule: Removed equipment cannot reappear without re-wear action + plot justification

### Framework 2: Vehicle Coordinate System — Dismount Landing Grid

When a vehicle stops, it becomes a spatial anchor point (Point A). Each seat maps to a specific landing zone:

```
Driver (front-left)      → B1 (vehicle left-front)
Passenger (front-right)  → A2 (vehicle right-front)
Rear-left               → B2 (vehicle left-rear)
Rear-right              → C2 (vehicle right-rear)
Rear-center             → C1 (depends on door used)
```

**Execution Iron Rules:**

1. Vehicle stops → Establish landing grid → Every character gets assigned dismount door
2. Post-dismount initial position = corresponding landing point (no teleportation)
3. Door open/close = Must have corresponding action shot or dialogue reference
4. Subsequent shots: character moves FROM landing point, path must be physically plausible

### Framework 3: Daily Life Three-Act Structure — Natural Time Sequence

Daily living scenes must follow natural chronology (no time jumps):

```
Cooking Scene → Eating Scene → Post-Meal Scene
(cannot skip)   (cannot skip)  (tea/rest/conversation)
```

**Scene Segment Requirements:**

- **Cooking**: Ingredient handling, cookware operation, steam rising visuals
- **Eating**: Seated at table, chopstick/utensil movements, dish close-ups
- **Post-Meal**: Dish clearing, people dispersing, seated tea drinking

**Seating Rules (analogous to vehicle landing grid):**

- Sofa Position A → Who sits → Track entire scene
- Sofa Position B → Who sits → Track entire scene
- Standing up to leave → Must have standing action + reaction shot from others (minimum 1 frame)

### Framework 4: Surgical Error Correction — Minimum Intervention Principle

When an error is detected, isolate the exact faulty sub-shot (e.g., sub-shot #17 within shot NO.1), repair ONLY that segment:

**Step 1: Error Type Identification**

- Equipment state error → Check Equipment Lifecycle Ledger
- Character position error → Check Spatial Ledger
- Temporal physics error → Check Temporal Ledger
- Daily life logic error → Check Three-Act Structure completeness
- Combat relationship error → Active/passive roles cannot swap
- Naming logic error → Character cannot call their own name

**Step 2: Minimum Repair**

- Modify ONLY faulty sub-shot #K, do not touch others
- Repair prompt must explicitly state correct state
- New shot duration can be +1-2 seconds for smooth transition

**Step 3: World Rule Verification**

- ✅ Equipment state matches ledger
- ✅ Character position matches coordinate table
- ✅ Temporal node character presence correct
- ✅ Daily life three-act structure complete

**Step 4: Triple Technical Verification**

- ✅ New #K first frame = Old #(K-1) last frame
- ✅ New #K last frame = Old #(K+1) first frame
- ✅ Physical scene + lighting consistent with surrounding shots

**Step 5: Backfill and Holistic Verification**

- Reinsert new #K into #1-#18 sequence
- Verify entire main shot NO.X flows smoothly
- Update all ledgers (equipment/coordinates/timeline)

## Workflow

### 1. Preparation Stage — Ledger Construction

**Input Checklist:**

- Complete script with timestamps
- Character list with costume/equipment specifications
- Scene list with spatial layout descriptions
- Vehicle scenes: seat assignments for each ride

**Mandatory Pre-Production Ledgers:**

**A. Scene Coordinate Tracking Ledger** (one per scene):

```
Scene: [Name]  Time: [Script Time]  Lighting: [Environment]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Character | Entry Time | Initial Coord | Movement Path    | Exit Time | Exit Direction
Chen      | T+00       | Kitchen Island| →Living→Tea Table| T+45s    | Hallway
Lin       | T+00       | Sofa Armrest  | Stationary       | Not exited| ─
Huo       | T+00       | Floor Window  | →Balcony         | T+30s    | Balcony Door
Mo        | T+10s      | Tea Table Side| Stationary       | Not exited| ─
```

**B. Equipment Lifecycle Ledger** (character-wise):

```
Character | Equipment     | Wear Time | Remove Time | Remove Shot | Re-Wear Time | Re-Wear Reason
Chen      | Diving Goggles| NO.3#2    | NO.4#7     | ✅ Close-up  | NO.5#3      | Script: Re-enter water
Lin       | Windbreaker   | Full scene| NO.6#1     | ✅ Change    | ─           | ─
Huo       | Tactical Vest | NO.2#1    | NO.7#5     | ✅ Pack away | ─           | ─
```

**C. Temporal Physics Timeline** (scene-wide):

```
Time Node | Scene         | Present Characters     | Absent Characters (Reason)
T+00:00   | Apartment     | Chen/Lin/Huo          | Shen (at lab)
T+00:30   | Apartment     | Chen/Lin/Mo           | Huo (went to balcony)
T+01:00   | Garage        | Chen/Huo/Xing         | Lin (stayed at apartment)
```

**19-Category Pre-Production Checklist:**

Original 12 categories:

 1. Transition shot missing
 2. Group shot missing
 3. Prop close-up missing
 4. Preparation transition missing
 5. Character missing
 6. Closing shot missing
 7. Symbolic action missing
 8. Scene establishment missing
 9. Time jump transition missing
10. Parallel action missing
11. Reaction shot missing
12. Foreshadowing missing

New 7 world rule categories: 13. 🚗 Vehicle dismount landing points 14. 🪑 Scene coordinate ledger 15. 👓 Equipment lifecycle completeness 16. 🍜 Daily life three-act structure 17. ⏰ Timeline consistency (no ghost appearances) 18. 🔄 Re-wear justification for removed equipment 19. 🚪 Door open/close action coverage

### 2. Initial Production Stage — Layered Shot Generation

**Layer 3: Sub-Shot Level** (smallest surgical unit)

- Main shot NO.1 contains sub-shots #1 to #18

- Generate each sub-shot with explicit ledger-based constraints

- Example prompt structure:

  ```
  [Timestamp] [Character present list from Temporal Ledger]
  [Character positions from Spatial Ledger]
  [Equipment states from Lifecycle Ledger]
  [Camera angle] [Action description] [Duration]
  ```

**Layer 2: Main Shot Level** (intra-episode verification)

- Sequence: NO.1 → NO.2 → ... → NO.N
- Each main shot must be internally coherent before proceeding to next
- Verify first/last frame continuity between main shots

**Layer 1: Episode Level** (episode assembly verification)

- Composite all main shots into verification version
- Run analyze_video against script
- Generate deviation report
- ALL ✅ → Proceed to final composite

**Director's Table Position Verification Method** (for complex multi-character scenes):

1. Draw scene 2D floor plan (mark all doors, furniture, props)
2. Mark each character's initial coordinate
3. Draw movement vector for each character (arrows)
4. Verify vectors are physically feasible (no wall penetration, no distance teleportation)
5. Generate shots corresponding to vectors
6. Verify final coordinates match next scene's starting state

Example (Nine Friends Apartment Living Room):

```
[Floor Window]  Huo →
[Tea Table]     Mo ↓ (sit)
[Sofa]          Lin ← (sit on armrest)  Xing ↓ (sit)
[Kitchen]       ← Chen (cooking)
[Hallway]       ↑ (Chen Mubai enters)
```

### 3. Iteration Stage — Three-Pass Verification + One-Time Composite

**Pass 1: Sub-Shot Level** (internal coherence within #1-#18)

- Each main shot internally smooth ✅
- First/last frame continuity verified ✅

**Pass 2: Episode Level** (full episode sequence + world rules)

- Generate composite verification version
- Run analyze_video → Generate script comparison table
- Check all three ledgers (Spatial/Temporal/Equipment) against actual footage
- Identify ANY violations

**Pass 3: Surgical Repair Only** (minimum intervention)

- Repair ONLY faulty nodes using Framework 4
- Do NOT re-composite entire episode
- Update ledgers after each repair

**Final Composite Rule**:All ✅ → Execute ONE-TIME composite_video (final cut) NEVER iterate full episode composites — only repair faulty segments

## Key Constraints & Standards

### Immutable Physics Rules

**Spatial Rules:**

- A character can only be at ONE position at any given timestamp
- Movement from Position A to Position B requires transition shot or time-cut explanation
- Exited characters cannot appear in original scene without re-entry
- Not-yet-arrived characters cannot appear in target scene prematurely

**Temporal Rules:**

- Same timestamp → A character cannot be in multiple locations
- Departed character (T+30s exit) cannot appear in T+45s shot of same scene
- Physical movement requires time — A-to-B is not instantaneous

**Equipment Rules:**

- Equipment Choice = Commitment → Visible throughout until removal action
- Equipment cannot vanish between frames without removal shot (minimum 1-second close-up)
- Correct: "Lin removes goggles and places on ground → Then speaks"
- Wrong: "Previous frame wearing goggles → Next frame suddenly gone" (frame jump flaw)
- Re-wearing removed equipment requires plot justification:
  - Correct: Script says "She puts goggles back on to dive again" → Show re-wearing shot
  - Wrong: Equipment removed → Suddenly reappears with no explanation (logic break)

### Vehicle Scene Standards

**Dismount Sequence:**

1. Vehicle stops → Establish Point A (anchor)
2. Build landing grid (B1, A2, B2, C2, C1)
3. Every character assigned dismount door
4. Post-dismount initial frame: character AT landing point
5. Subsequent movement: FROM landing point outward (no teleportation)

**Door Action Coverage:**

- Car door open/close = Must have shot or dialogue reference
- Room door entry/exit = Must have action or establish shot
- Balcony door passage = Must have transition frame

### Daily Life Scene Standards

**Three-Act Mandatory Sequence:**

- Cooking → Eating → Post-Meal (no skipping)
- Cooking: ingredient prep, cooking action, steam/heat visuals
- Eating: table seating, utensil use, food close-ups
- Post-Meal: dish clearing, dispersal, tea/conversation

**Seating Continuity:**

- Sofa Position A assignment → Track entire scene duration
- Standing action required before position change
- Other characters must have reaction shot (minimum 1 frame) when someone stands

### Combat/Interaction Standards

**Active/Passive Role Consistency:**

- Active party (attacker) and passive party (defender) roles cannot swap mid-sequence
- Each action has clear initiator → Must be consistent across shots

**Naming Logic:**

- Character cannot vocally call their own name
- Third-person references must match character relationships

### Asset Naming Standards (v3.0)

```
Character asset: [Character Name]-[Version] (tag:character)
Scene anchor: Scene Anchor-[Scene Name] (tag:scene)
Prop anchor: Prop Anchor-[Prop Name] (tag:prop)
Coordinate ledger: /anchors/Episode_Coordinate_Ledger.md
Equipment ledger: /anchors/Episode_Equipment_Ledger.md
Timeline table: /anchors/Episode_Timeline.md
Shot table: /story_boards/task_Episode.md
Sub-shot: Shot Video-Episode#Main_Number Scene Description
Supplementary shot: Supplementary Shot-#Number.5 Description (tag:process_product)
Remake shot: Shot Video-Episode#Number_Remake Description (tag:process_product)
Cover image: [Series Name]·Episode Cover (tag:keyframe)
Final cut: [Series Name]·Episode Micro-Film Complete (tag:final_product)
```

## Core Philosophy

**"Let Everything Unfold Naturally"**

When goggles disappear → Audience snaps out of story When exited person reappears → Audience confused When cooking jumps to eating → Audience feels something missing When car stops and person instantly at doorway → Audience detects violation

World rules are not constraints — they are the air that lets the story breathe.

**Conformity to Common Sense = Audience forgets they're watching a video**They believe they're witnessing a real world unfolding.

This is the watershed between great work and failure.

## Advanced Techniques

### Cognitive Verification Before Answering

At every decision node, activate this thought sequence:

1. **Initial Engagement** → Absorb the problem context
2. **Problem Space Exploration** → Map all variables and constraints
3. **Multi-Hypothesis Generation** → Consider alternative approaches
4. **Natural Discovery** → Identify the most logically consistent path
5. **Test Verification** → Simulate execution mentally
6. **Error Identification & Correction** → Find all possible failure points BEFORE executing
7. **Knowledge Synthesis** → Integrate findings into solution
8. **Recursive Thinking** → Question the solution itself

**Three Core Tenets:**

- Before answering, find ALL possible errors
- Every frame deserves scrutiny, every node requires verification
- You're not making a video — you're reconstructing a world that truly happened

### Version Evolution Comparison

Dimensionv1.0 TXJYv2.0 BEATv3.0 WorldEngineComposite StrategyMultiple iterationsPer-episode verify onceThree-pass verify + one-time composite + world rulesEquipment Management7 iron rulesLifecycle ledgerLifecycle ledger + re-wear reasonPosition ManagementPhysical progression chainCoordinate ledgerCoordinate ledger + vehicle grid + timelineScene ManagementScene anchorsThree-act structureThree-act + coordinate ledger + door actionsVerification SystemPost-composite review3-layer verification3-layer + world rule verification layerChecklist6 categories12 categories19 categories (incl. 7 world rule types)Choreography MethodNoneNoneDirector's Table Position VerificationCore PhilosophyLogical smoothnessCommon senseNatural unfolding · Real world reconstruction