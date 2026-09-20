import { copy } from '@/content/copy'
import { evidenceExample as ex } from '@/content/evidence-example'

const EFFECT_CLASS = {
  read: 'text-read',
  write: 'text-write',
  irreversible: 'text-irreversible',
} as const

// Every field of the tools.json entry, one per line. Two values carry the page's
// claim and get emphasis: the effect (colour) and `enabled: false` (dimmed, it is off).
// Same layout `JSON.stringify(tool, null, 2)` writes to disk, one field at a time.
function json(value: unknown) {
  return JSON.stringify(value, null, 2).replaceAll('\n', '\n  ')
}

function Tool() {
  const entries = Object.entries(ex.tool)
  return (
    <>
      {'{\n'}
      {entries.map(([key, value], i) => (
        <span key={key}>
          {`  "${key}": `}
          {key === 'effect' ? (
            <span className={EFFECT_CLASS[ex.tool.effect]}>{JSON.stringify(value)}</span>
          ) : key === 'enabled' ? (
            <span className="text-faint">{JSON.stringify(value)}</span>
          ) : (
            json(value)
          )}
          {i < entries.length - 1 ? ',\n' : '\n'}
        </span>
      ))}
      {'}'}
    </>
  )
}

function Pane({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="px-5 pt-3 text-xs text-faint">{path}</div>
      <pre className="overflow-x-auto px-5 pt-2 pb-4 font-mono text-[12.5px] leading-[21px]">
        {children}
      </pre>
    </div>
  )
}

export function Evidence() {
  return (
    <figure className="flex flex-col gap-3">
      <div className="grid divide-y divide-line rounded-lg border border-line bg-surface md:grid-cols-2 md:divide-x md:divide-y-0">
        <Pane path={ex.sourcePath}>{ex.source}</Pane>
        <Pane path={ex.outputPath}>
          <Tool />
        </Pane>
      </div>
      <figcaption className="text-[13px] text-faint">{copy.evidence.caption}</figcaption>
    </figure>
  )
}
