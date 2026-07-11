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
  it('resolves schemas imported from another file', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile(
      'lib/schemas.ts',
      `
      import { z } from 'zod'
      export const createDoc = z.object({ title: z.string(), tags: z.array(z.string()) })
    `,
    )
    const sf = project.createSourceFile(
      'pages/api/docs.ts',
      `
      import { createDoc } from '../../lib/schemas'
      export default async function handler(req, res) {
        const body = createDoc.parse(req.body)
        return body
      }
    `,
    )
    const body = sf.getFunctions()[0].getBodyText()!
    expect(extractInputs(sf, body)).toEqual([
      { name: 'title', type: 'string', required: true, location: 'body' },
      { name: 'tags', type: 'unknown', required: true, location: 'body' },
    ])
  })
  it('marks searchParams parsed schemas as query', () => {
    const sf = fileFrom(`
      import { z } from 'zod'
      const listQuery = z.object({ page: z.coerce.number(), q: z.string().optional() })
      export async function GET(req: Request) {
        const url = new URL(req.url)
        const query = listQuery.parse(Object.fromEntries(url.searchParams))
        return query
      }
    `)
    const body = sf.getFunction('GET')!.getBodyText()!
    expect(extractInputs(sf, body)).toEqual([
      { name: 'page', type: 'number', required: true, location: 'query' },
      { name: 'q', type: 'string', required: false, location: 'query' },
    ])
  })
  it('extracts bare req query destructuring', () => {
    const sf = fileFrom(`
      export default async function handler(req, res) {
        const { id, filter } = req.query
        return res.json({ id, filter })
      }
    `)
    const body = sf.getFunctions()[0].getBodyText()!
    expect(extractInputs(sf, body)).toEqual([
      { name: 'id', type: 'unknown', required: false, location: 'query' },
      { name: 'filter', type: 'unknown', required: false, location: 'query' },
    ])
  })
})
