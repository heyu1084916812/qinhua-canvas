/**
 * 创作面板的「预设」（用户 2026-10-05 第 14 条）。
 *
 * ## 一份数据，三处消费
 *
 * 这里只有**一份**预设表，面板、提示词拼装、单测都读它：
 * - 面板按 `category` 分栏铺菜单（`PRESET_CATEGORIES` 的顺序就是菜单里的顺序）；
 * - `hint` 只给界面当示例小字（用户原话「不是真实的小字」= 那行字不进请求）；
 * - `prompt` 才是**真的会被拼进提示词**的那句，由 `presetPromptSuffix` 统一拼。
 *
 * 为什么不让界面自己拼提示词：那样「界面上写了什么」和「实际发出去什么」会变成两份，
 * 迟早对不上（本项目对这类「两处口径」有明确教训）。界面只负责选 id。
 */

export type PresetCategoryId = 'story' | 'camera' | 'design' | 'texture'

export interface PresetChoice {
  id: string
  label: string
}

/** 二级搭配的一组（图十九那样：一组三个档，默认取中间那档） */
export interface PresetOptionGroup {
  id: string
  label: string
  choices: readonly PresetChoice[]
}

export interface PresetDef {
  id: string
  name: string
  category: PresetCategoryId
  /** 界面上的示例小字（**不进提示词**） */
  hint: string
  /** 真正拼进提示词的那句 */
  prompt: string
  /** 二级搭配；有它的预设会把选择结果拼进那句提示词 */
  options?: readonly PresetOptionGroup[]
}

export const PRESET_CATEGORIES: readonly { id: PresetCategoryId; label: string }[] = [
  { id: 'story', label: '分镜叙事' },
  { id: 'camera', label: '空间与机位' },
  { id: 'design', label: '设定图' },
  { id: 'texture', label: '质感调节' },
]

/** 「人像质感调节」的二级搭配（图十九五组，每组三档） */
const PORTRAIT_OPTIONS: readonly PresetOptionGroup[] = [
  {
    id: 'fusion',
    label: '人景融合',
    choices: [
      { id: 'light', label: '轻度对齐' },
      { id: 'natural', label: '自然融合' },
      { id: 'deep', label: '深度融合' },
    ],
  },
  {
    id: 'light',
    label: '光影融合',
    choices: [
      { id: 'soft', label: '柔和补光' },
      { id: 'natural', label: '自然匹配' },
      { id: 'mood', label: '氛围强化' },
    ],
  },
  {
    id: 'skin',
    label: '皮肤',
    choices: [
      { id: 'clear', label: '清透修饰' },
      { id: 'natural', label: '自然肤质' },
      { id: 'real', label: '真实肌理' },
    ],
  },
  {
    id: 'grain',
    label: '纹理',
    choices: [
      { id: 'soft', label: '柔和纹理' },
      { id: 'natural', label: '自然纹理' },
      { id: 'grainy', label: '颗粒质感' },
    ],
  },
  {
    id: 'sharp',
    label: '锐度',
    choices: [
      { id: 'soft', label: '柔焦' },
      { id: 'standard', label: '标准清晰' },
      { id: 'high', label: '高清锐化' },
    ],
  },
]

