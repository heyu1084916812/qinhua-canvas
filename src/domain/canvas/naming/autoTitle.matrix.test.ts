import { describe, expect, it } from 'vitest'
import {
  generatedNodeTitle,
  type GeneratedNodeTitleInput,
} from './autoTitle'

interface Case {
  id: string
  name: string
  input: GeneratedNodeTitleInput
  want: string
}

function input(over: Partial<GeneratedNodeTitleInput> = {}): GeneratedNodeTitleInput {
  return {
    prompt: '',
    mode: 'image',
    slotKind: 'reuse',
    sourceTitle: '生成',
    targetTitle: '生成',
    index: 0,
    total: 1,
    ...over,
  }
}

function row(id: string, name: string, over: Partial<GeneratedNodeTitleInput>, want: string): Case {
  return { id, name, input: input(over), want }
}

/** 10 组：用户手动标题永远最高优先。 */
const manualCases: Case[] = [
  row('M01', '复用节点保留手动名', { targetTitle: '客户A春季主图' }, '客户A春季主图'),
  row('M02', '新承载节点继承来源手动名', { slotKind: 'new', sourceTitle: '雨夜快递' }, '雨夜快递'),
  row('M03', '手动名压缩多余空格', { targetTitle: '  客户 A   主图  ' }, '客户 A 主图'),
  row('M04', '手动名去掉引号', { targetTitle: '“雨夜海报”' }, '雨夜海报'),
  row('M05', '手动名去掉句末标点', { targetTitle: '角色设定图。' }, '角色设定图'),
  row(
    'M06',
    '来源手动名压过素材和预设',
    {
      slotKind: 'new',
      sourceTitle: '小猫钓鱼',
      materialTitle: '奶瓶.png',
      prompt: '一只狗',
      presetName: '产品设定图',
    },
    '小猫钓鱼',
  ),
  row('M07', '复用落点名优先于来源名', { sourceTitle: 'Agent标题', targetTitle: '手动标题' }, '手动标题'),
  row('M08', '新节点手动名重名顺延', { slotKind: 'new', sourceTitle: '雨夜快递', existingTitles: ['雨夜快递'] }, '雨夜快递-02'),
  row('M09', '新节点手动名多张编号', { slotKind: 'new', sourceTitle: '客户主图', total: 2 }, '客户主图-01'),
  row('M10', '视频不擅自改手动名', { mode: 'video', targetTitle: '雨夜快递' }, '雨夜快递'),
]

/** 10 组：上传文件名优先于提示词，并清理常见后缀。 */
const materialCases: Case[] = [
  row('A01', '普通产品文件名', { materialTitle: '婴儿奶瓶.png' }, '婴儿奶瓶'),
  row('A02', 'Windows 路径取 basename', { materialTitle: 'C:\\素材\\白色运动鞋.JPG' }, '白色运动鞋'),
  row('A03', '下划线转空格', { materialTitle: '环保_水杯.webp' }, '环保 水杯'),
  row('A04', '去掉副本后缀', { materialTitle: '产品图_副本.png' }, '产品图'),
  row('A05', '去掉括号序号', { materialTitle: '白底奶瓶 (1).png' }, '白底奶瓶'),
  row('A06', '去掉 final 后缀', { materialTitle: '场景-final.png' }, '场景'),
  row('A07', '相机文件名不参与命名', { materialTitle: 'IMG_9134.jpg', prompt: '红色电话亭' }, '红色电话亭'),
  row('A08', '微信图片这种泛化名不参与命名', { materialTitle: '微信图片_20250101.png', prompt: '蓝色椅子' }, '蓝色椅子'),
  row('A09', '产品 hash 名不参与命名', { materialTitle: '轻画-abcdef12.png', prompt: '抽象海报' }, '抽象海报'),
  row('A10', '大写扩展名可识别', { materialTitle: '产品图.JPEG' }, '产品图'),
]

