import { z } from 'zod'

export const createDocumentSchema = z.object({
  title: z.string(),
  folderId: z.string().optional(),
  tags: z.array(z.string()),
})