export const PRESETS: readonly PresetDef[] = [
  // ── 分镜叙事 ──
  {
    id: 'shot-list',
    name: '调度故事板',
    category: 'story',
    hint: '描述一个 10–15 秒内能演完的小剧情片段，可补充角色、场景、道具、动作、走位与对白',
    prompt: '输出调度故事板：4–6 格中文手绘分镜，每格标出景别、角色走位与动作过程',
  },
  {
    id: 'storyboard',
    name: '故事板',
    category: 'story',
    hint: '一句话说清这一镜发生了什么，重点是构图与动作',
    prompt: '输出单幅故事板分镜：标出景别、机位与画面内的动作说明',
  },
  {
    id: 'storyboard-25',
    name: '25宫格连贯分镜',
    category: 'story',
    hint: '同一角色与场景，5×5 共 25 格逐格推进的连续剧情',
    prompt: '输出 5×5 共 25 格连贯分镜：同一角色与场景逐格推进剧情，格与格之间动作连续',
  },
  {
    id: 'beats-4',
    name: '剧情推演四宫格',
    category: 'story',
    hint: '起承转合各一格，2×2 讲完一段剧情节拍',
    prompt: '输出 2×2 剧情推演四宫格：起、承、转、合各一格，讲完一段完整的剧情节拍',
  },
  {
    id: 'later-3s',
    name: '画面推演 — 3 秒后',
    category: 'story',
    hint: '预测当前画面 3 秒之后的同一镜头',
    prompt: '推演当前画面 3 秒之后的同一镜头：人物、服装、光线与环境保持一致，只推进动作',
  },
  {
    id: 'earlier-5s',
    name: '画面推演 — 5 秒前',
    category: 'story',
    hint: '倒推当前画面 5 秒之前的同一镜头',
    prompt: '倒推当前画面 5 秒之前的同一镜头：人物、服装、光线与环境保持一致，只回溯动作',
  },
  // ── 空间与机位 ──
  {
    id: 'panorama-720',
    name: '720 全景',
    category: 'camera',
    hint: '生成一张可以环视的等距柱状全景图',
    prompt: '生成 360° 全景场景图：等距柱状投影（2:1），地平线保持水平，左右首尾可无缝衔接',
  },
  {
    id: 'multicam-9',
    name: '多机位九宫格',
    category: 'camera',
    hint: '同一场景同一时刻，3×3 九个不同机位',
    prompt: '输出 3×3 多机位九宫格：同一场景同一时刻的九个机位（远景 / 全景 / 中景 / 近景 / 特写与高低角度），角色与光线一致',
  },
  // ── 设定图 ──
  {
    id: 'face-turnaround',
    name: '角色脸部三视图',
    category: 'design',
    hint: '同一张脸的正脸 / 侧脸 / 半侧，纯色背景',
    prompt: '输出角色脸部三视图：正脸、侧脸、半侧脸并排，同一角色同一光照，纯色背景',
  },
  {
    id: 'body-turnaround',
    name: '角色三视图',
    category: 'design',
    hint: '正面 / 侧面 / 背面全身，纯色背景',
    prompt: '输出角色三视图：正面、侧面、背面全身立绘并排，同一角色同一光照，纯色背景',
  },
  {
    id: 'character-sheet',
    name: '角色设定图',
    category: 'design',
    hint: '全身立绘 + 服装、配色与关键配件说明',
    prompt: '输出角色设定图：全身立绘为主，附服装、配色与关键配件的说明，纯色背景',
  },
  {
    id: 'scene-sheet',
    name: '场景设定图',
    category: 'design',
    hint: '同一场景的广角主视图 + 关键细节',
    prompt: '输出场景设定图：广角主视图加关键局部细节，标注时间、天气、光源方向与材质',
  },
  {
    id: 'product-sheet',
    name: '产品设定图',
    category: 'design',
    hint: '产品多角度视图，棚拍布光，纯色背景',
    prompt: '输出产品设定图：正面 / 侧面 / 背面 / 局部细节的多角度视图，棚拍布光，纯色背景',
  },
  // ── 质感调节 ──
  {
    id: 'portrait-texture',
    name: '人像质感调节',
    category: 'texture',
    hint: '写实人像摄影质感，可按 5 组搭配微调',
    prompt: '写实人像摄影质感',
    options: PORTRAIT_OPTIONS,
  },
  {
    id: 'cinematic-light',
    name: '电影级光影校正',
    category: 'texture',
    hint: '电影感光影修正，低饱和电影调色',
    prompt: '电影感光影修正：层次分明的柔和光影、克制的高光与低饱和电影调色',
  },
]

export function presetById(id: string | undefined | null): PresetDef | undefined {
  if (!id) return undefined
  return PRESETS.find((p) => p.id === id)
}

/** 二级搭配的默认值 = **每组中间那档**（图十九里高亮的都是中间那档） */
export function defaultPresetOptions(preset: PresetDef): Record<string, string> {
  const out: Record<string, string> = {}
  for (const g of preset.options ?? []) {
    const mid = g.choices[Math.floor(g.choices.length / 2)]
    if (mid) out[g.id] = mid.id
  }
  return out
}

/**
 * 把「预设 + 它的二级搭配」拼成一句提示词。
 *
 * 搭配缺项 / 取值不认识时**退回中间那档**，不把 `undefined` 拼进提示词 ——
 * 老数据里可能只有 preset 没有 options（功能上线前后建的节点）。
 */
