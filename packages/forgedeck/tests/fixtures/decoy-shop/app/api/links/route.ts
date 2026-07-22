import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// The request contract: what a caller actually POSTs to create a link.
const CreateLinkSchema = z.object({
  documentId: z.string(),
  name: z.string(),
  teamId: z.string(),
  expiresAt: z.string().optional(),
})

// A DECOY: this schema validates a *derived*, nested value (the watermark
// sub-object), not the request. It must never be mistaken for the request
// contract when a request-parsing site is present in the same handler.
const WatermarkConfigSchema = z.object({
  text: z.string(),
  color: z.string(),
  opacity: z.number(),
})

export async function POST(req: NextRequest) {
  const parsed = CreateLinkSchema.parse(await req.json())

  if ((parsed as { watermarkConfig?: unknown }).watermarkConfig) {
    const validation = WatermarkConfigSchema.safeParse(
      (parsed as { watermarkConfig?: unknown }).watermarkConfig,
    )
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid watermark' }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: true })
}
