const BADGE_CHROME = 'inline-block border px-2 py-0.5 font-mono text-xs'

const COLORS = {
  read: 'text-read border-read',
  write: 'text-write border-write',
  irreversible: 'text-irreversible border-irreversible',
} as const

export function EffectBadge({ effect }: { effect: keyof typeof COLORS }) {
  return <span className={`${BADGE_CHROME} ${COLORS[effect]}`}>{effect}</span>
}

// Same chrome as EffectBadge, but in the neutral graphite palette. Color on this
// page is reserved for the effect triad, so markers that are not effect
// classifications (locks, auth) render here without borrowing that meaning.
export function NeutralMarker({ label }: { label: string }) {
  return <span className={`${BADGE_CHROME} text-muted border-muted`}>{label}</span>
}
