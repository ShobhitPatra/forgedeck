import { z } from 'zod'
import { NextResponse } from 'next/server'
import { parseRequest } from '@/lib/request'

// Inline z.object passed straight to the wrapper for a POST (body).
export async function POST(request: Request) {
  const { body, error } = await parseRequest(
    request,
    z.object({ name: z.string(), domain: z.string() }),
  )

  if (error) {
    return error()
  }

  return NextResponse.json(body)
}
