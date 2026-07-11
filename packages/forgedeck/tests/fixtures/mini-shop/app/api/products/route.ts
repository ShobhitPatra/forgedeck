import { NextResponse } from 'next/server'
import { prisma } from '../../../src/lib/db'

export async function GET() {
  const products = await prisma.product.findMany()
  return NextResponse.json(products)
}