export function presetPromptOf(
  presetId: string | undefined | null,
  options: Record<string, string> | undefined,
): string {
  const preset = presetById(presetId)
  if (!preset) return ''
  if (!preset.options || preset.options.length === 0) return preset.prompt
  const parts = preset.options.map((g) => {
    const picked = (options ?? {})[g.id]
    const choice =
      g.choices.find((c) => c.id === picked) ?? g.choices[Math.floor(g.choices.length / 2)]
    return `${g.label}「${choice?.label ?? ''}」`
  })
  return `${preset.prompt}：${parts.join('、')}`
}

/**
 * **情绪**（第 14 条后半）：25 个点位，五个一排。
 *
 * 坐标就是面板上那个 5×5 点阵的行列（`row` / `col` 从 0 开始），
 * 名称顺序**严格照用户给的那五行**——顺序既是点位也是语义（左近右疏、上激动下平静）。
 */
export interface EmotionDef {
  id: string
  name: string
  /** 0 = 最上一排（激动） */
  row: number
  /** 0 = 最左一列（亲近） */
  col: number
}

const EMOTION_ROWS: readonly (readonly [string, string][])[] = [
  [
    ['joyous', '欣然愉悦'],
    ['startled', '骤然错愕'],
    ['shaken', '惊魂未定'],
    ['heartstop', '心跳骤停'],
    ['raging', '暴怒沉怒'],
  ],
  [
    ['smiling', '浅然莞尔'],
    ['disbelief', '难以置信'],
    ['recoil', '受惊后退'],
    ['bracing-grief', '强忍悲戚'],
    ['simmering', '隐忍愠怒'],
  ],
  [
    ['gazing', '含情凝望'],
    ['hesitant', '欲言又止'],
    ['serene', '淡然自若'],
    ['alert', '警觉审视'],
    ['frost-brow', '眉宇凝霜'],
  ],
  [
    ['doting', '满眼宠溺'],
    ['helpless', '万般无奈'],
    ['nostalgic', '触景伤情'],
    ['silent-hurt', '隐忍心伤'],
    ['cold-eyes', '冷眼默然'],
  ],
  [
    ['sullen', '积郁憋闷'],
    ['weeping', '默然垂泪'],
    ['weary', '疲惫失神'],
    ['mourning', '哀悼压抑'],
    ['distant', '疏离冷淡'],
  ],
]

export const EMOTIONS: readonly EmotionDef[] = EMOTION_ROWS.flatMap((row, r) =>
  row.map(([id, name], c) => ({ id, name, row: r, col: c })),
)

/** 默认情绪 = 正中间那个（图二十里大圆点就落在中间，「淡然自若」） */
export const DEFAULT_EMOTION_ID = 'serene'

export function emotionById(id: string | undefined | null): EmotionDef | undefined {
  if (!id) return undefined
  return EMOTIONS.find((e) => e.id === id)
}

/**
 * 生成节点上「预设 + 情绪」合起来要拼进提示词的那一段（`''` = 都没选）。
 *
 * **抽成一个函数**是因为三个节点类型（生成 / 批量 / 分组）的 `toRunRequest`
 * 都要拼同一段；各写一遍必然漂移，而漂移的表现是「同一个预设在不同节点上效果不一样」。
 */
export function presetPromptSuffix(data: {
  preset?: string
  presetOptions?: Record<string, string>
  emotion?: string
}): string {
  const parts: string[] = []
  const preset = presetPromptOf(data.preset, data.presetOptions)
  if (preset) parts.push(preset)
  const emotion = emotionById(data.emotion)
  /**
   * 情绪那句必须**自带约束**（用户 2026-10-05 第五批第 1 条：
   * 「情绪调节需要重新设计，需要先自动识别面部，然后只改变面部的情绪，
   * 其他的内容完全不变才对」）。
   *
   * 局部改脸的完整流水线（识别人脸 → 裁局部 → 改图 → 融合回原图）是另一半；
   * 但只要这句话进了提示词，**任何**一条生成路径都不会再把整张图重画一遍 ——
   * 这是当前就能生效、且必须与那条流水线共用的一句。
   */
  if (emotion) {
    parts.push(
      `表情设定：${emotion.name}（只改人物的面部表情，其余完全保持不变：` +
        '长相、发型、妆容、服装、姿态、背景、光线、风格、构图都照原样）',
    )
  }
  return parts.join('\n')
}
