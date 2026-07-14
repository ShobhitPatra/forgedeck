import type { Metadata } from 'next'
import { Instrument_Sans, Martian_Mono } from 'next/font/google'
import './globals.css'

const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' })
const martian = Martian_Mono({ subsets: ['latin'], variable: '--font-martian' })

export const metadata: Metadata = {
  title: 'forgedeck — compile your Next.js app into an MCP server',
  description:
    'One line of config. Nothing hand-written. forgedeck compiles Next.js apps into agent-operable MCP servers at build time.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${martian.variable}`}>
      <body>{children}</body>
    </html>
  )
}
