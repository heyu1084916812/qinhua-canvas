import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 16, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export function SkillStarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="m12 3 2.7 5.46 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6L3.27 9.34l6.03-.88L12 3Z" />
    </svg>
  )
}

export function SkillCloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function SkillExternalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </svg>
  )
}

export function SkillPlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
