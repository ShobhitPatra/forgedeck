'use server'
import { authenticatedActionClient } from '../../lib/wrappers'
import { prisma } from '../../lib/db'

/**
 * @agent effect irreversible
 * @agent precondition account must be in good standing
 */
export const deleteSurvey = authenticatedActionClient.action(
  async (input: { surveyId: string }) => {
    await prisma.document.delete({ where: { id: input.surveyId } })
    return { ok: true }
  },
)
