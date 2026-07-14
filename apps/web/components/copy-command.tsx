'use client'

import { useState } from 'react'
import { copy } from '@/content/copy'

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copy.hero.copyLabel}
      onClick={async () => {
        await navigator.clipboard.writeText(command)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="group inline-flex items-center gap-3 border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper transition-colors hover:bg-paper hover:text-ink"
    >
      <span aria-hidden>$</span>
      <span>{command}</span>
      <span className="border-l border-current pl-3 text-xs opacity-70">
        {copied ? copy.hero.copied : 'copy'}
      </span>
    </button>
  )
}