/** 10 组：预设 / 业务用途作为第二段。 */
const presetCases: Case[] = [
  row('P01', '素材名加产品预设', { materialTitle: '奶瓶.png', presetName: '产品设定图' }, '奶瓶-产品设定'),
  row('P02', '提示词加角色预设', { prompt: '小猫', presetName: '角色三视图' }, '小猫-角色三视图'),
  row('P03', '业务用途压过预设', { materialTitle: '奶瓶.png', presetName: '产品设定图', usageLabel: '亚马逊主图' }, '奶瓶-亚马逊主图'),
  row('P04', '主体与预设相同不重复', { prompt: '角色三视图', presetName: '角色三视图' }, '角色三视图'),
  row('P05', '25宫格预设压缩', { materialTitle: '街景.png', presetName: '25宫格连贯分镜' }, '街景-25宫格分镜'),
  row('P06', '720 全景预设压缩', { materialTitle: '客厅.png', presetName: '720 全景' }, '客厅-720全景'),
  row('P07', '调度故事板压缩', { prompt: '雨夜追逐', presetName: '调度故事板' }, '雨夜追逐-调度分镜'),
  row('P08', '人像质感预设压缩', { prompt: '女孩', presetName: '人像质感调节' }, '女孩-人像质感'),
  row('P09', '电影光影预设压缩', { materialTitle: '咖啡馆.png', presetName: '电影级光影校正' }, '咖啡馆-电影光影'),
  row('P10', '电商详情页用途', { materialTitle: '奶瓶.png', usageLabel: '详情页' }, '奶瓶-详情页'),
]

/** 10 组：中文提示词的命令词、标签、弱首句与引用清理。 */
const chinesePromptCases: Case[] = [
  row('C01', '去掉请帮我生成', { prompt: '请帮我生成一张白底运动鞋主图，右侧留白。' }, '白底运动鞋主图'),
  row('C02', '去掉商品标签', { prompt: '商品：婴儿奶瓶；平台：淘宝' }, '婴儿奶瓶'),
  row('C03', '跳过高清弱首句', { prompt: '高清，一只戴红围巾的猫。' }, '一只戴红围巾的猫'),
  row('C04', '跳过纯色背景弱首句', { prompt: '纯色背景，角色站在雨里' }, '角色站在雨里'),
  row('C05', '生成冒号写法', { prompt: '生成：雨夜里的红色电话亭' }, '雨夜里的红色电话亭'),
  row('C06', '去掉中文引号', { prompt: '“窗边的绿植”' }, '窗边的绿植'),
  row('C07', '跳过 4K 弱首句', { prompt: '4K，奶白色陶瓷杯，带木盖' }, '奶白色陶瓷杯'),
  row('C08', '去掉素材 mention', { prompt: '@[参考图](asset:h1) 一只橘猫' }, '一只橘猫'),
  row('C09', '跳过纯序号从句', { prompt: '第2张，冒烟测试' }, '冒烟测试'),
  row('C10', '制作一组命令词', { prompt: '帮我制作一组产品包装图' }, '产品包装图'),
]

/** 10 组：英文命令词、冠词、弱首句和“description for”重构。 */
const englishPromptCases: Case[] = [
  row('E01', 'Generate 命令词', { prompt: 'Generate a white sneaker on pure background' }, 'white sneaker'),
  row('E02', 'Create 加逗号分句', { prompt: 'Create the product hero image, studio light' }, 'product hero image'),
  row('E03', 'Please render 命令词', { prompt: 'Please render a glass bottle on white' }, 'glass bottle'),
  row('E04', '跳过 high quality 弱首句', { prompt: 'high quality, red bicycle' }, 'red bicycle'),
  row('E05', 'Draw 命令词和冠词', { prompt: 'Draw an orange cat.' }, 'orange cat'),
  row('E06', '大写命令词', { prompt: 'PRODUCE A Minimal Lamp' }, 'Minimal Lamp'),
  row('E07', 'description for 重构主体', { prompt: 'Generate a very long English product description for a ceramic coffee cup' }, 'ceramic coffee cup'),
  row('E08', '去掉英文冠词', { prompt: 'A futuristic city at night' }, 'futuristic city'),
  row('E09', '去掉 Midjourney 参数', { prompt: 'Generate a poster --ar 16:9' }, 'poster'),
  row('E10', '只有命令词走兜底', { prompt: 'Generate' }, '图片'),
]

