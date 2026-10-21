---

## name: aigc-brand-lookbook-public-safe description: This skill should be used when creating compliant brand lookbook plans, AI model images, scene images, product key visuals, reference-image recreation audits, and fashion-editorial prompts. It routes neutral brand inputs through fourteen visual directions, checks composition and pose physics, separates positive and negative prompts, and blocks unsafe, privacy-sensitive, infringing, or non-publishable material before output. Supports iterative prompt optimization with versioned feedback and a strict publication safety gate. version: 2.4.4 agent_created: true

# AIGC Brand Lookbook — Public Safe Edition

## Purpose

Create reusable, high-quality lookbook workflows for fashion, footwear, accessories, lifestyle products, and neutral product placeholders. Preserve editorial photography quality while enforcing a strict publication gate for safety, privacy, copyright, trademark, personal data, and platform cleanliness. Optimize prompts iteratively using versioned feedback (v1, v2, …) and structured review notes.

## Trigger Conditions

Load this skill for:

- brand lookbook planning;
- AI model, outfit, scene, or product-key-visual prompts;
- reference-image recreation and comparison;
- composition, pose, color, lighting, lens, or realism optimization;
- style smoke tests before adding a real product image;
- packaging a lookbook skill or preparing a public distribution version.

## Non-Negotiable Publication Gate

Before using, exporting, or packaging any input, inspect the source material and reject the item when a material risk cannot be removed without guessing or obscuring the subject.

Block and do not soften, blur, crop around, or work around the following categories:

### Content safety

- political, extremist, or unlawful propaganda;
- sexual content, sexualized minors, nudity, exploitative or suggestive content;
- graphic violence, gore, terror, instructions for crime, weapons used to harm, or dangerous stunts;
- hateful, discriminatory, or demeaning protected-group content;
- religiously sensitive or provocative symbols when they are not necessary to the requested work;
- deepfake, face-swap, or likeness synthesis of real, identifiable, or deceased persons without documented permission;
- geolocation or politically sensitive symbols, disputed maps, flags, or territorial representations that conflict with platform compliance;
- self-harm, substance abuse normalization, or content that romanticizes harm.

### Identity, privacy & rights

- real people, celebrities, public figures, fictional characters, film/television/game IP, or recognizable likenesses without documented permission;
- unlicensed trademarks, logos, branded packaging, copyrighted artwork, or competitor identity;
- personal data including names linked to contact details, phone numbers, addresses, QR codes, IDs, tickets, receipts, account handles, metadata, or location traces;
- platform watermarks, AI labels, interface chrome, or embedded promotional marks in final assets.

### Platform & commercial compliance

- external links, advertisements, referral language, affiliate instructions, hidden tracking, credentials, or code that contacts an external service;
- misleading "authentic review / seed (种草)" content, fake endorsements, fabricated testimonials, or undisclosed paid promotion;
- financial, medical, or legal advice presented as authoritative without a clear disclaimer;
- minors: never depict ambiguous-age subjects in sensitive, romanticized, or risk contexts; require explicit adult confirmation before any human model is used, and never sexualize age ambiguity.

If a prohibited or unremovable item is detected, stop the affected branch and report the blocked category. Do not publish a partial replacement as if it were a clean asset.

## Privacy and Asset Hygiene

For every input image or document:

1. Inspect visible text, logos, QR codes, contact information, documents, screens, and location clues.
2. Inspect metadata when available and remove it from public exports.
3. Reject rather than blur when the sensitive content is central, repeated, or not safely removable.
4. Use neutral placeholders such as `品牌名`, `产品名`, `款号`, `参考图`, `城市街区`, and `中性无标识产品` in reusable templates.
5. Do not embed user files, reference screenshots, generated images, cookies, tokens, local paths, or private URLs in the distributed package.
6. When a platform requires AI-generated-content labeling, apply or preserve the required disclosure mark; do not strip mandatory watermarks or disclosure marks from assets you did not originate.

## Safe Input Contract

Accept only:

- user-owned or permission-cleared product images;
- neutral reference images with no sensitive people, brands, or personal information;
- text describing generic visual properties such as color, fabric, pose, architecture, lighting, and lens;
- fictional or generic models whose age is clearly adult when age matters.

When a real product must be used, require the user to confirm that they own or are authorized to use the product images and marks. Keep the product identity in a user-provided variable; never hard-code a third-party brand as a default.

## Workflow

### Phase 0 — Brand and Asset Intake

Build a neutral brand DNA record using `references/brand_dna_template_public_safe.md`. Capture product category, target audience, colors, materials, scene types, lighting, lens language, pose constraints, and platform format. Store no personal data and no external reference URLs.

### Phase 1 — Style Routing

Select one primary direction and at most one secondary direction from the A–N routing table in `references/style_router_public_safe.md`. For each output, lock:

1. color responsibility and approximate ratio;
2. light source, direction, hardness, and contrast;
3. scene type and three-layer spatial structure;
4. silhouette, materials, accessories, and adult model styling;
5. pose support points, center of gravity, joint direction, and contact shadows;
6. lens, camera height, subject occupancy, crop boundary, and post-processing.

Do not use generic quality words as substitutes for observable photographic decisions.

### Phase 2 — Reference Recreation Audit

When a reference image is provided, use `references/reference_recreation_audit_public_safe.md` before style routing:

1. remove or reject interface pollution;
2. create a composition-anchor card;
3. check spatial geometry before body mechanics;
4. check support, weight, joint direction, contact shadow, and prop tension;
5. score reference fidelity out of 30;
6. modify only the lowest-scoring variable in each iteration.

