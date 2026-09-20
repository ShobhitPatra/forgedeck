'use server'

import { answer, getStore, join, type AnswerState, type JoinState } from '@/lib/waitlist'

export async function joinWaitlist(_prev: JoinState, form: FormData): Promise<JoinState> {
  return join(getStore(), { email: form.get('email'), trap: form.get('company') })
}

export async function answerQuestion(_prev: AnswerState, form: FormData): Promise<AnswerState> {
  return answer(getStore(), { email: form.get('email'), text: form.get('answer') })
}
