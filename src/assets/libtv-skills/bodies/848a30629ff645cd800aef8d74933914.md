---

## name: classic-broadway-aesthetics namespace: libtv-industry title: "经典百老汇美学" description: "在需要创作经典百老汇音乐剧风格AI短视频时，提供从视觉风格定位、提示词组装、分镜脚本到BGM音效与成片组装的全链路创作指引" version: "1.2"

# classic-broadway-aesthetics

## Skill 定位

- 只负责：将经典百老汇音乐剧美学（1940s至今三大时期）转化为可执行的AI视频创作全链路输出——从风格选型、提示词组装、分镜脚本到BGM/音效/成片组装参数

## 输入

- 需要什么：
  1. 时期偏好（黄金年代1940s-1960s / 现代时期1970s-1990s / 当代时期1990s末-至今），或由用户描述自动判断
  2. 情绪/叙事类型（农场欢庆 / 异域浪漫 / 都市现实 / 童话奇幻 / 历史叙事 / 概念反讽）
  3. 舞台形式（开场序曲 / 群舞踢腿 / 独唱咏叹 / 双人舞 / 终幕大合唱）
  4. 目标时长（90s / 3min）
  5. 可选：指定剧目风格混搭（如 West Side Story / Chicago / Hamilton / The Lion King 等）

## 输入使用

- 严格遵守：
  - 提示词必须按"组合公式"组装：`[时期风格] + [情绪色调] + [舞台形式] + [角色视觉] + [技术参数] + [负面提示词]`
  - 每次生成必须包含时期专属负面 + 全时期通用负面
  - Suno BGM 提交时必须使用英文版 Song Structure
  - 群舞镜头必须含 `ensemble kick-line staircase formation synchronized`
  - 独唱镜头必须含 `single spotlight solo center stage`
  - 舞台镜头必须含 `Broadway theater proscenium arch, orchestra pit visible`
  - 幕布镜头必须含 `deep red velvet curtain sweeping open`
- 只是参考：
  - 具体剧目混搭提示词可根据用户需求灵活组合
  - 分镜时长分配可根据实际素材微调
  - 角色原型可按 `references/` 中对应时期的角色表自定义

## 内部流程和 Knowhow

### 第一步：风格选型与路由

根据用户描述路由到三大时期之一，加载对应参考文件：

时期视觉一眼识别加载参考黄金年代(1940s-1960s)深红+金箔+1950s晚礼服+方阵踢腿+巨型幕布`references/golden-age-shows.md`现代时期(1970s-1990s)黑+烟雾灰+极简黑衣+Fosse微动作+霓虹切割`references/modern-era-shows.md`当代时期(1990s末-至今)全彩LED+多文化融合+街舞+投影映射+高饱和`references/contemporary-era-shows.md`

六大叙事类型路由：

叙事类型对应剧目色调方向农场欢庆Oklahoma!·Carousel金·天蓝·麦田绿异域浪漫South Pacific·The King and I暖橙·金箔·热带绿都市现实West Side Story·Rent砖红·夜蓝·霓虹粉童话奇幻The Lion King·Wicked翡翠绿·金·紫历史叙事Hamilton·Les Misérables暖褐·牛皮纸·铁锈红概念反讽Chicago·Cabaret·Sweeney Todd黑·暗红·烟灰

### 第二步：提示词组装

核心视觉DNA（全时期共通）：

元素中文关键词English Keywords舞台框架镜框式拱形台口·可见乐池Broadway proscenium arch, orchestra pit visible华丽幕布深红丝绒幕布·金色流苏·缓缓拉开deep red velvet curtain gold tassels sweeping open群舞阵列全阵容阶梯踢腿·同步动作ensemble kick-line staircase formation synchronized追光系统聚光灯硬影·戏剧明暗对比stage spotlight theatrical chiaroscuro金色殿堂剧院内部金色装饰·Art Decotheater interior gold decoration Art Deco管弦乐池乐手可见·指挥剪影orchestra pit conductor silhouette musicians

技术参数标准：

- 画幅：2.39:1 变形宽画幅（Letterbox裁切至1920×803）
- 帧率：24fps标准 / 120fps慢动作段落
- 胶片质感：黄金年代16mm颗粒 / 现代时期35mm / 当代时期数字干净

负面提示词（全时期通用）：

```
CGI cartoon, low quality, blurry, amateur, anime style, 3D render, fake looking, real person face, violence, explicit content, outdoor concert, stadium rock, casual clothing, street dance only
```

时期专属负面（叠加到通用负面前面）：

- 黄金年代：`neon LED screen digital projection modern technology hip-hop rap minimalist black stage`
- 现代时期：`bright cheerful warm gold 1950s vintage big production spectacle`
- 当代时期：`1950s vintage warm analog classical only traditional ballet single culture low saturation`

组装示例（黄金年代 × 农场欢庆 × 群舞踢腿）：

```
[EN] Classic Broadway Golden Age aesthetic, lavish musical theater proscenium arch,
deep red velvet curtain sweeping open warm gold spotlight flooding,
1950s evening gowns and bowtie suits, full cast staircase kick-line formation,
golden stage archway orchestra pit visible,
vintage film texture 2.39:1 anamorphic widescreen 16mm film grain
-- negative: neon LED screen digital projection modern technology hip-hop, CGI cartoon low quality blurry amateur anime style 3D render fake looking real person face

[CN] 经典百老汇黄金年代风格，华丽音乐剧镜框舞台，
深红丝绒幕布缓缓拉开暖金追光满场，
1950s晚礼服与领结西装，全阵容阶梯踢腿阵列，
金色舞台拱顶可见乐池管弦乐队，
复古胶片质感 2.39:1变形宽画幅 16mm胶片颗粒
-- 负面：霓虹灯LED屏幕数字投影现代技术嘻哈, CGI卡通 低质量 模糊 业余 动漫风格 3D渲染 虚假 真实人脸
```

