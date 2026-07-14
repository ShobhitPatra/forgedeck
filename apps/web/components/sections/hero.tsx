import { CopyCommand } from '@/components/copy-command'
import { copy } from '@/content/copy'
import { heroSubheadline, stats } from '@/content/stats'

export function Hero() {
  return (
    <section className="px-6 pb-24 pt-20 sm:px-10 sm:pt-28">
      <div className="mx-auto max-w-4xl">
        <h1 className="max-w-3xl font-mono text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {copy.hero.h1}
        </h1>
        <p className="mt-5 max-w-xl text-lg text-graphite">{heroSubheadline(stats)}</p>
        <div className="mt-10">
          <CopyCommand command={copy.hero.command} />
        </div>
      </div>
    </section>
  )
}
