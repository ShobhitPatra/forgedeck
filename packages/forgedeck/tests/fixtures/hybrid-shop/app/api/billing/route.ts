import { chargeAndRecord } from '../../../lib/billing'

export async function POST() {
  const charge = await chargeAndRecord(999)
  return Response.json(charge)
}
