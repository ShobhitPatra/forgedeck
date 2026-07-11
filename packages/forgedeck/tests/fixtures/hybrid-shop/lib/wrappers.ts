import type { NextApiRequest, NextApiResponse } from 'next'

type Handler = (req: Request) => Promise<Response>
export function withV1Wrapper(opts: { handler: Handler }): Handler {
  return opts.handler
}

type ActionFn = (input: { surveyId: string }) => Promise<unknown>
export const authenticatedActionClient = {
  action(fn: ActionFn) {
    return fn
  },
}
