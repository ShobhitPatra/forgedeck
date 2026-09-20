// Waitlist rules, kept free of Next.js so they are testable. The store is a seam:
// no backend is chosen yet, and until one is wired in `getStore`, signups fail
// loudly. A waitlist that says "you are on the list" and drops the email is the
// one bug this file exists to prevent.

export type JoinResult = 'joined' | 'duplicate'

export interface WaitlistStore {
  join(email: string): Promise<JoinResult>
  answer(email: string, text: string): Promise<void>
}

export type JoinState =
  | { status: 'idle' }
  | { status: 'invalid'; email: string }
  | { status: 'duplicate'; email: string }
  | { status: 'failed'; email: string }
  | { status: 'joined'; email: string }

export type AnswerState = { status: 'idle' } | { status: 'sent' } | { status: 'failed' }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_EMAIL = 254
export const MAX_ANSWER = 1000

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= MAX_EMAIL && EMAIL.test(email) ? email : null
}

/** `trap` is the honeypot field: humans never see it, so any value means a bot. */
export async function join(
  store: WaitlistStore | null,
  input: { email: unknown; trap: unknown },
): Promise<JoinState> {
  const shown = typeof input.email === 'string' ? input.email.trim() : ''
  const email = normalizeEmail(input.email)
  if (!email) return { status: 'invalid', email: shown }
  // Bots get the success screen and nothing is stored.
  if (typeof input.trap === 'string' && input.trap !== '') return { status: 'joined', email }
  if (!store) return { status: 'failed', email }
  try {
    return { status: await store.join(email), email }
  } catch {
    return { status: 'failed', email }
  }
}

export async function answer(
  store: WaitlistStore | null,
  input: { email: unknown; text: unknown },
): Promise<AnswerState> {
  const email = normalizeEmail(input.email)
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_ANSWER) : ''
  if (!email || !text || !store) return { status: 'failed' }
  try {
    await store.answer(email, text)
    return { status: 'sent' }
  } catch {
    return { status: 'failed' }
  }
}

/** Returns the configured store, or null while no backend is chosen. */
export function getStore(): WaitlistStore | null {
  return null
}
