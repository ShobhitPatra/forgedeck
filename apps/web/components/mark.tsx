// The permission ladder: read is widest, irreversible is narrowest. Alongside the
// effect labels, this is the only place the page uses colour.
export function Mark({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <rect x="2" y="3" width="16" height="3.4" fill="var(--effect-read)" />
      <rect x="2" y="8.3" width="11" height="3.4" fill="var(--effect-write)" />
      <rect x="2" y="13.6" width="6" height="3.4" fill="var(--effect-irreversible)" />
    </svg>
  )
}
