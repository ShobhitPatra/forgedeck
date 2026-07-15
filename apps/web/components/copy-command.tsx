'use client'

import { useEffect, useRef, useState } from 'react'
import { copy } from '@/content/copy'

type Status = 'idle' | 'copied' | 'failed'

export function CopyCommand({ command }: { command: string }) {
  const [status, setStatus] = useState<Status>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const label =
    status === 'copied' ? copy.hero.copied : status === 'failed' ? copy.hero.copyFailed : 'copy'

  return (
    <button
      type="button"
      aria-label={`${copy.hero.copyLabel}: ${command}`}
      onClick={async () => {
        clearTimeout(timer.current)
        try {
          if (!navigator.clipboard) throw new Error('clipboard unavailable')
          await navigator.clipboard.writeText(command)
          setStatus('copied')
        } catch {
          setStatus('failed')
        }
        timer.current = setTimeout(() => setStatus('idle'), 2000)
      }}
      className="group inline-flex items-center gap-3 border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper transition-colors hover:bg-paper hover:text-ink"
    >
      <span aria-hidden>$</span>
      <span>{command}</span>
      <span className="border-l border-current pl-3 text-xs opacity-70">{label}</span>
    </button>
  )
}
