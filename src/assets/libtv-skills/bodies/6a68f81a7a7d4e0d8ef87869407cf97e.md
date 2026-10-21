# 小林·四机位全身形体生成

## 用途说明

输入角色正面全身照片或肖像照 + 目标服装描述，以锁定的形体参考图为身材比例基准，分四次独立生成全身四机位图（正面 / 侧面 / 背面 / 45° 副相）。

---

## 形体锁定图节点（固定，禁止替换）

- 正面形体锁定图：`{{i-7swpydcwh24y}}`
- 侧面形体锁定图：`{{i-u7c849ev6ffv}}`
- 背面形体锁定图：`{{i-zp2h59mqbm7u}}`

> **重要说明**：三张图只读身材比例，图中运动背心和短裤不是成衣，不得在生成结果中复现。

---

## 身体数据（Core 1.5.0 冻结，数字禁止改大）

- 身高 175cm / 头高 22.5–23.0cm（7.6–7.8 头身，禁止 9 头）/ 肩宽 36–38cm / 体重 52–55kg
- 胸围 88–90cm / 下胸围 73–75cm / 原生 C+ 水滴胸，上极是坡有重力，自然窄间隙 / 禁止假体 / D 杯 / E 杯
- 腰围 62–64cm / 腹围 64–66cm / 臀围 94–96cm / 腰臀比 0.66–0.67 / 软腹无腹肌
- 蜜桃 C 弧臀，臀下线短而高，浅腰窝 / 禁止梨形下坠 / 极端翘臀
- 大腿围 52–54cm / 膝围 34–36cm / 小腿围 33–35cm / 踝围 19–20cm / 胯高 98–102cm / 腿长视觉占比 56%–58%
- 脚 EU37，脚长 23.3–23.7cm，埃及趾，高足弓，本色甲
- 皮肤暖白象牙半哑光，可见毛孔 / 禁止小麦色 / 橄榄色 / 玻璃皮

---

## 通用躯干提示词（英文，四机位共用）

```
photorealistic full-body studio body-proportion plate of a real 25-year-old East Asian woman, 175cm, 52-55kg, 7.6-7.8 heads (head height 22.5-23.0cm), not 9-head CGI.
cm do not upscale: shoulders 36-38, bust 88-90, underbust 73-75, waist 62-64, mid-abdomen 64-66, hips 94-96, WHR 0.66-0.67, thigh 52-54, knee 34-36, calf 33-35, ankle 19-20, hip height 98-102, visual leg ratio 56-58%.
small head, long neck, high hips, narrow shoulders, soft unmuscular arms.
natural unaugmented C-plus teardrop breasts with gravity, sloped upper pole, modest natural gap, not implants, not D/E.
soft abdomen no six-pack, peach glutes with short high C-crease, shallow Venus dimples, not pear, not extreme booty.
long legs with soft thigh volume 52-54, EU37 feet 23.3-23.7cm, Egyptian toes, high medial arch, natural nails.
pale warm ivory semi-matte skin, visible pores, not tan, not olive.
seamless light-grey cyclorama, 50mm, head-to-toe including feet, living model photograph.
```

---

## 负向提示词

```
implants, D cup, E cup, 9-head, tan, olive, six-pack, stick legs, extreme booty, pear butt, hollow waist, CGI, beauty filter, clothing, costume, dress, bikini, sportswear, sports bra, shorts
```

---

## 工作流步骤

### 第一步：接收用户输入

向用户收集以下两项内容：

1. **角色参考图**：正面全身照或肖像照（用于锁定脸部与整体气质）
2. **目标服装描述**：文字描述，例如"白色真丝衬衫 + 黑色高腰阔腿裤"

收到后，依次执行以下四次生成。

---

### 第二步：生成正面机位图

**引用节点**：正面形体锁定图 `{{i-7swpydcwh24y}}` + 用户角色参考图

**提示词 = 通用躯干提示词 + 以下分镜句 + 用户服装描述**

```
full-body FRONT, facing camera, arms at sides, weight even.
[用户服装描述]
```

**负向提示词**：见上方负向提示词

---

### 第三步：生成侧面机位图

**引用节点**：侧面形体锁定图 `{{i-u7c849ev6ffv}}` + 用户角色参考图

**提示词 = 通用躯干提示词 + 以下分镜句 + 用户服装描述**

```
full-body TRUE 90-degree SIDE. Must show C+ projection with gravity, 62-64 waist, peach C-curve, long leg, high arch.
[用户服装描述]
```

**负向提示词**：见上方负向提示词

---

### 第四步：生成背面机位图

**引用节点**：背面形体锁定图 `{{i-zp2h59mqbm7u}}` + 用户角色参考图

**提示词 = 通用躯干提示词 + 以下分镜句 + 用户服装描述**

```
full-body STRAIGHT BACK. Shallow Venus dimples, peach glutes, high short under-crease, hips not over 94-96.
[用户服装描述]
```

**负向提示词**：见上方负向提示词

---

### 第五步：生成 45° 副相机位图

**引用节点**：正面形体锁定图 `{{i-7swpydcwh24y}}`（主）+ 侧面形体锁定图 `{{i-u7c849ev6ffv}}`（辅）+ 用户角色参考图

**提示词 = 通用躯干提示词 + 以下分镜句 + 用户服装描述**

```
full-body 45-degree three-quarter view, same body, both breast volume and hip C-curve readable.
[用户服装描述]
```

**负向提示词**：见上方负向提示词

---

### 第六步：输出与验证

四张图生成完毕后，同步呈现给用户，提示用户对照形体锁定图验证以下要点：

- 头身比是否在 7.6–7.8 头身范围内（禁止 9 头）
- 腰围视觉是否符合 62–64cm 的纤细比例
- 胸型是否为自然 C+ 水滴，无假体感
- 腿长视觉占比是否在 56%–58%
- 皮肤是否为暖白象牙半哑光，无美颜滤镜感

---

## 重要约束

- 形体数据中所有数字**禁止修改、禁止放大**
- 形体锁定图**只读身材比例**，不复现图中运动背心和短裤
- 角色脸部由用户输入的参考图决定，Skill 不自行生成或替换脸部
- 四张图**独立生成，不合并为拼图**
- 服装描述完全由用户提供，不得自行添加或修改服装内容