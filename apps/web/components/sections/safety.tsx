import { EffectBadge } from '@/components/effect-badge'
import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'

export function Safety() {
  return (
    <Layer>
      <h2 className="font-mono text-2xl font-bold">{copy.safety.heading}</h2>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2">
        {copy.safety.items.map((item) => (
          <li key={item.body} className="flex items-start gap-3">
            <EffectBadge effect={item.effect} />
            <p className="text-sm text-graphite">{item.body}</p>
          </li>
        ))}
      </ul>
    </Layer>
  )
}
