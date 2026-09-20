import { prisma } from '../src/lib/db'

async function main() {
  await prisma.product.createMany({
    data: [
      { name: 'Red Shirt', priceCents: 1999, stock: 10 },
      { name: 'Blue Mug', priceCents: 899, stock: 25 },
      { name: 'Black Cap', priceCents: 1499, stock: 5 },
    ],
  })
}
main().then(() => process.exit(0))
