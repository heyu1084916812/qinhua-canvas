```markdown
---
name: "character-turnaround"
description: "从剧本提取角色并生成真实质感六视图（全身正/侧/背+大头正/侧/背）单张角色设定图，核心保证六视图是同一个人。"
---

# 真实质感角色六视图生成 SKILL

输入剧本 → 提取角色 → 每个角色输出一张2×3排版的六视图prompt（上排全身三视图，下排大头三视图），所有视图五官/体型/服装严格一致，皮肤真实肌理无AI塑料感。

## 总流程

剧本 → ①角色提取 → ②皮肤肌理 → ③服装扩写 → ④配饰 → ⑤Character ID Block构建 → ⑥六视图单图prompt组装 → ⑦负面词 → 输出

---

## ① 角色提取

从剧本提取每个角色的：性别/年龄/职业/性格/生活状态（熬夜/户外/久坐等）/外貌线索/服装线索/场景环境（季节/温度/地域）。多角色间确保脸型/体型/气质/肤色有明确差异。

## ② 皮肤肌理（六分区参数化）

按以下六区分别描述，禁止笼统写"realistic skin"：

| 区域 | 参数 |
|------|------|
| T区(额头+鼻) | 毛孔密度/油光度/鼻头黑头/鼻翼泛红 |
| 眼周 | 黑眼圈程度位置/眼袋/细纹/血管透出 |
| 面颊 | 毛孔/红血丝/晒斑雀斑/痣(精确位置) |
| 唇周 | 唇纹/干裂/嘴角暗沉/法令纹 |
| 下颌 | 痘印闭口/轮廓松紧/胡茬 |
| 颈部 | 颈纹/锁骨质感/与面部肤色差 |

生活状态自动映射：熬夜→T区油+重度黑眼圈+唇干裂+闭口；户外→鼻头毛孔+晒斑+肤色黑不均+晒痕；久坐→T区微油+眼袋+肤色偏白暗沉；中年男性→鼻翼粗糙+眼袋深纹+法令深+胡茬+颈纹；老年人→全面皱纹+老年斑+皮肤松弛+青筋。

微瑕规则：1-3颗痣精确到解剖位置；痘印集群在下颌/鼻翼/额头；雀斑不对称集中在颧骨>鼻梁；眉毛不对称有杂毛；发际线不规则有碎发；睫毛有交叉长短。

## ③ 服装五维扩写

剧本服装→版型(A字/直筒/oversized等+精确长度+剪裁)→面料(材质+褶皱/光泽/旧化程度)→色彩(主色+辅色+点缀色，禁止单色)→设计细节(领/袖/腰/下摆/五金)→搭配层次(内搭+外层+配饰≥3点)。加穿着状态：褶皱/塞一半/袖口卷/肩线偏。

## ④ 配饰

主角饰1件(视觉记忆点)+辅饰1-2件，每件含：材质/精确身体位置/尺寸/磨损状态，要有角色逻辑(旧戒指磨损内圈/工牌挂绳露卡片角等)。

---

## ⑤ ★ Character ID Block（一致性核心，最重要的模块）

每个角色必须先生成此块，然后在六视图prompt中**完整嵌入两次**（全身排一次、大头排一次），禁止用"same as above"省略。面部特征用英文术语。

```

\[CHARACTER ID — ALL VIEWS MATCH THIS EXACTLY\]\
Name: \[名\]\
Face shape: \[round/square/long/oval/diamond/heart\] + jawline description\
Eye shape: \[almond/downturned/upturned/round/monolid/hooded\] + \[narrow/average/wide\] set + iris color + eyelid type\
Nose: bridge height + tip shape + nostril width\
Mouth: \[thin/full/upper-thin-lower-full/heart-shaped\] + lip color + corners \[flat/upturned/downturned\]\
Eyebrows: shape + asymmetry note (e.g. "right brow slightly higher")\
Skin tone: precise undertone and color variation notes\
Age appearance: apparent age\
Distinguishing marks (appear in EVERY applicable view):

1. \[precise location + description, e.g. "2mm dark mole 1cm below outer LEFT eye"\]
2. \[exact position, e.g. "5mm faint scar on RIGHT jawline near earlobe"\]
3. \[exact position\]\
   Hair: color + texture + length + parting side + hair whorl position\
   Build: height + body type + shoulder width\
   Height proportions: \[e.g. 7.5 head heights\]\
   \[END CHARACTER ID\]

