import { z, ZodSchema } from 'zod'

// A parseRequest wrapper in the shape umami uses: the schema is validated
// against the query string for GET and against the JSON body otherwise, so the
// handler never calls `schema.parse(...)` itself.
export async function parseRequest(request: Request, schema?: ZodSchema): Promise<any> {
  const url = new URL(request.url)
  let query = Object.fromEntries(url.searchParams)
  let body = await request
    .clone()
    .json()
    .catch(() => undefined)
  let error: (() => void) | undefined

  if (schema) {
    const isGet = request.method === 'GET'
    const result = schema.safeParse(isGet ? query : body)
    if (!result.success) {
      error = () => undefined
    } else if (isGet) {
      query = result.data as z.infer<typeof schema>
    } else {
      body = result.data
    }
  }

  return { url, query, body, error }
}
