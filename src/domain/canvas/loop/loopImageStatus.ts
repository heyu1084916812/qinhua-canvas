export function loopImageStatusText(input: {
  upstreamImages: number
  willOutput: number
  loopStart: number
}): string {
  if (input.upstreamImages <= 0) return '上游没有可用的图片'
  if (input.willOutput > 0) return `当前会输出 ${input.willOutput} 张图片`
  return `无可取图片：起始 ${input.loopStart} / 共 ${input.upstreamImages} 张`
}
