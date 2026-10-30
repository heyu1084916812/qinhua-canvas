import type { ReactNode } from 'react'

/**
 * A small Lucide subset for Agent process-step titles.
 *
 * Icons are vendored as paths to avoid adding a runtime dependency for a
 * handful of glyphs. Source: lucide-static v1.64.0, ISC license.
 */
function Glyph({
  size = 14,
  tool,
  children,
}: {
  size?: number
  tool: string
  children: ReactNode
}) {
  return (
    <svg
      aria-hidden="true"
      data-agent-step-icon={tool}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export function AgentStepIcon({ tool, size = 14 }: { tool: string; size?: number }) {
  switch (tool) {
    case 'readGraph':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
          <path d="M14 2v5a1 1 0 0 0 1 1h5" />
          <circle cx="11.5" cy="14.5" r="2.5" />
          <path d="M13.3 16.3 15 18" />
        </Glyph>
      )
    case 'readAsset':
      return (
        <Glyph tool={tool} size={size}>
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </Glyph>
      )
    case 'readResult':
      return (
        <Glyph tool={tool} size={size}>
          <path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" />
          <path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" />
          <circle cx="13" cy="7" r="1" fill="currentColor" />
          <rect x="8" y="2" width="14" height="14" rx="2" />
        </Glyph>
      )
    case 'visualReview':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="12" r="1" />
          <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
        </Glyph>
      )
    case 'proposeTaskPlan':
    case 'updateTaskStep':
    case 'requestTaskConfirmation':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M13 5h8" />
          <path d="M13 12h8" />
          <path d="M13 19h8" />
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
        </Glyph>
      )
    case 'applyPlan':
      return (
        <Glyph tool={tool} size={size}>
          <rect width="8" height="8" x="3" y="3" rx="2" />
          <path d="M7 11v4a2 2 0 0 0 2 2h4" />
          <rect width="8" height="8" x="13" y="13" rx="2" />
        </Glyph>
      )
    case 'updateNode':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M14 17H5" />
          <path d="M19 7h-9" />
          <circle cx="17" cy="17" r="3" />
          <circle cx="7" cy="7" r="3" />
        </Glyph>
      )
    case 'runNode':
      return (
        <Glyph tool={tool} size={size}>
          <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
          <path d="m14 7 3 3" />
          <path d="M5 6v4" />
          <path d="M19 14v4" />
          <path d="M10 2v2" />
          <path d="M7 8H3" />
          <path d="M21 16h-4" />
          <path d="M11 3H9" />
        </Glyph>
      )
    case 'runFrom':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
        </Glyph>
      )
    case 'moveNodes':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M12 2v20" />
          <path d="m15 19-3 3-3-3" />
          <path d="m19 9 3 3-3 3" />
          <path d="M2 12h20" />
          <path d="m5 9-3 3 3 3" />
          <path d="m9 5 3-3 3 3" />
        </Glyph>
      )
    case 'arrangeNodes':
    case 'splitGrid':
      return (
        <Glyph tool={tool} size={size}>
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </Glyph>
      )
    case 'resizeNodes':
      return (
        <Glyph tool={tool} size={size}>
          <path d="m15 15 6 6" />
          <path d="m15 9 6-6" />
          <path d="M21 16v5h-5" />
          <path d="M21 8V3h-5" />
          <path d="M3 16v5h5" />
          <path d="m3 21 6-6" />
          <path d="M3 8V3h5" />
          <path d="M9 9 3 3" />
        </Glyph>
      )
    case 'deleteNodes':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </Glyph>
      )
    case 'deleteEdges':
      return (
        <Glyph tool={tool} size={size}>
          <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
          <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
          <line x1="8" x2="8" y1="2" y2="5" />
          <line x1="2" x2="5" y1="8" y2="8" />
          <line x1="16" x2="16" y1="19" y2="22" />
          <line x1="19" x2="22" y1="16" y2="16" />
        </Glyph>
      )
    case 'compareNodes':
      return (
        <Glyph tool={tool} size={size}>
          <circle cx="5" cy="6" r="3" />
          <path d="M12 6h5a2 2 0 0 1 2 2v7" />
          <path d="m15 9-3-3 3-3" />
          <circle cx="19" cy="18" r="3" />
          <path d="M12 18H7a2 2 0 0 1-2-2V9" />
          <path d="m9 15 3 3-3 3" />
        </Glyph>
      )
    case 'sliceImage':
      return (
        <Glyph tool={tool} size={size}>
          <path d="M6 2v14a2 2 0 0 0 2 2h14" />
          <path d="M18 22V8a2 2 0 0 0-2-2H2" />
        </Glyph>
      )
    default:
      return (
        <Glyph tool={tool} size={size}>
          <path d="M13 5h8" />
          <path d="M13 12h8" />
          <path d="M13 19h8" />
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
        </Glyph>
      )
  }
}
