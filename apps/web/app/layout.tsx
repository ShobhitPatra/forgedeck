import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { copy } from '@/content/copy'
import './globals.css'

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

const title = `${copy.name}: ${copy.hero.h1}`
const description =
  'Compile your Next.js routes and server actions into MCP tools at build time. Every mutation locked until you allow it by name. No LLM in the loop.'

// Vercel sets this on every deployment; local dev falls back to localhost.
const site = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000'

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL(site),
  openGraph: { title, description, type: 'website' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
