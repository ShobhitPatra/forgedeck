import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../src/lib/db'

const createOrderSchema = z.object({
  email: z.string(),
  productId: z.string(),
  quantity: z.number(),
})

export async function POST(req: Request) {
  const body = createOrderSchema.parse(await req.json())
  const order = await prisma.order.create({
    data: {
      email: body.email,
      items: { create: [{ productId: body.productId, quantity: body.quantity }] },
    },
  })
  return NextResponse.json(order, { status: 201 })
}
