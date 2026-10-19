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

export function IconChevron({ size = 14 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 16 16">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  )
}

export function IconFolder({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 20 20">
      <path d="M2.8 5.5h5l1.5 1.7h7.9v7.5a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="M2.8 7.2V5.2a1.2 1.2 0 0 1 1.2-1.2h2.7l1.4 1.5" />
    </svg>
  )
}

export function IconPin({ size = 15 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <path d="M6.2 2.7h5.6l-.9 4 2 2v1.4H5.1v-1.4l2-2Z" />
      <path d="M9 10.1v5.2" />
    </svg>
  )
}

export function IconMore({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <circle cx="4" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <path d="M9 3.5v11M3.5 9h11" />
    </svg>
  )
}

export function IconRename({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <path d="m3 12.9-.4 2.5 2.5-.4 8.3-8.3-2.1-2.1Z" />
      <path d="m10.3 5.5 2.1 2.1" />
    </svg>
  )
}

export function IconMove({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 20 20">
      <path d="M3 6.2h5l1.4 1.5h7.6v7.1a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 14.8Z" />
      <path d="M9.2 3.3h5.3M12.2 1.6l2 1.7-2 1.7" />
    </svg>
  )
}

export function IconCopy({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <rect x="6.2" y="5.2" width="8.3" height="9.1" rx="1.4" />
      <path d="M11.8 5.2V4.1a1.4 1.4 0 0 0-1.4-1.4H4.1a1.4 1.4 0 0 0-1.4 1.4v6.3a1.4 1.4 0 0 0 1.4 1.4h2.1" />
    </svg>
  )
}

export function IconReveal({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 20 20">
      <path d="M2.8 5.5h5l1.5 1.7h7.9v7.5a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="m10 9.2 2.4 2.4-2.4 2.4M12.2 11.6H7" />
    </svg>
  )
}

export function IconUpload({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <path d="M9 12V2.8M5.8 6 9 2.8 12.2 6" />
      <path d="M3.2 11v2.7a1.3 1.3 0 0 0 1.3 1.3h9a1.3 1.3 0 0 0 1.3-1.3V11" />
    </svg>
  )
}

export function IconCloseCanvas({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <rect x="2.8" y="3.2" width="12.4" height="11.6" rx="1.5" />
      <path d="m7 7 4 4M11 7l-4 4" />
    </svg>
  )
}

export function IconTrash({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 18 18">
      <path d="M3.5 5.2h11M7 5.2V3.6h4v1.6M5 5.2l.7 9.2h6.6l.7-9.2M7.5 7.8v4M10.5 7.8v4" />
    </svg>
  )
}

export function IconFolderOut({ size = 16 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 20 20">
      <path d="M3 6.2h5l1.4 1.5h7.6v7.1a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 14.8Z" />
      <path d="M7.6 11.2h5M10.5 8.7l2.5 2.5-2.5 2.5" />
    </svg>
  )
}
