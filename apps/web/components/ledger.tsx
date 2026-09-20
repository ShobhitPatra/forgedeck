// The page's one section structure: heading in the left four columns, rows in the
// right eight, hairlines between. Stacks to one column on narrow screens.
export function Ledger({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-6 px-6 py-16 sm:px-10 md:grid-cols-12 md:gap-8">
        <h2 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-balance md:col-span-4">
          {heading}
        </h2>
        <div className="divide-y divide-line md:col-span-8">{children}</div>
      </div>
    </section>
  )
}

export function LedgerRow({ title, children }: { title: React.ReactNode; children: string }) {
  return (
    <div className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-8 sm:gap-6">
      <div className="font-medium sm:col-span-3">{title}</div>
      <p className="text-muted sm:col-span-5">{children}</p>
    </div>
  )
}
