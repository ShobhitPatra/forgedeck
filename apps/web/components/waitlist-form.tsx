'use client'

import { useActionState, useId, useState } from 'react'
import { answerQuestion, joinWaitlist } from '@/app/actions'
import { copy } from '@/content/copy'
import { MAX_ANSWER, type AnswerState, type JoinState } from '@/lib/waitlist'

const c = copy.waitlist
const FIELD =
  'rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-faint focus-visible:outline-offset-0'
const PRIMARY =
  'h-10 rounded-md bg-foreground px-4 text-sm font-medium whitespace-nowrap text-background disabled:opacity-55'
const SECONDARY = 'h-10 rounded-md border border-line px-4 text-sm font-medium'

export function WaitlistForm() {
  const [state, action, pending] = useActionState<JoinState, FormData>(joinWaitlist, {
    status: 'idle',
  })
  const id = useId()

  if (state.status === 'joined') return <Joined email={state.email} />

  const message =
    state.status === 'invalid'
      ? c.invalid
      : state.status === 'duplicate'
        ? c.duplicate(state.email)
        : state.status === 'failed'
          ? c.failed
          : null
  const isError = state.status === 'invalid' || state.status === 'failed'

  return (
    <form action={action} className="flex max-w-md flex-col gap-3" noValidate>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-email`} className="sr-only">
          {c.label}
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={c.placeholder}
          defaultValue={state.status === 'idle' ? '' : state.email}
          aria-invalid={state.status === 'invalid'}
          aria-describedby={message ? `${id}-message` : undefined}
          className={`${FIELD} h-10 min-w-0 flex-1 basis-48 ${state.status === 'invalid' ? 'border-irreversible' : 'border-line'}`}
        />
        {/* Honeypot: hidden from people and assistive tech, irresistible to bots. */}
        <input
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? c.submitting : c.submit}
        </button>
      </div>
      {message && (
        <p
          id={`${id}-message`}
          role={isError ? 'alert' : 'status'}
          className={`text-sm ${isError ? 'text-irreversible' : 'text-muted'}`}
        >
          {message}
        </p>
      )}
    </form>
  )
}

function Joined({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AnswerState, FormData>(answerQuestion, {
    status: 'idle',
  })
  const [skipped, setSkipped] = useState(false)
  const id = useId()
  const confirmation = (
    <p role="status" className="text-sm">
      <span className="font-medium">{c.joined}</span>{' '}
      <span className="text-muted">{c.joinedDetail(email)}</span>
    </p>
  )

  if (skipped) return <div className="max-w-md">{confirmation}</div>
  if (state.status === 'sent') {
    return (
      <div className="flex max-w-md flex-col gap-2">
        {confirmation}
        <p className="text-sm text-muted">{c.thanks}</p>
      </div>
    )
  }

  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      {confirmation}
      <input type="hidden" name="email" value={email} />
      <label htmlFor={`${id}-answer`} className="text-sm text-muted">
        {c.question} <span className="text-foreground">{c.questionLabel}</span>
      </label>
      <textarea
        id={`${id}-answer`}
        name="answer"
        rows={3}
        maxLength={MAX_ANSWER}
        className={`${FIELD} border-line py-2`}
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? c.sending : c.send}
        </button>
        <button type="button" onClick={() => setSkipped(true)} className={SECONDARY}>
          {c.skip}
        </button>
      </div>
      {state.status === 'failed' && (
        <p role="alert" className="text-sm text-irreversible">
          {c.answerFailed}
        </p>
      )}
    </form>
  )
}
