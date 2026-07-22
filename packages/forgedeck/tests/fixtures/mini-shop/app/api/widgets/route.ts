import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export async function POST(req: NextRequest) {
  const { name, domain } = await req.json()
  return NextResponse.json({ ok: true, name, domain })
}

export async function PUT(req: NextRequest) {
  const body = z.object({ label: z.string(), count: z.number().optional() }).parse(await req.json())
  return NextResponse.json(body)
}
