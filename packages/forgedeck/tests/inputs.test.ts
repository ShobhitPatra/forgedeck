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
  it('merges multiple parsed schemas keeping each schema location', () => {
    const sf = fileFrom(`
      import { z } from 'zod'
      const q = z.object({ page: z.coerce.number() })
      const b = z.object({ name: z.string() })
      export async function POST(req: Request) {
        const query = q.parse(Object.fromEntries(new URL(req.url).searchParams))
        const body = b.parse(await req.json())
        return { query, body }
      }
    `)
    const bodyText = sf.getFunction('POST')!.getBodyText()!
    const fields = extractInputs(sf, bodyText)
    expect(fields).toContainEqual({
      name: 'page',
      type: 'number',
      required: true,
      location: 'query',
    })
    expect(fields).toContainEqual({
      name: 'name',
      type: 'string',
      required: true,
      location: 'body',
    })
  })
  it('resolves an extended schema', () => {
    const sf = fileFrom(`
      import { z } from 'zod'
      const base = z.object({ email: z.string(), theme: z.string().optional() })
      const extended = base.extend({ notifyOnShare: z.boolean() })
      export async function POST(req: Request) { return extended.parse(await req.json()) }
    `)
    const body = sf.getFunction('POST')!.getBodyText()!
    expect(extractInputs(sf, body)).toEqual([
      { name: 'email', type: 'string', required: true, location: 'body' },
      { name: 'theme', type: 'string', required: false, location: 'body' },
      { name: 'notifyOnShare', type: 'boolean', required: true, location: 'body' },
    ])
  })
  it('resolves merge, pick, omit and partial compositions', () => {
    const sf = fileFrom(`
      import { z } from 'zod'
      const base = z.object({ email: z.string(), theme: z.string().optional() })
      const extra = z.object({ age: z.number() })
      const merged = base.merge(extra)
      const picked = base.pick({ email: true })
      const omitted = base.omit({ theme: true })
      const partialed = extra.partial()
    `)
    // merge = union of both objects
    expect(extractInputs(sf, `merged.parse(x)`)).toEqual([
      { name: 'email', type: 'string', required: true, location: 'body' },
      { name: 'theme', type: 'string', required: false, location: 'body' },
      { name: 'age', type: 'number', required: true, location: 'body' },
    ])
    // pick = kept keys only
    expect(extractInputs(sf, `picked.parse(x)`)).toEqual([
      { name: 'email', type: 'string', required: true, location: 'body' },
    ])
    // omit = complement of masked keys
    expect(extractInputs(sf, `omitted.parse(x)`)).toEqual([
      { name: 'email', type: 'string', required: true, location: 'body' },
    ])
    // partial = every field optional
    expect(extractInputs(sf, `partialed.parse(x)`)).toEqual([
      { name: 'age', type: 'number', required: false, location: 'body' },
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
