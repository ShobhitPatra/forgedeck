import { CopyCommand } from '@/components/copy-command'
import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'

export function Closer() {
  return (
    <Layer className="pb-28 text-center">
      <h2 className="font-mono text-3xl font-bold">{copy.closer.heading}</h2>
      <div className="mt-8 flex justify-center">
        <CopyCommand command={copy.closer.command} />
      </div>
      <a href="/docs" className="mt-6 inline-block font-mono text-sm underline hover:text-graphite">
        {copy.closer.quickstart} →
      </a>
    </Layer>
  )
}
