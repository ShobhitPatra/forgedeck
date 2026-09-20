import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const startAt = req.nextUrl.searchParams.get('startAt')
  const endAt = req.nextUrl.searchParams.get('endAt')
  const unit = req.nextUrl.searchParams.get('unit')
  return NextResponse.json({ startAt, endAt, unit })
}
