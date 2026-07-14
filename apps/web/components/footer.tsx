import { copy } from '@/content/copy'

export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline px-6 py-8 font-mono text-xs text-graphite sm:px-10">
      <span>{copy.footer.license}</span>
      <div className="flex gap-6">
        {copy.footer.links.map((l) => (
          <a key={l.label} href={l.href} className="hover:text-ink hover:underline">
            {l.label}
          </a>
        ))}
      </div>
    </footer>
  )
}
