import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'

export function SeeIt() {
  return (
    <Layer>
      <p className="font-mono text-sm font-bold">{copy.seeIt.lead}</p>
      <p className="mt-3 max-w-2xl text-graphite">{copy.seeIt.body}</p>
      <div data-slot="compile-strip" className="mt-10" />
    </Layer>
  )
}