A result below 24/30, or any one-item rejection condition, cannot enter product integration.

### Phase 3 — Prompt Construction

Use `references/prompt_and_quality_public_safe.md` for prompt structure and the negative-prompt rules. Output separate sections in this order:

1. positive prompt;
2. negative prompt;
3. parameter card;
4. quality fingerprint;
5. safety and rights checklist.

Never mix negative terms into the positive prompt. Use neutral product placeholders in the first smoke test. Do not include real marks, competitor names, celebrity likenesses, or readable signage in reusable prompts.

### Phase 4 — Style Smoke Test

Before product control:

- use a neutral, unbranded placeholder;
- disable product reference control;
- keep the same model, aspect ratio, and tested camera language within a comparison set;
- generate the minimum requested test set;
- score style fidelity out of 24 and editorial quality out of 24 using the inlined thresholds below;
- require at least 20/24 on both scales;
- reject outputs with unsafe content, unremovable text, watermarks, UI, malformed anatomy, or false physical contact.

Style-fidelity dimensions: color responsibility, light direction, scene depth, silhouette/readability, lens consistency, pose support. Editorial-quality dimensions: material texture, contact shadow, framing, expression naturalness, post-processing restraint, absence of AI artifacts.

Only after passing may the user-owned product reference be introduced.

For footwear editorial street-style language (running / trail / outdoor sneakers), see `references/editorial_shoe_streetstyle_presets_public_safe.md`. This preset specializes a high-saturation clashing-sock × emerald grass-slope × geometric-prop collage × Prism light-leak sub-direction; use it as the Phase 4 smoke-test baseline when the user's product is trail / outdoor performance footwear and the target platform favors editorial social-media imagery.

For road-runner / trainer footwear with a city × crew × sun-flare direction, also see `references/urban_run_crewshoot_presets_public_safe.md`. That preset specializes a concrete/glass × group interaction × natural sun-flare × multi-camera sub-direction; use it as the alternative baseline when the user's product is road / trainer / lifestyle running shoes and the target platform favors authentic urban-group social imagery.

### Phase 5 — Product Integration

Require user authorization for the product reference. Keep the approved scene, pose, camera, lighting, and post-processing locks unchanged. Adjust only product controls. Use product-reference controls such as IP-Adapter or contour guidance only when the active platform supports them; never claim a control was applied when it was not.

### Phase 6 — Four-Level Quality Check

Apply:

1. reference fidelity: 24/30 minimum;
2. style fidelity: 20/24 minimum;
3. editorial photography quality: 20/24 minimum;
4. commercial quality: 20/25 minimum after product integration.

One-item rejection conditions from the **Non-Negotiable Publication Gate** override the numeric score. Any blocked category (UI, watermark, QR code, personal data, dangerous pose, severe deformity, infringement) terminates the branch.

## Blocked-Item Handling

When a branch is blocked, emit a short structured report instead of the asset:

- **Blocked category**: one of Content safety / Identity·privacy·rights / Platform·commercial compliance;
- **Reason**: the specific rule violated;
- **Evidence**: what was detected (e.g., readable signage, brand logo, minor present);
- **Action**: `rejected` / `needs user authorization` / `re-shoot with neutral placeholder`.

Never output the asset or claim it passed review when a block is active.

## Safe Generation Rules

- Depict adults only when a human model is requested; never sexualize age ambiguity.
- Avoid dangerous climbing, jumping, traffic exposure, unsafe heights, weapons, criminal activity, and hazardous demonstrations.
- Prefer grounded, physically supported poses with visible contact shadows.
- Keep screens, signs, menus, packaging, and labels unreadable unless the user supplies authorized text and explicitly requests it.
- Do not generate political, religiously provocative, extremist, violent, pornographic, or criminal scenarios.
- Do not imitate a living artist or replicate a protected character, campaign, or advertisement.
- Do not use a celebrity, public figure, or real person for face-swap, deepfake, or likeness synthesis.
- Do not ship or invoke model weights, LoRAs, embeddings, adapters, or conditioning files that encode prohibited identity traits, recognizable real-person likeness, sensitive symbols, or unsafe scenarios; reject the asset when their provenance or content cannot be verified.

## Public-Package Rules

The distributable package must contain only:

- `SKILL.md`;
- neutral reference templates (the `*_public_safe.md` set);
- neutral scoring and audit rules;
- safe workflow documentation;
- a completed `references/public_package_audit.md` record.

No images from user projects, no reference screenshots, no temporary files or hidden metadata, no external links, advertisements, referral language, credentials, or executable network code. Before packaging, run the text and file audit in `references/public_package_audit.md`. A failed audit stops packaging.

### Minimum self-consistent file set

```text
SKILL.md
references/brand_dna_template_public_safe.md
references/style_router_public_safe.md
references/reference_recreation_audit_public_safe.md
references/prompt_and_quality_public_safe.md
references/public_package_audit.md
references/editorial_shoe_streetstyle_presets_public_safe.md
references/urban_run_crewshoot_presets_public_safe.md
```

Any file outside this set is an orphan and must not enter the public package.

## Output Contract

For a completed project, produce only the files requested by the user. For a public skill package, provide:

- a validated zip (official packaging tool, no metadata);
- a publication information sheet (name, version, description, tags, scope);
- an audit report listing checked paths, blocked items, and unresolved limitations;
- a Markdown handoff document with status, completed work, outstanding items, constraints, and complete file list.

Do not state that an image passed visual review when the image could not be displayed or inspected.