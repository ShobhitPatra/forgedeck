import { z } from 'zod'
import { NextResponse } from 'next/server'
import { parseRequest } from '@/lib/request'

// Module-level named schema, resolved through the wrapper call for a GET (query).
const statsSchema = z.object({
  startAt: z.coerce.number().int(),
  endAt: z.coerce.number().int(),
})

export async function GET(request: Request) {
  const { query, error } = await parseRequest(request, statsSchema)

  if (error) {
    return error()
  }

  return NextResponse.json(query)
}
