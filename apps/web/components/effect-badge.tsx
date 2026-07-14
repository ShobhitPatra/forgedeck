const COLORS = {
  read: 'text-read border-read',
  write: 'text-write border-write',
  irreversible: 'text-irreversible border-irreversible',
} as const

export function EffectBadge({ effect }: { effect: keyof typeof COLORS }) {
  return (
    <span className={`inline-block border px-2 py-0.5 font-mono text-xs ${COLORS[effect]}`}>
      {effect}
    </span>
  )
}
