import { Node, SyntaxKind, type SourceFile, type VariableDeclaration } from 'ts-morph'
import type { InputField } from '../ir/types.js'

const ZOD_TYPE: Record<string, InputField['type']> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
}

function findSchemaDecl(sf: SourceFile, name: string): VariableDeclaration | undefined {
  const local = sf.getVariableDeclaration(name)
  if (local && (local.getInitializer()?.getText() ?? '').startsWith('z.object(')) return local
  for (const imp of sf.getImportDeclarations()) {
    if (!imp.getNamedImports().some((n) => n.getName() === name)) continue
    const target = imp.getModuleSpecifierSourceFile()
    const decl = target?.getVariableDeclaration(name)
    if (decl && (decl.getInitializer()?.getText() ?? '').startsWith('z.object(')) return decl
  }
  return undefined
}

function fieldsFromZodObject(
  decl: VariableDeclaration,
  location: InputField['location'],
): InputField[] {
  const call = decl.getInitializerIfKind(SyntaxKind.CallExpression)
  const objArg = call?.getArguments()[0]
  if (!objArg || !Node.isObjectLiteralExpression(objArg)) return []
  const fields: InputField[] = []
  for (const prop of objArg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue
    const chainText = prop.getInitializer()?.getText() ?? ''
    const base =
      chainText
        .match(/^z\.([\w.]+)\(/)?.[1]
        ?.split('.')
        .pop() ?? ''
    fields.push({
      name: prop.getName(),
      type: ZOD_TYPE[base] ?? 'unknown',
      required: !/\.(optional|default)\(/.test(chainText),
      location,
    })
  }
  return fields
}

function locationForParseCall(handlerBodyText: string, schemaName: string): InputField['location'] {
  const m = handlerBodyText.match(new RegExp(`\\b${schemaName}\\.(?:safeParse|parse)\\(([^)]*)`))
  const arg = m?.[1] ?? ''
  if (/searchParams|req\.query|fromEntries/.test(arg)) return 'query'
  return 'body'
}

export function extractInputs(sourceFile: SourceFile, handlerBodyText: string): InputField[] {
  const used = [...handlerBodyText.matchAll(/\b(\w+)\.(?:safeParse|parse)\(/g)].map((m) => m[1])
  for (const name of used) {
    if (name === 'JSON') continue
    const decl = findSchemaDecl(sourceFile, name)
    if (decl) return fieldsFromZodObject(decl, locationForParseCall(handlerBodyText, name))
  }
  const bare: InputField[] = []
  for (const src of ['query', 'body'] as const) {
    const m = handlerBodyText.match(new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*req\\.${src}`))
    if (m) {
      for (const raw of m[1].split(',')) {
        const name = raw.split(':')[0].trim()
        if (/^\w+$/.test(name)) bare.push({ name, type: 'unknown', required: false, location: src })
      }
    }
  }
  return bare
}