/** 10 组：中文 2 单位、英文 1 单位的视觉宽度截断。 */
const truncateCases: Case[] = [
  row('L01', '中文提示词截到 9 字', { prompt: '一二三四五六七八九十一二三四五六七八九十' }, '一二三四五六七八九'),
  row('L02', '英文提示词截到 18 字符', { prompt: 'abcdefghijklmnopqrstuvwxyz1234567890' }, 'abcdefghijklmnopqr'),
  row('L03', '中文文件名截到 9 字', { materialTitle: '一二三四五六七八九十一二三四五六七八九十.png' }, '一二三四五六七八九'),
  row('L04', '中英混排按视觉宽度截断', { prompt: '奶瓶ABCDEFGHIJKLMNOPQRST' }, '奶瓶ABCDEFGHIJKLMN'),
  row('L05', '较长素材名截断', { materialTitle: '超长产品名称一二三四五六七八九十.png' }, '超长产品名称一二三'),
  row('L06', '未知预设名先压缩', { prompt: '猫', presetName: '这是一个非常长的自定义预设名称' }, '猫-这是一个非常'),
  row('L07', '去掉尾部空与标点', { prompt: '  雨夜海报！！  ' }, '雨夜海报'),
  row('L08', '纯数字按英文宽度截断', { prompt: '12345678901234567890' }, '123456789012345678'),
  row('L09', 'emoji 按双宽截断', { prompt: '🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱' }, '🐱🐱🐱🐱🐱🐱🐱🐱🐱'),
  row('L10', '主体截断后保留部分预设', { materialTitle: '一二三四五六七八九十一二三.png', presetName: '产品设定图' }, '一二三四五六七八九-产品'),
]

/** 10 组：多张、批次和序号顺延。 */
const multiCases: Case[] = [
  row('B01', '两张第一张', { prompt: '猫', total: 2, index: 0 }, '猫-01'),
  row('B02', '两张第二张', { prompt: '猫', total: 2, index: 1 }, '猫-02'),
  row('B03', '四张第三张', { prompt: '猫', total: 4, index: 2 }, '猫-03'),
  row('B04', '四张第四张', { prompt: '猫', total: 4, index: 3 }, '猫-04'),
  row('B05', '首批序号被占用', { prompt: '猫', total: 2, index: 0, existingTitles: ['猫-01'] }, '猫-02'),
  row('B06', '第二批序号被占用', { prompt: '猫', total: 2, index: 1, existingTitles: ['猫-02'] }, '猫-03'),
  row('B07', '素材加预设加编号', { materialTitle: '奶瓶.png', presetName: '产品设定图', total: 2, index: 0 }, '奶瓶-产品设定-01'),
  row('B08', '手动标题加编号', { slotKind: 'new', sourceTitle: '主图', total: 2, index: 0 }, '主图-01'),
  row('B09', '十张最后一张两位编号', { slotKind: 'new', sourceTitle: '主图', total: 10, index: 9 }, '主图-10'),
  row('B10', '单张不加序号', { prompt: '猫', total: 1 }, '猫'),
]

/** 10 组：视频语义、用途与去重。 */
const videoCases: Case[] = [
  row('V01', '提示词生成视频', { mode: 'video', prompt: '猫' }, '猫-视频'),
  row('V02', '素材名生成视频', { mode: 'video', materialTitle: '产品.png' }, '产品-视频'),
  row('V03', '预设后追加视频', { mode: 'video', prompt: '小猫', presetName: '故事板' }, '小猫-故事板-视频'),
  row('V04', '视频多张编号', { mode: 'video', prompt: '猫', total: 2, index: 0 }, '猫-视频-01'),
  row('V05', '提示词已有视频不重复', { mode: 'video', prompt: '产品视频' }, '产品视频'),
  row('V06', '英文 video 不重复', { mode: 'video', prompt: 'video of a cat' }, 'video of a cat'),
  row('V07', '空视频提示词', { mode: 'video' }, '视频'),
  row('V08', '泛化视频素材看提示词', { mode: 'video', materialTitle: 'IMG_0001.mp4', prompt: '猫' }, '猫-视频'),
  row('V09', '视频手动名保持不动', { mode: 'video', slotKind: 'new', sourceTitle: '雨夜快递' }, '雨夜快递'),
  row('V10', '广告片用途后加视频', { mode: 'video', prompt: '猫', usageLabel: '广告片' }, '猫-广告片-视频'),
]