Copy

```

铁锚四件套：脸型+眼形+鼻型+唇形必须极度精确。每个mark必须有精确解剖位置（如"left cheekbone 2cm from nose"，不能只写"face has a mole"）。

---

## ⑥ 六视图单图 Prompt 组装

输出为单张图片，2×3网格：

```

上排: \[全身正面\] \[全身左侧面\] \[全身背面\]\
下排: \[大头正面\] \[大头左侧面\] \[大头背面\]

Copy

```

### 最终Prompt模板（严格按此顺序填充）：

```

CHARACTER DESIGN REFERENCE SHEET, single sheet, 2x3 grid layout,\
pure white background, orthographic turnaround model sheet,\
standardized proportions, alignment guides,

=== ROW 1: FULL BODY TURNAROUND ===\
Three full-body figures in neutral A-pose, evenly spaced,\
same height, feet aligned to same baseline, head tops aligned,\
left to right: FRONT VIEW, LEFT PROFILE VIEW, BACK VIEW.

ALL THREE ARE THE SAME PERSON:\
\[插入完整Character ID Block\]

\-- FRONT VIEW (full body):\
Face: \[脸型+眼+鼻+唇+眉+肤色+所有正面可见marks\]\
Neutral expression, looking at camera,\
Skin texture: \[T区+眼周+面颊+唇周+下颌正面肌理\]\
Clothing: \[服装正面：版型+面料+色彩+细节+搭配+穿着状态\]\
Accessories: \[正面可见配饰，精确位置\]\
Stance: natural, weight even, arms relaxed slightly away from sides, feet shoulder-width,\
Shoes: \[正面\]

