---

## name: libtv-confirmed-live-commerce description: Direct step-by-step LibTV and Seedance production of vertical ecommerce livestream clips with explicit user approval before every asset, prompt, upload, paid generation, retry, and next segment. Use for 9:16 product-selling videos, warehouse or shop livestream scenes, AI hosts, product packaging references, voice references, segmented scripts, first-frame or previous-tail-frame continuation, LibTV generation, and per-segment quality control when preventing credit waste and identity/product drift matters. Preserve the user's validated five-part spoken-copy framework and change only approved product, price, specification, batch, usage, and related variable fields. Default all user-facing deliverables and executable prompts to Simplified Chinese for Chinese-speaking users.

# LibTV Confirmed Live Commerce

Produce realistic 9:16 livestream-selling videos through a gated, asset-first workflow. Treat every generation as a credit-spending action and require explicit approval immediately before it.

## Non-negotiable rules

 1. Never generate an image or video, upload material, retry, extend, or start the next segment without the user's explicit approval for that exact action.
 2. Ask for one decision at a time. Never bundle approval for multiple generations.
 3. Do not interpret “看着可以”, a new attachment, an edit request, or silence as permission to generate. Ask “是否确认执行……？” and wait for a clear answer such as “确认生成角色图”。
 4. Approval scope is exact. “确认角色方案” approves the specification, not image generation. “确认生成第2段” approves one version of segment 2, not retries or segment 3.
 5. Generate one asset, one segment, and one version per approved call. Never batch paid generations.
 6. Never auto-retry. Diagnose a failed result, propose one repair, state the credit implication, and wait for approval.
 7. Preserve approved spoken copy verbatim. Do not paraphrase numbers, quantities, prices, product names, guarantees, or calls to action.
 8. Keep reference duties independent: role controls identity and clothing; scene controls space and camera; product controls shape, contents, package ratio, and count; pose controls only pose.
 9. Do not promise perfect identity, text, packaging, lip sync, or continuity. State high-risk shots before approval.
10. End every response with the current state and the single next approval needed.
11. When the user communicates in Chinese, default every user-facing deliverable and every executable generation prompt to Simplified Chinese. This includes asset sheets, scene plans, product specifications, segment maps, first-frame prompts, LibTV prompts, preflight cards, QC reports, and transition decisions. Translate internal English references before presenting them. Keep English only for model-required parameters, filenames, or established proper nouns, unless the user explicitly requests English or bilingual output.
12. Before any generation, show the complete final Chinese prompt that will actually be submitted. Do not maintain a different hidden English prompt or silently translate the approved Chinese prompt after approval. Any language change requires the user to approve the revised prompt again.
13. Use the validated original five-part spoken-copy framework in `references/project-pattern.md` as the default master copy. Preserve its segment order, sentence order, rhetorical rhythm, price reveal, proof sequence, offscreen-response beats, and call-to-action wording. Change only fields listed in an approved variable map. Never “optimize,” rewrite, shorten, expand, or create a new selling script unless the user explicitly approves departing from the master framework.
14. Do not copy an unsupported claim merely because it exists in the framework. When a new product cannot truthfully support a slot such as “今年刚摘”“不掺陈货”“厂家搞活动” or a buyer warning, flag the mismatch and propose the smallest slot-level replacement that preserves the surrounding sentence structure. Wait for approval of that replacement.

## State machine

Advance only after the required approval is recorded.

`INTAKE → COPY_TEMPLATE → VARIABLE_MAP → SCRIPT_LOCK → SEGMENT_DRAFT → ROLE_PLAN → ROLE_REVIEW → SCENE_PLAN → SCENE_REVIEW → PRODUCT_PLAN → PRODUCT_REVIEW → VOICE_PLAN → SEGMENT_PROMPT → GENERATING → QC_REVIEW → TRANSITION → COMPLETE`

Return to the relevant planning state when the user requests changes. Do not skip asset states unless the user explicitly confirms that supplied assets are final.

Maintain an approval ledger with:

- State and item ID
- Proposed action
- Inputs and reference duties
- User's exact approval or rejection
- Generated output ID, when applicable
- QC result and unresolved risks
- Next permitted action

## Workflow

### 1. Intake and evidence review

Inventory the script, role references, scene references, product references, voice reference, previous clips, and target platform. Inspect supplied video files before judging them. For multiple clips, run `scripts/inspect_segments.py` to collect duration, resolution, first/last frames, and contact sheets.

Summarize what is present, what is missing, and the single next decision. Do not generate anything.

### 2. Inherit the original copy framework

Read the master five-part framework in `references/project-pattern.md`. Extract the new project's product facts and produce a variable map before writing adapted copy. Default variable slots are:

- Product name and category
- Product-specific sensory descriptors or buyer warning
- Year, harvest, batch, or freshness statement
- Specification, weight, quantity, and unit
- Comparison price and final price
- Quality exclusion or proof claim
- Usage scenarios, dosage/action, and result claim
- Promotion reason or activity source

