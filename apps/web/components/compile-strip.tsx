'use client'

import { useEffect, useRef, useState } from 'react'
import { EffectBadge } from '@/components/effect-badge'
import { compileExample as ex } from '@/content/compile-example'

const FINAL_STAGE = 3
const STAGE_MS = 700

export function CompileStrip() {
  const ref = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setStage(FINAL_STAGE)
      return
    }
    const el = ref.current
    if (!el) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return
        started.current = true
        observer.disconnect()
        for (let s = 1; s <= FINAL_STAGE; s++) {
          timers.push(setTimeout(() => setStage(s), s * STAGE_MS))
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      for (const t of timers) clearTimeout(t)
    }
  }, [])

  return (
    <div ref={ref} className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 border border-hairline">
        <p className="border-b border-hairline px-4 py-2 font-mono text-xs text-graphite">
          {ex.sourcePath}
        </p>
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{ex.source}</pre>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="overflow-x-auto border border-hairline px-4 py-3 font-mono text-xs">
          <p className={stage >= 1 ? '' : 'invisible'}>$ {ex.terminalCommand}</p>
          <p className={`mt-1 text-graphite ${stage >= 1 ? '' : 'invisible'}`}>
            {ex.terminalOutput}
          </p>
        </div>
        <div
          className={`border border-hairline p-4 transition-opacity duration-300 ${
            stage >= 2 ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden={stage < 2}
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-sm font-bold">{ex.tool.name}</p>
            <span className={stage >= FINAL_STAGE ? '' : 'invisible'}>
              <EffectBadge effect={ex.tool.effect} />
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-graphite">{ex.tool.route}</p>
          <p className="mt-3 text-sm">{ex.tool.description}</p>
          <p className="mt-3 font-mono text-xs text-graphite">inputs: {ex.tool.inputs}</p>
          <p className="mt-1 font-mono text-xs text-graphite">evidence: {ex.tool.evidence}</p>
        </div>
      </div>
    </div>
  )
}
