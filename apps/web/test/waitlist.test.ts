import { describe, expect, it, vi } from 'vitest'
import { answer, getStore, join, normalizeEmail, type WaitlistStore } from '../lib/waitlist'

function store(over: Partial<WaitlistStore> = {}): WaitlistStore {
  return {
    join: vi.fn(async () => 'joined' as const),
    answer: vi.fn(async () => {}),
    ...over,
  }
}

describe('normalizeEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normalizeEmail('  Ana@Acme.DEV ')).toBe('ana@acme.dev')
  })

  it.each(['', 'ana', 'ana@acme', 'ana @acme.dev', '@acme.dev', null, 42])('rejects %j', (raw) => {
    expect(normalizeEmail(raw)).toBeNull()
  })
})

describe('join', () => {
  it('stores a valid email and reports joined', async () => {
    const s = store()
    expect(await join(s, { email: 'Ana@acme.dev', trap: '' })).toEqual({
      status: 'joined',
      email: 'ana@acme.dev',
    })
    expect(s.join).toHaveBeenCalledWith('ana@acme.dev')
  })

  it('echoes an invalid email back without touching the store', async () => {
    const s = store()
    expect(await join(s, { email: ' ana@acme ', trap: '' })).toEqual({
      status: 'invalid',
      email: 'ana@acme',
    })
    expect(s.join).not.toHaveBeenCalled()
  })

  it('reports a duplicate', async () => {
    const s = store({ join: async () => 'duplicate' })
    expect((await join(s, { email: 'ana@acme.dev', trap: '' })).status).toBe('duplicate')
  })

  it('shows a filled honeypot the success screen and stores nothing', async () => {
    const s = store()
    expect((await join(s, { email: 'bot@spam.io', trap: 'Spam Inc' })).status).toBe('joined')
    expect(s.join).not.toHaveBeenCalled()
  })

  it('never claims success when the store throws', async () => {
    const s = store({
      join: async () => {
        throw new Error('down')
      },
    })
    expect((await join(s, { email: 'ana@acme.dev', trap: '' })).status).toBe('failed')
  })

  it('never claims success while no store is configured', async () => {
    expect((await join(null, { email: 'ana@acme.dev', trap: '' })).status).toBe('failed')
  })
})

describe('answer', () => {
  it('stores a trimmed answer', async () => {
    const s = store()
    expect(await answer(s, { email: 'ana@acme.dev', text: '  refund orders  ' })).toEqual({
      status: 'sent',
    })
    expect(s.answer).toHaveBeenCalledWith('ana@acme.dev', 'refund orders')
  })

  it.each([
    ['blank text', { email: 'ana@acme.dev', text: '   ' }],
    ['bad email', { email: 'nope', text: 'refund orders' }],
  ])('fails on %s', async (_label, input) => {
    expect((await answer(store(), input)).status).toBe('failed')
  })
})

// Tripwire: the day a backend lands, this fails and reminds whoever wired it to
// replace it with a test of the real store.
describe('getStore', () => {
  it('is unconfigured until a backend is chosen', () => {
    expect(getStore()).toBeNull()
  })
})
