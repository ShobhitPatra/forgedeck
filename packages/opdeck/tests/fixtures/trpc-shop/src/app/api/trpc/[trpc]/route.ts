import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: {} as never,
    createContext: () => ({}),
  })

export { handler as GET, handler as POST }
