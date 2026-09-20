import { copy } from '@/content/copy'

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-6 text-[13px] text-muted sm:px-10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[15px] font-semibold tracking-[-0.04em] text-foreground">
            {copy.name}
          </span>
          <span>{copy.footer.license}</span>
          <span>{copy.footer.builtFor}</span>
        </div>
        <div className="flex gap-4">
          {copy.footer.links.map((l) => (
            <a key={l.label} href={l.href} className="hover:text-foreground">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
