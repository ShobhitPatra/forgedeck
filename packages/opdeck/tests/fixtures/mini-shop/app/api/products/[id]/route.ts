import { NextResponse } from 'next/server'
import { prisma } from '../../../../src/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(product)
}
