import { z } from 'zod'
import { NextResponse } from 'next/server'
import { parseRequest } from '@/lib/request'

// umami's exact idiom: a named schema declared *inside* the handler body (a
// nested declaration), passed to the wrapper for a GET (query).
export async function GET(request: Request, { params }: { params: { websiteId: string } }) {
  const schema = z.object({
    startAt: z.coerce.number().int(),
    endAt: z.coerce.number().int(),
    compare: z.string().optional(),
  })

  const { query, error } = await parseRequest(request, schema)

  if (error) {
    return error()
  }

  const { websiteId } = params

  return NextResponse.json({ websiteId, query })
}
