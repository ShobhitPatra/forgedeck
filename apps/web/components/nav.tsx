import { copy } from '@/content/copy'
import { version } from '@/lib/version'

export function Nav() {
  return (
    <nav className="flex items-center justify-between px-6 py-5 sm:px-10">
      <span className="font-mono text-sm font-bold">{copy.nav.wordmark}</span>
      <div className="flex items-center gap-6 font-mono text-xs">
        <a href="/docs" className="hover:underline">
          {copy.nav.docs}
        </a>
        <a href="https://github.com/ShobhitPatra/forgedeck" className="hover:underline">
          {copy.nav.github}
        </a>
        <span className="text-graphite">v{version}</span>
      </div>
    </nav>
  )
}
