/**
 * 比例档（产品文档 §6.8 的九档 + 「自由」）。
 *
 * 两处消费者：融合节点的「按模型比例提取」、素材灯箱的「提取选区」。
 * 抽到 domain 共用是因为**两处必须同一批档位** —— 各写一份的话，
 * 用户在灯箱里选了 21:9、到融合节点却发现没有这一档，就会以为功能坏了。
 *
 * `value` 是 `'W:H'` 的**机器可读**形式（`ratioValueOf` 解析它）；
 * 空串 = 自由（不吸附）。`label` 只管显示，改成「宽屏」之类也不会影响行为。
 */
export const RATIO_CHOICES: readonly { label: string; value: string }[] = [
  { label: '自由', value: '' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '21:9', value: '21:9' },
]
