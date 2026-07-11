import { prisma } from './db'

const stripe = { charges: { create: async (_: unknown) => ({ id: 'ch_1' }) } }

export async function chargeAndRecord(amountCents: number) {
  const charge = await stripe.charges.create({ amount: amountCents })
  await prisma.order.create({ data: { id: 'o1', email: 'x@y.z' } })
  return charge
}
