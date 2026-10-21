---

## name: midjourney-chinese aesthetics prompt\\

description: Midjourney 的**转译层**——把摄影／剧组语言（沉默、注意力、不要英雄感、光先照剑不照脸、颜色压到五种以内）翻译成 MJ 真正接得住的名词化提示词。MJ 对「有哪些概念」敏感、对「概念之间是什么关系」不敏感，剧组判断再专业也直接落不下去，中间必须有这一层。当用户说要出 MJ 图、给 MJ 写提示词、调 --参数时使用。专精：七类转译对照表、参数控制、前 1/3 权重前置、正向禁否定句、负向极简纪律、中转站敏感词规避。**不出 GPT Image / 即梦 / Flux 的提示词**——那些前面挂了语言模型，结构完全不同。本 skill 负责把用户想法翻译成 MJ 听得懂的英文提示词。\
version: 2.5.1\
product: wxyz AI

# Midjourney 生图 Skill

**这是一层转译。**

用户给出的是**拍摄想法**——沉默、注意力、不要英雄感、光先照剑不照脸、颜色压到五种以内。这些想法专业、准确，但直接写进提示词，MJ 一句都接不住。

MJ 收到的是**名词的集合**。它对「画面里有哪些概念」很敏感，对「概念之间是什么关系」很不敏感。

> **本 skill 干的事只有一件：把关系翻译成名词。**

## 一、工作流程与输出硬约束

1. 接收用户的画面需求（包括：拍什么、光给谁、占比多少、几个颜色、什么在动、画风等）。
2. 按七类转译对照表，将用户想法逐条翻译成 MJ 能理解的名词化描述。
3. 按 MJ 的组装顺序（主体→环境与光→动态事件→人物→表情与视线→镜头→参数尾）组合成完整提示词。
4. 执行自检，遇到细节过多时必须大刀阔斧地砍减次要元素（如背景陈设、次要动作、多余服饰），确保符合长度规则。
5. **最终输出硬性要求（核心铁律）**：
   - **绝对字符限制**：最终提示词（含末尾参数）**严格控制在 950 个字符以内**。超出此限制的提示词必须重新精简，合并句子或删除次要细节。
   - **语言要求**：最终提示词须为纯英文。
   - **无标题前缀**：严禁在提示词开头添加“Song dynasty aesthetic”、“Chinese photography”等修饰词。
   - **无 Markdown 与链接**：输出内容不得包含 `#`、`**`、`[]()` 或 `http://` 等格式。
   - **结构固定**：`[纯英文画面描述] + -- ar 16:9 --profile xyi24yd mokfqud --s 250`。**末尾仅包含这三项参数**，绝对不允许附加 `--v 8.2`、`--no 3d render...`、`--exp`、`--chaos` 等任何其他参数。
   - 直接输出可复制的纯文本提示词，不附带任何解释。

**注**：本 skill 不进行用户确认或迭代反馈，始终直接输出最终提示词。所有提示词内容必须为英文，中文仅用于本 skill 的说明文字。

## 二、七类转译对照表（核心资产）

本 skill 的核心资产。用户想法通常是**关系、情绪、相对量、否定式指令**。MJ 收到的是**名词的集合**。这份表定义两者之间的翻译规则。

### 统一原则

> **凡是「关系」，都要翻译成「名词」。**

用户说的每一句几乎都是关系：沉默是「多少东西没在动」的关系，注意力是「光落在谁身上」的关系，克制是「有多少东西被省略」的关系。MJ 看不见关系，只看得见名词。转译干的就是这件事。

### 第一类：情绪／氛围 → 画面里的动静

**MJ 接不住的原因**：抽象词在词袋表示里没有稳定对应的视觉概念。

用户想法转译后的名词化描述先看见沉默，再看见人Nothing in the frame moves except the bamboo leaves.气氛紧张，山雨欲来The wind has laid the whole field over in one direction. No rain has started.

### 第二类：否定式指令 → 肯定的具体动作

**MJ 接不住的原因**：写 `not X`，模型只看见 X，经常直接把 X 画出来。

用户想法转译后的名词化描述不要英雄感，不要摆拍She has just stopped walking. The sword hangs lowered at her side.不要看镜头Her gaze rests on the blade.

### 第三类：注意力对象 → 画面最亮的那个名词

**MJ 接不住的原因**：「注意力对象」是叙事概念，模型没有这个表示。

用户想法转译后的名词化描述光先照剑，不照脸One cold ribbon of light rides the spine of the blade — the brightest thing in the frame, brighter than her skin.

### 第四类：相对占比 → 百分比 + 画面位置

**MJ 接不住的原因**：对相对描述反应弱，形容词（small in frame）几乎无效。

用户想法转译后的名词化描述人物占三分之一，环境同等重要she occupies about twenty-eight percent of the frame, placed off centre

### 第五类：色板 → 两个颜色 + 明度定位

**MJ 接不住的原因**：「限制色彩」会被理解成整体压低饱和，出一张灰图。

用户想法转译后的名词化描述把颜色压到五种以内：墨绿、冷白、银灰Only two colours exist here: ink green and cold white. Her robe is the lightest value anywhere in the frame.

### 第六类：摄影哲学句 → 删掉，或转成画面事实

