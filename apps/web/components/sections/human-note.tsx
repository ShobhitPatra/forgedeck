import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'

export function HumanNote() {
  return (
    <Layer>
      <h2 className="font-mono text-2xl font-bold">{copy.humanNote.heading}</h2>
      <p className="mt-4 max-w-2xl text-graphite">{copy.humanNote.body}</p>
      <a
        href="https://github.com/ShobhitPatra/forgedeck#roadmap"
        className="mt-4 inline-block font-mono text-sm underline hover:text-graphite"
      >
        {copy.humanNote.roadmap} →
      </a>
    </Layer>
  )
}
