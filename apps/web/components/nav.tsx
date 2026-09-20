import { Mark } from '@/components/mark'
import { copy } from '@/content/copy'

export function Nav() {
  return (
    <nav className="border-b border-line">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4 sm:px-10">
        <span className="flex items-center gap-2 font-semibold tracking-[-0.04em]">
          <Mark />
          {copy.name}
        </span>
        <a href={copy.github} className="text-sm text-muted hover:text-foreground">
          {copy.nav.github}
        </a>
      </div>
    </nav>
  )
}
