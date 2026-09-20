import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { copy } from '@/content/copy'

// Static OG card, rendered once at build time. No network and no font lookup at
// request time: the Geist faces are vendored in apps/web/assets/fonts (OFL) as
// TTF, because next/font ships only woff2 and satori can't parse that.

export const alt = `${copy.name}: ${copy.hero.h1}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Design tokens, mirrored from app/globals.css (dark theme).
const background = '#000000'
const foreground = '#ededed'
const muted = '#a1a1a1'
const line = '#2a2a2a'
// The permission ladder, widest to narrowest.
const ladder = [
  { label: 'read', color: '#52a8ff', width: 64 },
  { label: 'write', color: '#f5a623', width: 44 },
  { label: 'irreversible', color: '#ff6166', width: 24 },
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
        background,
        color: foreground,
        fontFamily: 'Geist',
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 40 }}>
            {ladder.map((bar) => (
              <div
                key={bar.label}
                style={{
                  display: 'flex',
                  height: 8,
                  width: (bar.width / 64) * 40,
                  background: bar.color,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 600, letterSpacing: '-0.04em' }}>
            {copy.name}
          </div>
        </div>
        <div style={{ display: 'flex', height: 1, background: line }} />
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 84,
          fontWeight: 600,
          lineHeight: 1.04,
          letterSpacing: '-0.045em',
          maxWidth: 960,
        }}
      >
        {copy.hero.h1}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 26,
          color: muted,
        }}
      >
        <div style={{ display: 'flex' }}>Every mutation locked until you allow it by name.</div>
        <div style={{ display: 'flex', gap: 24 }}>
          {ladder.map((bar) => (
            <span key={bar.label} style={{ display: 'flex', color: bar.color }}>
              {bar.label}
            </span>
          ))}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Geist', data: font('Geist-Regular.ttf'), weight: 400, style: 'normal' },
        { name: 'Geist', data: font('Geist-SemiBold.ttf'), weight: 600, style: 'normal' },
      ],
    },
  )
}
