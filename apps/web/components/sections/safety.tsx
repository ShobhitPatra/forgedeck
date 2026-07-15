import { EffectBadge, NeutralMarker } from '@/components/effect-badge'
import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'

type SafetyItem = (typeof copy.safety.items)[number]

function SafetyMarker({ item }: { item: SafetyItem }) {
  if ('effects' in item) {
    return (
      <div className="flex shrink-0 flex-col items-start gap-1">
        {item.effects.map((effect) => (
          <EffectBadge key={effect} effect={effect} />
        ))}
      </div>
    )
  }
  if ('marker' in item) {
    return (
      <div className="shrink-0">
        <NeutralMarker label={item.marker} />
      </div>
    )
  }
  return (
    <div className="shrink-0">
      <EffectBadge effect={item.effect} />
    </div>
  )
}

export function Safety() {
  return (
    <Layer>
      <h2 className="font-mono text-2xl font-bold">{copy.safety.heading}</h2>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2">
        {copy.safety.items.map((item) => (
          <li key={item.body} className="flex items-start gap-3">
            <SafetyMarker item={item} />
            <p className="text-sm text-graphite">{item.body}</p>
          </li>
        ))}
      </ul>
    </Layer>
  )
}
