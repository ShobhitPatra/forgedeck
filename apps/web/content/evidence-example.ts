// Literal input and output: this handler (its two imports trimmed for display) was
// compiled with `opdeck build` and `tool` is the emitted tools.json entry,
// unedited, rendered in compact form. If the
// compiler's output shape changes, recompile and paste; never hand-tune it.
export const evidenceExample = {
  sourcePath: 'app/api/orders/[id]/route.ts',
  source: `/**
 * Cancel an order and delete its record.
 * @agent effect irreversible
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  await db.order.delete({ where: { id } });
  return new Response(null, { status: 204 });
}`,
  outputPath: '.agent/tools.json',
  tool: {
    name: 'delete_orders_by_id',
    description: 'Cancel an order and delete its record.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    kind: 'route',
    method: 'DELETE',
    path: '/api/orders/{id}',
    effect: 'irreversible',
    auth: 'required',
    enabled: false,
  },
} as const
