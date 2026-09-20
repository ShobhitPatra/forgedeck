'use server'
import { z } from 'zod'
import { prisma } from '../../src/lib/db'

const addToCartSchema = z.object({
  productId: z.string(),
  quantity: z.number(),
})

export async function addToCart(input: { productId: string; quantity: number }) {
  const parsed = addToCartSchema.parse(input)
  const product = await prisma.product.update({
    where: { id: parsed.productId },
    data: { stock: { decrement: parsed.quantity } },
  })
  return product
}
