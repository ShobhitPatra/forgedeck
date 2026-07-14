import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'

export function Artifacts() {
  return (
    <Layer>
      <h2 className="font-mono text-2xl font-bold">{copy.artifacts.heading}</h2>
      <div className="mt-8 grid gap-8 sm:grid-cols-3">
        {copy.artifacts.items.map((item) => (
          <div key={item.title}>
            <h3 className="font-mono text-sm font-bold">{item.title}</h3>
            <p className="mt-2 text-sm text-graphite">{item.body}</p>
          </div>
        ))}
      </div>
    </Layer>
  )
}