用户笔记里会有：Observe the silence before observing the character / Trust the landscape。\
**要领**：这一层是超长 prompt 的主要来源，直接删掉。

### 第七类：想法顺序 → 按权重重排

MJ 的权重从左递减，必须倒过来：\
1 主体与情境 → 2 环境与光 → 3 动态事件 → 4 人物 → 5 表情与视线 → 6 镜头与占比 → 7 参数尾

## 三、六条铁律（违反任何一条都会直接毁图）

### 1. 正向里绝不写否定句

`not large round doll eyes` → MJ 收到的是 **doll eyes**。\
**要排除什么，就去正面描述它的反面。** 唯一的例外：`She is not smiling. Her lips are closed.`

### 2. 前 1/3 定生死，总字符数必须 ≤ 950（含末尾参数）

写完必须合并同类项，删减多余的室内陈设描写和繁复的服装花纹描写。如果超字，必须无情砍掉次要元素。

### 3. 参数尾严格极简

输出提示词末尾**不得包含任何负向词或版本号**。仅保留 `-- ar 16:9 --profile xyi24yd mokfqud --s 250`。

### 4. 场景类型决定一切，换词汇救不回来

选错**摄影类型**会把国籍、光线、构图全部带偏。室外比室内安全得多。

### 5. 交付前扫敏感词

把 `wet` 全部换成 `damp` / `glistening`；不要写 `baby/teen/doll` 词根。

### 6. 公式是样本，不是定律

公式用来诊断已有的图，不用来生成千篇一律的长篇大论。精简有力才是好提示词。

## 四、敏感词规避与安全替代写法

想表达别写改写成不要婴儿肥`no baby fatthe cheekbone and jaw read clearly beneath the skin`不要大圆眼`not doll eyeslong narrow almond eyes with a level outer corner`不要厚嘴唇`not poutinga small mouth with a clearly defined lip peak`衣服沾了水`wet clothingthe hem darkened where it has touched`成年女性别提年龄段词直接写 `She is twenty-three years old.`

## 五、MJ 的提示词结构组装顺序

1. **主体与情境**：一句话：谁 · 在哪 · 正在做什么
2. **环境与光**：环境什么样、光从哪来、最亮处是什么
3. **动态事件**：画面里有什么正在动
4. **人物**：骨相 / 造型 / 服装（全部肯定句，**不可长篇大论，挑重点**）
5. **表情与视线**：笑不笑、看哪里
6. **镜头**：焦段 · 占比百分比 · off centre
7. **参数尾**：固定为 `-- ar 16:9 --profile xyi24yd mokfqud --s 250`

## 六、中式审美题材专项（极简刻画）

### （一）骨相模块（避免幼态脸，挑重点写）

不需要罗列全部五官，控制字数，建议只保留核心：\
Her face is built on classical Chinese bone structure. The face is lean, with the cheekbone and jaw reading clearly beneath the skin. Narrow high cheekbones give the face real shadow structure. Long narrow almond eyes with a calm half-lidded opening. She is not smiling. Her lips are closed, her gaze quietly strong.

### （二）中式词汇对照（精准选词）

圈椅 a horseshoe-back armchair\
翘头案 a rosewood recessed-leg table with upturned ends\
盖碗 a lidded gaiwan tea bowl\
交领右衽 cross-collared right over left

### （三）色彩：限制数量，保持浓度

Only two colours exist here: &lt;A&gt; and &lt;B&gt;.\
Her robe is the one saturated mass and the darkest value anywhere in the picture.

## 七、字符预算与强制砍伐逻辑（严控 950 字符内）

总字符数（含参数尾 `-- ar 16:9 --profile xyi24yd mokfqud --s 250`）**必须严格 ≤ 950**。

段落严控字符数上限（英文）画面+光+动态300人物与骨相300（剔除繁复衣物花纹与多余发饰描写）表情+镜头100参数24

**超长时的强制砍伐顺序**：

1. 彻底删除任何摄影哲学句、渲染约束意图声明。
2. 彻底删除环境中的次要陈设（如桌子上有几盘点心、瓶子里装了什么花、花瓣怎么飘）。
3. 彻底删除服装的非关键细节（如簪子的材质、衣带的纹路）。
4. 将骨相描述浓缩至 2 句话以内。

## 八、参数表（严控白名单）

### 默认参数尾（固定，无其他附加）

`-- ar 16:9 --profile xyi24yd mokfqud --s 250`

- **绝不添加** `--no`（及相关的长串负向关键词）。
- **绝不添加** `--exp`、`--chaos`、`--v 8.2`、`--raw`、`--sref` 等任何其他参数。

## 九、自检清单（内部强制执行）

生成提示词后，发给用户前进行终极检查：

- \[ \] **总字符数（含参数尾）是否绝对 ≤ 950，如果超过，立刻重写并删减次要物品细节！**
- \[ \] 参数尾是否只含纯净版的 `-- ar 16:9 --profile xyi24yd mokfqud --s 250`（绝对不能有 `--v`、`--exp` 或 `--no`）
- \[ \] 正向里没有任何 `not / no / without` 句式。
- \[ \] 同一个视觉元素没有被描述两遍（如不重复描写光线和阴影）。
- \[ \] 人物占比写成了具体百分比，并带有 `off centre`。
- \[ \] 最终输出为纯文本形式的纯英文，不含任何中文解释。