### 第三步：分镜脚本创作

90秒标准结构（五幕式百老汇叙事弧）：

段落时长叙事功能镜头核心BGM段落开场序曲10s建立剧场仪式感乐池→幕布关闭→骤开→全阵容亮相序曲Overture群舞登场20s建立世界与社区踢腿阵列→阶梯排列→领舞追光开场曲全编制独唱咏叹20s角色内心情感追光独照→暗场→高音全亮咏叹调Ballad双人舞15s情感对手戏舞台中央→华尔兹→影子投幕后双人舞Duet终幕大合唱20s情感高潮与收束全员盛装→管弦爆发→幕布合拢终曲Finale谢幕5s仪式性结尾幕布重开→鞠躬→掌声Reprise

分镜表格标准格式及3分钟扩展版详见 `references/storyboard-guide.md`。

### 第四步：BGM生成

使用Suno生成BGM，6种风格模板详见 `references/music-and-sound.md`：

编号BGM类型时期BPMKey#1序曲Overture黄金年代90-130D major→Bb major#2咏叹调Ballad黄金年代60-80F major→A major#3Fosse爵士现代时期70-100F minor→Eb minor#4多媒体融合当代时期100-140G minor→C major#5群舞踢腿全时期120-140C major#6谢幕Curtain Call全时期100-120原Key major

### 第五步：成片组装

时间线参数：

- 视频轨道：主画面(V1) + 转场叠层(V2) + 字幕(V3)
- 音频轨道：BGM(A1) + 音效(A2)
- 每段BGM对齐对应段落首帧，音效对齐关键动作帧

转场清单（8种百老汇舞台转场）：

转场术语使用场景剪辑参数幕布转场Curtain Transition场景切换/幕间0.5-1s Ease-in-out追光切换Spotlight Crossfade独唱→双人舞→群舞0.3-0.5s Hard cut黑场骤亮Blackout to Full序曲高潮/终幕0.5s Linear ramp旋转台切换Turntable Transition戏剧段落转换1-2s Rotate Y花瓣雨Magical Dissolve终幕庆祝/梦境1-2s Particle镜面反射Mirror Transition裸舞台概念剧0.8-1.5s Mirror morph文件翻页Parchment Wipe历史叙事0.5-1s Page turn霓虹闪烁Neon Flicker都市现实0.3-0.8s Flicker cut

导出参数：

- 格式：MP4（H.264）
- 分辨率：1920×1080（Letterbox裁切至2.39:1→画面1920×803）
- 帧率：24fps
- 音频：AAC 320kbps / 48kHz
- 色彩空间：Rec.709
- 片头片尾各留1秒黑场缓冲

### 常见错误与避坑

常见错误原因解决方案像普通晚会而非百老汇缺剧场框架+幕布仪式首镜必须含 proscenium arch群舞画面混乱缺秩序关键词必须加 ensemble kick-line synchronized像户外演唱会缺剧场内部元素必须含 theater interior orchestra pit时期风格混淆负面提示词未加时期排斥每次必须组合时期专属负面+通用负面Suno生成效果差Song Structure用中文必须使用英文提交版角色跨镜不一致无人设卡建立角色卡：颜色绑定+发型绑定+姿态绑定

## 输出

- 中英双语AI视频提示词（含负面提示词）
- 完整分镜脚本表格（含每镜AI提示词中英双版）
- Suno BGM提示词（英文提交版，含BPM/Key/Structure）
- 音效标注清单（含混音比例）
- 成片组装参数建议（含转场清单+导出参数）

## 自检

- \[ \] 提示词是否含 "proscenium arch theater stage"（剧场感）？
- \[ \] 群舞镜头是否含 "ensemble kick-line staircase formation synchronized"？
- \[ \] 独唱镜头是否含 "single spotlight solo center stage"？
- \[ \] 幕布镜头是否含 "deep red velvet curtain sweeping open"？
- \[ \] 是否包含时期专属负面提示词 + 全时期通用负面？
- \[ \] Suno BGM 是否使用英文提交版 Song Structure？
- \[ \] 分镜是否覆盖五大舞台形式（序曲/群舞/独唱/双人舞/终幕）？
- \[ \] BGM与音效混音比例是否参照标准表？
- \[ \] 视频时长是否在 16s-5min 范围内？
- \[ \] 分辨率是否 ≥ 1080p？
- \[ \] 主体形象跨镜头一致性是否 &lt; 3处不一致？
- \[ \] 是否无AI瑕疵（面部崩坏/文字乱码/肢体穿模）？
- \[ \] 内容安全合规（无血腥暴力/软色情/违规元素）？

## Ask User

- 用户未指定时期时：询问偏好（黄金年代/现代时期/当代时期）
- 用户未指定情绪类型时：根据描述推荐并确认
- 用户要求混搭剧目风格时：确认目标剧目和混搭程度
- 用户未指定时长时：默认90s，询问是否需要3min扩展版
- 生成结果不满意时：询问具体方向（视觉风格/音乐节奏/分镜结构/转场效果）