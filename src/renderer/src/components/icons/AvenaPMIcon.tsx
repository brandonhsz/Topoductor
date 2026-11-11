export function AvenaPMIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor">
      {/* Monochrome queue glyph: a ticket stack, matching the other provider marks. */}
      <rect x="3" y="4" width="18" height="5" rx="1.5" strokeWidth="2" />
      <rect x="3" y="11" width="18" height="5" rx="1.5" strokeWidth="2" />
      <path d="M6 20h12" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
