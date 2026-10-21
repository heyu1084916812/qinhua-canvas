# 高端剪纸海报生成器

## Skill 简介

将用户上传的一张照片，生成一张 **3:4 竖版高端编辑海报**。海报严格分为上下两半：

- **上半（50%）**：保留原始照片，仅做高端摄影色彩调色
- **下半（50%）**：从照片中提取核心主题，重构为极简手工层叠剪纸纸雕拼贴

每张照片单独输出，不做多图拼贴。

---

## 工作流

### 节点 1：接收用户上传图片

- **类型**：图片输入节点
- **槽位**：`{{user_photo}}` — 用户上传的照片（建筑、人物、风景、城市天际线等均可）

---

### 节点 2：生成高端剪纸海报

- **类型**：图片生成节点
- **输入**：节点 1 的图片（`{{user_photo}}`）
- **输出**：3:4 竖版高端剪纸海报图片

Prompt 模板

```
A high-end editorial poster in strict 3:4 vertical format, divided into two perfectly equal halves (exactly 50% top / 50% bottom), no collage of multiple photos, single image output.

TOP HALF (50% of total height): The original photograph {{user_photo}}. Preserve all original elements, realistic textures, natural light and shadow, and original color atmosphere. Apply only subtle high-end photographic color grading to evoke the feel of art magazines, independent publications, and exhibition photography. You may naturally extend the sky, ground, or environmental background to fit the frame, but do not stretch, distort, or alter the main subject.

BOTTOM HALF (50% of total height): Extract the most recognizable subject, silhouette, pose, and narrative relationships from the photograph. Reconstruct them into minimalist handcrafted layered paper-cut and paper sculpture collage. Use one core subject as the visual anchor — reinterpret its key silhouette, proportions, and structure through folding, cutting, layering, and masking, without mechanically copying details. Select a few environmental relationships from the original image and transform them into foreground, midground, and background paper layers. Establish clear hierarchy through scale differences, axes, positive/negative shapes, front-back masking, and large areas of negative space, making the subject instantly recognizable while embodying the restraint and order of modern editorial composition.

COLOR PALETTE: Extract the most recognizable and vivid colors from the photograph above. Transform them into a limited, harmonious paper combination. Use warm ivory or light-colored paper as the base, and build space through primary colors, dark structural tones, light layering, and minimal accent colors. Use fine matte cardstock, visible paper fibers, clean edges, and soft contact shadows with natural diffused light to highlight the thickness of folded layers and authentic handcrafted texture. Avoid plastic 3D effects, cheap cardstock, neon colors, and complex gradients.

TYPOGRAPHY: Build a complete high-end editorial micro-typography system. Distill a short main title from the subject's identity, location, action, material, atmosphere, or symbolic meaning in the photograph. Pair it with 2–4 groups of very small supporting text, flexibly combining object names, location information, numbers, chapter markers, serial numbers, coordinate-style numerals, directional words, status words, material terms, category labels, or a very short poetic annotation. Do not use years. The main title handles recognition and emotion; the small text handles order, rhythm, and refinement.

Typography must be integrated with the paper-cut graphics in the composition — align along paper layer edges, subject silhouettes, geometric axes, or negative space; use horizontal/vertical layout, rotation, wide letter-spacing, edge alignment, corner anchoring, cross-color-block placement, paper layer embedding, or interact with the subject through masking and interweaving. The main title may moderately transform into paper-cut or origami letterforms, while small text maintains slender, restrained modern editorial typography. Use size contrast and directional shifts to form a reading path, ensuring the paper-art treatment remains visually dominant.

Output: single image, 3:4 vertical format, no borders, no frames, no watermarks.
```

---

## 锚点（固定工艺，不随输入变化）

锚点值画面比例严格 3:4 竖版上下分割严格 50% / 50%，不可偏移上半处理保留原图结构，仅高端摄影调色下半风格极简手工层叠剪纸 + 纸雕拼贴纸张质感细腻哑光卡纸、可见纸纤维、柔和接触阴影禁止项多图拼贴、塑料3D效果、霓虹色、复杂渐变、年份文字排版系统主标题（情感/认同）+ 2–4组极小辅助文字（秩序/节奏）

## 槽位（随输入变化）

槽位说明`{{user_photo}}`用户上传的照片，决定上半原图内容、下半剪纸主题提取、色彩调色板来源

---

## 参考产出示例

- **中式楼阁夕阳** — 上半保留多层古典楼阁暖橙夕阳，下半提炼楼阁轮廓为暖色剪纸层叠，配以极简汉字主标题与坐标式辅助文字
- **欧式庄园黄昏** — 上半保留法式新古典庄园蓝调黄昏，下半提炼对称立面与喷泉为冷调剪纸层叠，配以英文主标题与章节式辅助文字
- **纽约夜景天际线** — 上半保留曼哈顿摩天楼群与布鲁克林大桥黄金时刻，下半提炼天际线轮廓与桥塔为深色剪纸层叠，配以城市坐标式辅助文字与极简英文主标题