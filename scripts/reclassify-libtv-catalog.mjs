import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const catalogPath = path.join(root, 'public', 'libtv-skills', 'catalog.json')
const write = process.argv.includes('--write')

export const LIBTV_CONTENT_CATEGORIES = [
  '图像创作',
  '视频创作',
  '人物角色',
  '电商品牌',
  '影视剧情',
  '动漫游戏',
  '音频音乐',
  '文案策划',
  '后期工具',
  '其他',
]

const RULES = [
  {
    category: '后期工具',
    patterns: [
      /修复|超清|高清重绘|放大|补帧|插帧|去水印|抠图|擦除|消除|移除|换背景|扩图|裁剪|调色|降噪|去噪|去模糊|清晰化|重绘|修复/i,
      /工作流|自动化|批量处理|批量生成|批量|调度|串联|编排|一键流|模板化|节点流|提示词优化|提示词反推|反推助手|资产提取|拆解助手/i,
    ],
  },
  {
    category: '音频音乐',
    patterns: [
      /音乐|歌曲|词曲|作词|作曲|编曲|伴奏|旋律|节奏|BGM|音效|配音|音色|语音|TTS|口播|播客|音频|声音克隆|歌声/i,
      /音乐\s*mv|(?<![a-z])mv(?![a-z])|专辑|舞台片|演唱会/i,
    ],
  },
  {
    category: '动漫游戏',
    patterns: [
      /动漫|二次元|漫画|国漫|日漫|番剧|赛璐璐|游戏|Game|战斗特效|技能特效|Q版|手办|像素风|galgame|角色立绘/i,
    ],
  },
  {
    category: '影视剧情',
    patterns: [
      /电影|影视|分镜|导演|运镜|镜头|机位|剧本|编剧|叙事|剧情|短片|微电影|纪录片|故事片|预告片|故事板|白模|场记|剧集|短剧|漫剧|爽点|反转|钩子|小说推文|拍摄|打斗|战斗|动作/i,
    ],
  },
  {
    category: '电商品牌',
    patterns: [
      /电商|淘宝|天猫|京东|拼多多|亚马逊|TikTok Shop|Shopee|商品|产品图|产品主图|详情页|主图|白底图|白牌|包装|带货|商品图|产品广告|品牌广告|TVC|品牌|Logo|标志|商标|VI|视觉识别|促销|上新/i,
    ],
  },
  {
    category: '人物角色',
    patterns: [
      /角色|人设|人物|定妆|三视图|七视图|多视图|选角|Casting|模特|真人|仿真人|数字人|虚拟人|换装|换脸|五官|脸型|面部|肖像|写真|人像|立绘|群像|微表情|表情|表演|情绪/i,
    ],
  },
  {
    category: '视频创作',
    patterns: [
      /视频|图生视频|文生视频|动态|动画|运镜|转场|特效|起舞|舞蹈|变身|口播视频|带货视频|广告片|MV|短片/i,
    ],
  },
  {
    category: '图像创作',
    patterns: [
      /图片|生图|图像|绘画|插画|海报|封面|壁纸|头像|表情包|摄影|照片|写真|风光|建筑|室内|场景|美学|风格|质感|构图|配色|视觉|国风|古风|科幻|写实|3D渲染|渲染/i,
    ],
  },
  {
    category: '文案策划',
    patterns: [
      /文案|卖点|标题|策划|营销|种草|广告语|Slogan|宣传语|品牌故事|内容规划|选题|脚本创作|产品描述|详情文案|社媒文案|账号定位/i,
    ],
  },
]

const FIELD_WEIGHTS = [
  ['name', 100],
  ['description', 12],
  ['useScenario', 3],
  ['inputType', 1],
  ['outputContent', 1],
]

export function classifyLibtvSkill(item) {
  const scores = new Map()
  for (const rule of RULES) {
    const matchedWeights = []
    for (const [field, weight] of FIELD_WEIGHTS) {
      const text = typeof item[field] === 'string' ? item[field].toLowerCase() : ''
      if (!text) continue
      if (rule.patterns.some((pattern) => pattern.test(text))) matchedWeights.push(weight)
    }
    if (matchedWeights.length > 0) {
      const peak = Math.max(...matchedWeights)
      scores.set(rule.category, peak * 100 + matchedWeights.length)
    }
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1])
  if (ranked[0] && ranked[0][1] >= 10) return ranked[0][0]
  if (item.resultType === 4) return '音频音乐'
  if (item.resultType === 2) return '图像创作'
  if (item.resultType === 3) return '视频创作'
  if (item.resultType === 1) return '文案策划'
  return '其他'
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const items = Array.isArray(catalog.items) ? catalog.items : []
const counts = new Map(LIBTV_CONTENT_CATEGORIES.map((category) => [category, 0]))
const bodyCounts = new Map(LIBTV_CONTENT_CATEGORIES.map((category) => [category, 0]))
const samples = new Map(LIBTV_CONTENT_CATEGORIES.map((category) => [category, []]))

for (const item of items) {
  const category = classifyLibtvSkill(item)
  item.category = category
  item.categoryVersion = 2
  counts.set(category, (counts.get(category) ?? 0) + 1)
  if (item.bodyFile) {
    bodyCounts.set(category, (bodyCounts.get(category) ?? 0) + 1)
  }
  const list = samples.get(category)
  if (list.length < 8) list.push(item.name)
}

console.log(`LibTV 重新分类：${items.length} 条`)
for (const category of LIBTV_CONTENT_CATEGORIES) {
  console.log(
    `${category}\t全部 ${counts.get(category)}\t有正文 ${bodyCounts.get(category)}\t${samples
      .get(category)
      .join(' / ')}`,
  )
}

if (write) {
  catalog.categoryVersion = 2
  catalog.categorizedAt = '2026-10-27'
  writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8')
  console.log(`已写入 ${catalogPath}`)
} else {
  console.log('预览模式：加 --write 才会写入目录')
}
