/**
 * 相对时间格式化（纯函数，无依赖）。
 * 用于首页卡片的「最近编辑 X」展示。
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '未知'
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const d = new Date(ts)
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const dd = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