/** 10 组：标题去重、大小写、序号占位。 */
const collisionCases: Case[] = [
  row('X01', '基础名已占用', { prompt: '猫', existingTitles: ['猫'] }, '猫-02'),
  row('X02', '只有二号占用时基础名可用', { prompt: '猫', existingTitles: ['猫-02'] }, '猫'),
  row('X03', '基础和二号都占用', { prompt: '猫', existingTitles: ['猫', '猫-02'] }, '猫-03'),
  row('X04', '素材名重名', { materialTitle: '产品.png', existingTitles: ['产品'] }, '产品-02'),
  row('X05', '素材预设组合重名', { materialTitle: '奶瓶.png', presetName: '产品设定图', existingTitles: ['奶瓶-产品设定'] }, '奶瓶-产品设定-02'),
  row('X06', '新节点手动名重名', { slotKind: 'new', sourceTitle: '主图', existingTitles: ['主图'] }, '主图-02'),
  row('X07', '多张首批冲突顺延', { prompt: '猫', total: 2, index: 0, existingTitles: ['猫-01'] }, '猫-02'),
  row('X08', '多张次批冲突顺延', { prompt: '猫', total: 2, index: 1, existingTitles: ['猫-02'] }, '猫-03'),
  row('X09', '大小写视为重名', { prompt: 'cat', existingTitles: ['Cat'] }, 'cat-02'),
  row('X10', '首尾空格视为重名', { prompt: '小猫', existingTitles: ['  小猫 '] }, '小猫-02'),
]

/** 10 组：空值、泛化值与异常输入。 */
const edgeCases: Case[] = [
  row('G01', '空提示词', {}, '图片'),
  row('G02', '纯空格提示词', { prompt: '   ' }, '图片'),
  row('G03', '只有命令词', { prompt: '请生成' }, '图片'),
  row('G04', '只有句号', { prompt: '。' }, '图片'),
  row('G05', '只有代码块', { prompt: '```\ncode\n```' }, '图片'),
  row('G06', '只有 mention', { prompt: '@[参考图](asset:h1)' }, '图片'),
  row('G07', '截图加日期也回落提示词', { materialTitle: '截图_20250101.png', prompt: '蓝色椅子' }, '蓝色椅子'),
  row('G08', '默认来源和落点都不算手动名', { sourceTitle: '生成', targetTitle: '生成的输出1', prompt: '长' }, '长'),
  row('G09', 'emoji 可作为短标题', { prompt: '🐱' }, '🐱'),
  row('G10', '只有商品标签', { prompt: '商品：' }, '图片'),
]

const groups = [
  ['手动标题', manualCases],
  ['素材文件名', materialCases],
  ['预设与用途', presetCases],
  ['中文提示词', chinesePromptCases],
  ['英文提示词', englishPromptCases],
  ['长度截断', truncateCases],
  ['多张与批次', multiCases],
  ['视频规则', videoCases],
  ['重名顺延', collisionCases],
  ['边界兜底', edgeCases],
] as const

const allCases = groups.flatMap(([, cases]) => cases)

describe('自动命名 100 组矩阵', () => {
  it('十个分组各 10 组，合计恰好 100 组', () => {
    expect(groups).toHaveLength(10)
    for (const [name, cases] of groups) expect(cases, name).toHaveLength(10)
    expect(allCases).toHaveLength(100)
    expect(new Set(allCases.map((item) => item.id)).size).toBe(100)
  })

  it.each(allCases)('$id $name', ({ input: value, want }) => {
    expect(generatedNodeTitle(value)).toBe(want)
  })
})
