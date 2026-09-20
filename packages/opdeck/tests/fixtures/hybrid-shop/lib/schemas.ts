import { z } from 'zod'

export const createDocumentSchema = z.object({
  title: z.string(),
  folderId: z.string().optional(),
  tags: z.array(z.string()),
})

export const baseSettingsSchema = z.object({
  email: z.string(),
  theme: z.string().optional(),
})

export const updateSettingsSchema = baseSettingsSchema.extend({
  notifyOnShare: z.boolean(),
})
