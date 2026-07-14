import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'
import { stalenessLine, stats } from '@/content/stats'

export function HandWrite() {
  const staleness = stalenessLine(stats)
  return (
    <Layer>
      <h2 className="font-mono text-2xl font-bold">{copy.handWrite.heading}</h2>
      <p className="mt-4 max-w-2xl text-graphite">{copy.handWrite.body}</p>
      {staleness && <p className="mt-4 max-w-2xl font-mono text-sm">{staleness}</p>}
    </Layer>
  )
}
