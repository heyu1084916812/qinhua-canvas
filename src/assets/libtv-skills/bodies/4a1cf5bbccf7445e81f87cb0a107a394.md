# 人像转白底棚拍图

## 目标

输入一张人物参考图，保留该人物的面部特征、发型、肤色、气质，生成白底全身棚拍风格图，服装替换为用户指定的目标穿搭。

## 输入

- **人物参考图**（`{{ref_image}}`）：提供人物面部/形象参考，可以是户外、自然场景、特写或半身照

## 执行步骤

### 步骤 1：创建图片生成节点

- **节点类型**：图片节点
- **上游输入**：连接 `{{ref_image}}`（作为人物形象参考）
- **生成目标**：白底全身棚拍图，9:16 竖版比例

**Prompt 模板：**

```
{{ref_image}}, 1girl, [目标服装描述，例如：blue lace camisole top, light blue denim shorts, beige sandals],
full body, front-facing pose, facing directly toward camera, arms naturally hanging down at sides, no side pose,
studio shot, white background,
clean and bright lighting, fashion photography style,
high detail, realistic, no text, no watermark
```

**锚点（固定不变的工艺要求）：**

参数值说明背景white background纯白底构图full body, front-facing pose, facing directly toward camera全身正面对镜头姿态arms naturally hanging down at sides, no side pose双手自然下垂，不侧身比例9:16竖版出图风格studio shot, fashion photography style棚拍时尚摄影光线clean and bright lighting干净明亮的棚拍光质量high detail, realistic高细节写实

**槽位（每次可替换）：**

- `{{ref_image}}`：人物参考图，决定面部/发型/气质
- `[目标服装描述]`：本次要展示的服装穿搭，用英文描述具体单品和颜色（如 `blue lace camisole top, light blue denim shorts, beige sandals`）

## 输出

白底全身棚拍图（9:16 竖版），人物正面对镜头、双手自然下垂，人物形象与参考图一致，服装为目标穿搭。

## 注意事项

- 参考图建议使用清晰的人物面部/半身照，面部特征越清晰，还原度越高
- 服装描述越具体（颜色、材质、款式），生成效果越准确
- 姿态已固定为正面站姿+双手自然下垂；如需其他姿态，可修改 prompt 中的姿态描述部分
- 本 Skill 提炼自画布节点：人物参考图 `i-GGEl9gHhZq`（户外人像特写）→ 白底棚拍图 `i-zUHRjNb29E`