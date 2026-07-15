export const compileExample = {
  sourcePath: 'app/api/products/route.ts',
  source: `import { z } from "zod";
import { db } from "@/lib/db";

const query = z.object({
  category: z.string().optional(),
});

/** List products, optionally filtered by category. */
export async function GET(req: Request) {
  const params = query.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  const products = await db.product.findMany({
    where: { category: params.category },
  });
  return Response.json(products);
}`,
  terminalCommand: 'next build',
  terminalOutput:
    'forgedeck ✓ 1 actions (1 reads enabled, 0 mutations locked) · 0 entities · 0 warnings → .agent/',
  tool: {
    name: 'get_products',
    effect: 'read' as const,
    route: 'GET /api/products',
    description: 'List products, optionally filtered by category.',
    inputs: '`category` (string, optional)',
    evidence: 'effect read via db.product.findMany',
  },
}
