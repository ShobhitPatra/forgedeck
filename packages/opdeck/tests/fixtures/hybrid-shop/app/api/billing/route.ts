import { chargeAndRecord } from '../../../lib/billing'

/**
 * Charges the customer's saved payment method and records the ledger entry.
 *
 * @internal never surface the raw processor response to tenant users
 * this trailing note sits after the first tag and must not be harvested
 */
export async function POST() {
  const charge = await chargeAndRecord(999)
  return Response.json(charge)
}
