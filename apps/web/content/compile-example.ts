export const compileExample = {
  sourcePath: 'app/api/products/route.ts',
  source: `import { z } from "zod";
import { db } from "@/lib/db";

const query = z.object({
  category: z.string().optional(),
});

export async function GET(req: Request) {
  const params = query.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  const products = await db.product.findMany({
    where: { category: params.category },
  });
  return Response.json(products);
}`,
  terminalCommand: 'forgedeck build',
  terminalOutput: '✓ 1 route → .agent/actions/list-products.md, tools.json',
  tool: {
    name: 'list_products',
    effect: 'read' as const,
    route: 'GET /api/products',
    description: 'List products, optionally filtered by category.',
    inputs: 'category?: string',
    evidence: 'db.product.findMany · zod query schema',
  },
}
