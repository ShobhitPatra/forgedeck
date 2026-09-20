import { Evidence } from '@/components/evidence'
import { WaitlistForm } from '@/components/waitlist-form'
import { copy } from '@/content/copy'

export function Hero() {
  return (
    <section className="mx-auto flex max-w-[1200px] flex-col gap-12 px-6 pt-16 pb-20 sm:px-10 sm:pt-24">
      <div className="flex max-w-2xl flex-col gap-5">
        <h1 className="text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.045em] text-balance">
          {copy.hero.h1}
        </h1>
        <p className="max-w-[54ch] text-lg leading-7 text-muted">{copy.hero.sub}</p>
        <div className="mt-2 flex flex-col gap-3">
          <WaitlistForm />
          <p className="text-[13px] text-faint">
            {copy.hero.note}{' '}
            <a
              href={copy.github}
              className="text-foreground underline underline-offset-[3px] hover:text-muted"
            >
              {copy.hero.noteLink}
            </a>
          </p>
        </div>
      </div>
      <Evidence />
    </section>
  )
}