Treat every word outside the marked variable slots as locked. Do not replace colloquial expressions, reorder sentences, merge segments, or alter the escalation from hook → price → quantity proof → quality/use proof → scarcity CTA.

Present a three-column inheritance table: original framework, approved variable replacement, and adapted result. Mark any unsupported or uncertain claim. Ask the user to approve the variable map only.

### 3. Lock the adapted spoken copy

After the variable map is approved, render the complete five-part adapted copy. Compare it against the framework and explicitly report any non-variable text difference; the expected count is zero unless the user approved an exception.

Separate host and offscreen staff dialogue. Flag unclear words, compliance risks, unsupported claims, price ambiguity, and duration pressure. Present the complete adapted copy for a separate approval.

After approval, mark it immutable. Later changes require a new copy approval.

### 4. Approve the segment map

Split the copy by selling function and performance beat, not merely character count. A common five-part structure is:

1. Origin and freshness hook
2. Offer and price reveal
3. Quantity or value proof
4. Product-detail or usage proof
5. Scarcity and call to action

For each proposed segment show exact dialogue, estimated duration, main action, opening source, end state, and risk. Request approval for the map only; do not draft all generation prompts yet.

### 5. Build assets one category at a time

Use this order unless the user changes it: role → scene → product → voice.

For each category:

1. Present a specification and reference duties.
2. Ask approval of the specification.
3. Present the exact generation action and ask whether to execute it.
4. Generate one version only after approval.
5. Inspect consistency, anatomy, proportions, materials, and unintended text.
6. Ask the user to accept, revise, or reject it.

Role assets should include face, three-quarter view, full body, hair, headpiece, garment details, and neutral expression. Scene assets should be person-free and product-agnostic where reuse matters. Product assets should include front, side, rear, scale reference, loose contents, sealed bag, and an open-bag display view when needed.

### 6. Draft only the current segment prompt

Read `references/prompt-templates.md`. Include:

- Exact reference duties
- Opening state and spatial anchors
- One continuous action timeline
- Exact dialogue, speaker, and action bindings
- Product count, package proportions, hand placement, and opening state
- One dominant camera behavior
- Closing state suitable for the next segment
- Audio, subtitle, logo, and music restrictions

Resolve contradictions before approval. A fixed phone cannot also perform repeated cinematic push-ins and pull-outs. Pick one restrained camera behavior that matches the intended style.

### 7. Choose the opening source

For each segment select exactly one:

- Approved role, scene, and product references
- Previous segment's clean tail frame
- Hard cut to a new approved composition
- Newly generated first frame

Inspect the previous tail for expression, pose, hands, product count, package deformation, camera position, and motion blur. Show the tail frame and recommendation, then ask the user to approve the source. Do not assume tail-frame continuation is always safer.

### 8. Run the LibTV preflight

Before any video job, present one compact preflight card:

- Segment number and planned duration
- Exact prompt version
- Inputs and their duties
- Opening source
- Expected closing state
- Known high-risk details
- Credit action: one generation, no automatic retry

Ask: “是否确认现在生成第 N 段的 1 个版本？” Wait for an explicit confirmation, then execute one job.

### 9. Inspect before asking for another generation

Review the result frame by frame and report:

- `BLOCKER`: wrong copy, identity, product, count, continuity, or unusable anatomy
- `MAJOR`: obvious package deformation, hand failure, implausible opening/closing, or camera contradiction
- `MINOR`: small cosmetic issue that may be acceptable
- `PASS`: suitable to lock

Describe evidence and the cheapest correction. Never regenerate automatically. Ask whether to accept the result, revise the prompt, or approve one retry.

### 10. Approve the transition

After a segment is accepted, present the final frame and choose tail continuation, hard cut, or new first frame. Ask for that transition approval before drafting the next segment prompt. Repeat the prompt/preflight/generation/QC cycle for one segment at a time.

### 11. Close the project

Deliver the locked asset list, final copy, segment ledger, prompt versions, continuity decisions, accepted outputs, rejected-output reasons, and reusable lessons. Do not claim completion while any segment is unapproved.

## High-risk controls

- Transparent bags: lock silhouette, fill line, seam, zip strip, thickness, and scale. Avoid unnecessary squeezing or rotation.
- Open-package display: describe the opening mechanism and hand positions; keep the bag upright; use a dedicated first frame when the transition is fragile.
- Loose granules: lock species, color variation, surface texture, irregularity, and particle scale. Reject pellets or uniform beads.
- Close-to-lens actions: define the nearest distance and forbid the product from covering the host's full face unless intended.
- Product count: state the exact visible count at the start and end.
- Packaging text: prefer blank or minimal packaging during generation; add exact typography in post-production.
- Offscreen dialogue: explicitly keep the speaker outside the frame and forbid extra people from entering.
- Platform switches: disable automatic captions, music, logos, watermarks, and beauty effects when not requested.

## Resources

- Read `references/project-pattern.md` for the validated warehouse green-peppercorn example and lessons.
- Read `references/prompt-templates.md` for approval, segment, preflight, QC, and transition templates.
- Run `scripts/inspect_segments.py` for repeatable review of supplied multi-segment videos.