import { Layer } from '@/components/layer'
import { copy } from '@/content/copy'
import { proofStats, stats } from '@/content/stats'

export function Proof() {
  const tiles = proofStats(stats)
  return (
    <Layer>
      <h2 className="font-mono text-2xl font-bold">{copy.proof.heading}</h2>
      <p className="mt-4 max-w-2xl text-graphite">{copy.proof.preVerdict}</p>
      {tiles.length > 0 && (
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          {tiles.map((t) => (
            <div key={t.label}>
              <p className="font-mono text-4xl font-bold">{t.value}</p>
              <p className="mt-2 text-sm text-graphite">{t.label}</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-8 font-mono text-xs text-graphite">
        {copy.proof.disclosure}{' '}
        <a href="https://github.com/operatebench/operatebench" className="underline hover:text-ink">
          {copy.proof.linkLabel}
        </a>
      </p>
    </Layer>
  )
}
