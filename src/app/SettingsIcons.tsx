/**
 * 全局设置左导航的线性图标（用户 2026-10-10 #8：
 * 「全局设置里面具体的功能需要在前面加图标，参考图五，要风格一样，配套的矢量图标」）。
 *
 * 与 `AppSidebarIcons`（一级导航那套）**同一套语言**：统一 1.6 描边、`currentColor`、
 * 不填充、24 视窗，尺寸由外层 CSS 给。两套分开住是有意的 ——
 * 一级导航是"去哪儿"，设置是"调什么"，同形不同义。
 *
 * 为什么不引第三方图标库：这里只要 11 个形状，引入一套库等于多一份依赖 +
 * 与既有自建图标风格打架；手写这几个 path 换来的是"描边粗细、圆角、留白"完全一致。
 */
interface IconProps {
  size?: number
}

const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
}

/** 渠道配置：电源插头（"连到哪个站"） */
export function IconChannels({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0Z" />
      <path d="M12 17v4" />
    </svg>
  )
}

/** CLI：终端提示符 */
export function IconCli({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7 9.5 10 12l-3 2.5M12.5 15h4" />
    </svg>
  )
}

/** 素材传输：云上传 */
export function IconHosting({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M7 18h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.4A3.8 3.8 0 0 0 7 18Z" />
      <path d="M12 15v-4.5M10 12.5 12 10.5l2 2" />
    </svg>
  )
}

/** 存储：数据库柱体 */
export function IconStorage({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
      <path d="M5 6.5v11c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-11" />
      <path d="M5 12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8" />
    </svg>
  )
}

/** 外观与体验：调色板 */
export function IconAppearance({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-1.6-1.5-1.7-1.5-3 0-1 .8-1.7 2-1.7h1.6A4.4 4.4 0 0 0 20.5 10 8.5 8.5 0 0 0 12 3.5Z" />
      <circle cx="8.4" cy="9" r="1" />
      <circle cx="12" cy="7.4" r="1" />
      <circle cx="15.6" cy="9" r="1" />
    </svg>
  )
}

/** 备份与恢复：时钟 + 回转箭头（回到某个时间点） */
export function IconBackup({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4" />
      <path d="M4 4.5v3.2h3.2" />
      <path d="M12 8v4.2l3 1.8" />
    </svg>
  )
}

/** 默认参数：三条滑杆 */
export function IconDefaults({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 7.5h5M13 7.5h7M4 16.5h7M15 16.5h5" />
      <circle cx="11" cy="7.5" r="2" />
      <circle cx="13" cy="16.5" r="2" />
    </svg>
  )
}

/** 扩展包：包裹盒 */
export function IconPacks({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 3.5 20 7.5v9L12 20.5 4 16.5v-9Z" />
      <path d="M4 7.5 12 11.5l8-4M12 11.5v9" />
    </svg>
  )
}

/** 通知：铃铛 */
export function IconNotify({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5" />
      <path d="M5 16.5h14" />
      <path d="M10.3 19.2a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  )
}

/** 帮助：疑问圈 */
export function IconHelp({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .8-1 1.6v.3" />
      <path d="M12 16.6h.01" />
    </svg>
  )
}

/** 关于与隐私：信息圈 */
export function IconAbout({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.6v5.6" />
      <path d="M12 7.6h.01" />
    </svg>
  )
}

/** 编辑服务名称与连接配置。 */
export function IconEdit({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="m4.5 19.5 4.1-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z" />
      <path d="m14.2 6.9 3 3" />
    </svg>
  )
}

/** 删除自定义模型服务。 */
export function IconDelete({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 12h8.4L17 7" />
      <path d="M10 10.5v5M14 10.5v5" />
    </svg>
  )
}

/** 打开服务行菜单。 */
export function IconMoreVertical({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 拖动排序把手。 */
export function IconGrip({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="8.5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
