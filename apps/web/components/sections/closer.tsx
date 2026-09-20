import { WaitlistForm } from '@/components/waitlist-form'
import { copy } from '@/content/copy'

export function Closer() {
  return (
    <section>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-20 sm:px-10">
        <h2 className="text-3xl leading-9 font-semibold tracking-[-0.04em] text-balance sm:text-4xl sm:leading-[44px]">
          {copy.closer.heading}
        </h2>
        <WaitlistForm />
      </div>
    </section>
  )
}
