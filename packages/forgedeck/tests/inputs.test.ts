import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { extractInputs } from '../src/extract/inputs'

function fileFrom(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  return project.createSourceFile('x.ts', code)
}

describe('extractInputs', () => {
  it('extracts fields from the zod schema used in the handler', () => {
    const sf = fileFrom(`
      import { z } from 'zod'
      const createOrderSchema = z.object({
        email: z.string(),
        quantity: z.number(),
        note: z.string().optional()
      })
      export async function POST(req: Request) {
        const body = createOrderSchema.parse(await req.json())
        return body
      }
    `)
    const body = sf.getFunction('POST')!.getBodyText()!
    expect(extractInputs(sf, body)).toEqual([
      { name: 'email', type: 'string', required: true, location: 'body' },
      { name: 'quantity', type: 'number', required: true, location: 'body' },
      { name: 'note', type: 'string', required: false, location: 'body' },
    ])
  })
  it('returns empty when no schema is referenced', () => {
    const sf = fileFrom(`export async function GET() { return 1 }`)
    expect(extractInputs(sf, 'return 1')).toEqual([])
  })
  it('handles argful heads, coerce, and optional after an argful chain', () => {
    const sf = fileFrom(`
      import { z } from 'zod'
      const s = z.object({
        status: z.enum(['draft', 'active']),
        page: z.coerce.number(),
        name: z.string().min(1).optional()
      })
      export async function POST(req: Request) { return s.parse(await req.json()) }
    `)
    const body = sf.getFunction('POST')!.getBodyText()!
    expect(extractInputs(sf, body)).toEqual([
      { name: 'status', type: 'unknown', required: true, location: 'body' },
      { name: 'page', type: 'number', required: true, location: 'body' },
      { name: 'name', type: 'string', required: false, location: 'body' },
    ])
  })
})