\-- LEFT PROFILE VIEW (full body, facing viewer's right):\
Face profile: \[额头弧度→眉骨→鼻梁弧度→鼻尖→嘴唇→下巴→下颌线，量化几何关系如"nose bridge protrudes 1.5cm from facial plane, chin 0.5cm behind lip line"\]\
Visible marks from left side: \[编号列表\]\
Neutral profile expression, gaze forward,\
Side skin: \[颞部+耳前+耳形态耳垂+侧面痣斑\]\
Hair side: \[厚度+层次+鬓角+侧发际线\]\
Clothing side: \[侧面轮廓+侧可见层次+侧面五金\]\
Accessories side: \[侧可见配饰\]\
Shoes: \[侧面\]\
\[PROFILE MUST GEOMETRICALLY MATCH front view face shape proportions\]

\-- BACK VIEW (full body, facing away):\
Hair back: \[发旋位置+后脑发量+发尾+后颈发际线\]\
Back of neck: \[颈纹+后颈皮肤\]\
Clothing back: \[背部剪裁+后袋+后缝+背图+领后\]\
Accessories back: \[背饰可见项\]\
Back stance: \[肩胛骨+脊椎微沟\]\
Shoes: \[背面\]

=== ROW 2: HEAD CLOSE-UP TURNAROUND ===\
Three head-and-shoulders bust shots, evenly spaced,\
same head size, eyes aligned to same horizontal line,\
left to right: FRONT VIEW, LEFT PROFILE VIEW, BACK VIEW.

ALL THREE ARE THE EXACT SAME PERSON as full body row, IDENTICAL FACE:\
\[再次插入完整Character ID Block——必须重复全文\]

\-- FRONT VIEW (head & shoulders):\
Full skin texture detail:

- T-zone: \[毛孔+油光+鼻头+鼻翼\]
- Eyes: \[黑眼圈程度位置+眼袋+细纹+血管\]
- Cheeks: \[毛孔+泛红+晒斑雀斑+所有痣精确位置\]
- Mouth area: \[唇纹+干裂+嘴角+法令纹\]
- Jawline: \[痘印+轮廓+胡茬\]
- Hair details: \[眉毛不对称+杂毛+发际线碎发+睫毛交叉+peach fuzz绒毛\]\
  All marks visible front: \[编号列表\]\
  Neutral expression, looking at camera, soft diffused light revealing skin texture,\
  shoulders relaxed, neck and collarbones visible,\
  \[服装领口可见部分+颈饰\]

\-- LEFT PROFILE VIEW (head & shoulders, facing viewer's right):\
Profile exactly matching body side view: \[额头/眉骨/鼻梁弧度/鼻尖角度/唇突出度/下巴位置/下颌角——量化几何\]\
Side skin: \[颞部+耳前+耳后+侧面痣斑\]\
Ear: \[耳廓形态+耳垂+是否贴头\]\
Side hairline + sideburns, peach fuzz visible in light,\
Side accessories: \[耳钉/眼镜腿\]\
Neck: \[胸锁乳突肌线条\]\
\[PROFILE GEOMETRY MUST MATCH body side view exactly\]

\-- BACK VIEW (head & shoulders):\
Back of head: \[发旋+发量+层次+发尾\]\
Nape: \[颈纹+后颈碎发+后颈肤质\]\
Behind ear: \[耳后痣斑+耳廓背面\]\
\[服装领后部分\]\
\[HEAD SHAPE FROM BACK MUST MATCH front/side proportions\]

=== GLOBAL CONSISTENCY ===\
All six figures are THE IDENTICAL PERSON. Same face, eyes, nose, lips, skin tone, hair, build, clothing across all panels. Every distinguishing mark appears in all views where that area is visible.\
Lighting: unified soft natural light from upper-left 45°, same across all panels.\
Style: photorealistic, hyper-detailed skin texture, subtle film grain, Kodak Portra 400, 85mm lens f/2.8, no airbrushing, no filter, real skin visible in close-ups.\
Pure white background, no environment, no props, no scenery.

Copy

```

### 一致性强制规则

1. ID Block全文出现两次（全身排+大头排），不省略
2. 侧面必须加量化几何约束（鼻突出/下巴位置）
3. 每个视图末尾列出本视角可见的marks编号
4. 对齐指令必写：feet/head tops/eyes aligned to same baseline/line
5. 服装描述拆分到各视角，正面写正面设计、侧面写侧面轮廓、背面写背面独有设计

## ⑦ 负面提示词

```

negative prompt: flawless skin, smooth skin, airbrushed, porcelain skin, plastic texture, doll-like, no pores, wrinkle-free, perfect symmetry, perfect teeth, glowing skin, studio softbox, beauty lighting, ring light, filter, retouch, CGI, 3D model, anime, cartoon, illustration, painting, watercolor, oversaturated, bokeh, movie still, cinematic,\
inconsistent character, face mismatch, different people, identity drift, changing face between views, different eyes/nose/lips between panels, different skin tone between views, different hairstyle between views, different clothing between views, non-matching profiles, extra people, duplicate characters,\
extra limbs, missing limbs, fused fingers, distorted hands, deformed face, misaligned eyes,\
watermark, signature, logo, text, frame borders

Copy

```
角色专属追加：老年→`young looking, smooth wrinkles`；男性→`makeup, lipstick, feminine features`；劳动者→`fashion pose, designer clothes, manicured nails`。

---

## 输出格式（每个角色）

```

# ========================================\
角色：\[名\] | \[性别/年龄/职业/生活状态\] | 场景：\[季节/地域\]

【Character ID Block】\
\[完整ID Block\]

【六视图单图 Prompt】\
\[填充完整的上述模板，含两次ID Block+六个视图+全局一致性+负面词\]

【可见性矩阵】\
特征名 身-正 身-侧 身-背 头-正 头-侧 头-背\
\[mark1\] V P H V P H\
\[mark2\] V V H V V H\
\[服装特征\] V P H H H H\
\[背饰特征\] H H V H H H\
\[发旋\] H P V H P V

【肌理参数表】\[六区参数\]\
【服装设计卡】\[五维描述\]\
【配饰卡】\[主饰+辅饰\]

【两阶段生成（可选）】\
Step1 prompt: \[正面大头照：ID Block + 正面肌理+肩部以上+白底\]→选最佳作reference\
Step2: 用上述六视图prompt + 传入Step1图作character reference（MJ: --cref URL --cw 100; SD: IP-Adapter FaceID weight 0.8-1.0; 可灵/即梦:角色参考功能）\
Step3: 若个别视图漂移，inpainting局部重绘+贴ID Block+must match reference face

========================================

Copy

```

## 排查速查

六张脸不同→ID Block重复两次+用两阶段cref；侧面鼻/下巴变形→加几何量化描述；衣服不一致→拆分正/侧/背服装描述；大头皮肤太完美→大头正面必须含完整六区肌理不能写"same as above"；格子大小不齐→加对齐指令feet/eyes aligned to same baseline；背面头发乱→背面必须描述发旋+发量分布；生成不同姿势→开头加"ORTHOGRAPHIC TURNAROUND, NEUTRAL A-POSE, NOT action poses"。
```