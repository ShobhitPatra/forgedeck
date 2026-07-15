import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { copy } from '@/content/copy'

// Static OG card, rendered once at build time. No network and no font lookup at
// request time: the JetBrains Mono faces are vendored in apps/web/assets/fonts
// (OFL) and read off disk during prerender. JetBrains Mono stands in for the
// site's Martian Mono, which next/font ships only as woff2 (satori can't parse).

export const alt = 'forgedeck — compile your Next.js app into an MCP server'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Design tokens, mirrored from app/globals.css (light theme).
const paper = '#f8f9f7'
const ink = '#16181a'
const hairline = '#e3e6e2'
const triad = [
  { label: 'read', color: '#0e7c6b' },
  { label: 'write', color: '#a16207' },
  { label: 'irreversible', color: '#b42318' },
]

const font = (name: string) => readFileSync(join(process.cwd(), 'assets/fonts', name))

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: paper,
        color: ink,
        fontFamily: 'JetBrains Mono',
        padding: '72px 80px',
      }}
    >
      {/* Wordmark over a hairline rule, echoing the site's nav chrome */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {copy.nav.wordmark}
        </div>
        <div style={{ display: 'flex', height: 1, background: hairline }} />
      </div>

      {/* Headline */}
      <div
        style={{
          display: 'flex',
          fontSize: 62,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          maxWidth: 900,
        }}
      >
        {copy.hero.h1}
      </div>

      {/* Chrome row: terminal command + effect triad, matching the site's hairline chrome */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: ink,
            color: paper,
            border: `1px solid ${ink}`,
            padding: '14px 22px',
            fontSize: 26,
          }}
        >
          <span>$</span>
          <span>{copy.hero.command}</span>
          <span
            style={{
              display: 'flex',
              borderLeft: `1px solid ${paper}`,
              paddingLeft: 16,
              fontSize: 20,
              opacity: 0.7,
            }}
          >
            copy
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {triad.map((t) => (
            <span
              key={t.label}
              style={{
                display: 'flex',
                border: `1px solid ${t.color}`,
                color: t.color,
                padding: '6px 12px',
                fontSize: 22,
              }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: 'JetBrains Mono',
          data: font('JetBrainsMono-Regular.otf'),
          weight: 400,
          style: 'normal',
        },
        {
          name: 'JetBrains Mono',
          data: font('JetBrainsMono-Bold.otf'),
          weight: 700,
          style: 'normal',
        },
      ],
    },
  )
}
