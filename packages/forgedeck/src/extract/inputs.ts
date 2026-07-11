import type { SourceFile } from 'ts-morph'
import type { InputField } from '../ir/types.js'

const ZOD_TYPE: Record<string, InputField['type']> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
}

export function extractInputs(sourceFile: SourceFile, handlerBodyText: string): InputField[] {
  for (const decl of sourceFile.getVariableDeclarations()) {
    const init = decl.getInitializer()?.getText() ?? ''
    if (!init.startsWith('z.object(')) continue
    const name = decl.getName()
    if (!new RegExp(`\\b${name}\\.(?:safeParse|parse)\\(`).test(handlerBodyText)) continue

    const fields: InputField[] = []
    // Heads and chain calls may carry arguments: z.enum([...]), z.coerce.number(),
    // z.string().min(1).optional() (grill patch Q3). Known limit: nested parens
    // like z.array(z.object({...})) are not matched; full AST introspection is Plan 2.
    for (const m of init.matchAll(/(\w+):\s*z\.([\w.]+)\(([^)]*)\)((?:\.\w+\([^)]*\))*)/g)) {
      const [, fieldName, zodHead, , chain] = m
      const zodType = zodHead.split('.').pop() ?? ''
      fields.push({
        name: fieldName,
        type: ZOD_TYPE[zodType] ?? 'unknown',
        required: !chain.includes('.optional()'),
      })
    }
    return fields
  }
  return []
}
