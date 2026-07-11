import {
  Node,
  type SourceFile,
  type CallExpression,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph'

export type FnLike = FunctionDeclaration | ArrowFunction | FunctionExpression

export function asFnLike(node: Node | undefined): FnLike | undefined {
  if (!node) return undefined
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  )
    return node
  return undefined
}

// Resolve a named identifier to a function node: a local declaration or
// const-arrow/function-expression initializer first, then across the file's
// named/default imports into the imported module (contract rules 1 and 2).
export function resolveFn(sf: SourceFile, name: string): FnLike | undefined {
  const localFn = sf.getFunction(name)
  if (localFn) return localFn
  const localInit = asFnLike(sf.getVariableDeclaration(name)?.getInitializer())
  if (localInit) return localInit

  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierSourceFile()
    if (!mod) continue
    for (const spec of imp.getNamedImports()) {
      const alias = spec.getAliasNode()?.getText()
      if (name !== (alias ?? spec.getName())) continue
      const exported =
        mod.getFunction(spec.getName()) ??
        asFnLike(mod.getVariableDeclaration(spec.getName())?.getInitializer())
      if (exported) return exported
    }
    if (imp.getDefaultImport()?.getText() === name) {
      const df = mod.getFunctions().find((f) => f.isDefaultExport())
      if (df) return df
    }
  }
  return undefined
}

// The function value carried by an object-literal property: an inline
// arrow/function expression, or an identifier resolved to a function node.
function propFn(sf: SourceFile, prop: Node): FnLike | undefined {
  if (Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer()
    const inline = asFnLike(init)
    if (inline) return inline
    if (init && Node.isIdentifier(init)) return resolveFn(sf, init.getText())
  }
  return undefined
}

// The handler function inside a wrapper call's first argument, across the three
// mainstream shapes: an inline arrow/function expression; an object literal whose
// `handler` key (or sole function-valued property) is the handler; or an
// identifier resolved locally then across imports (routes contract rule 1).
export function handlerFromWrapperArg(sf: SourceFile, arg: Node): FnLike | undefined {
  const inline = asFnLike(arg)
  if (inline) return inline

  if (Node.isObjectLiteralExpression(arg)) {
    const handlerProp = arg.getProperty('handler')
    if (handlerProp) {
      const named = propFn(sf, handlerProp)
      if (named) return named
    }
    const fnProps = arg.getProperties().flatMap((p) => propFn(sf, p) ?? [])
    return fnProps.length === 1 ? fnProps[0] : undefined
  }

  if (Node.isIdentifier(arg)) return resolveFn(sf, arg.getText())
  return undefined
}

// The terminal `.action(handler)` call of an action-client chain, recognized
// STRUCTURALLY: walking down from the chain's outermost expression, the first
// CallExpression whose callee is a property access named `action` — regardless
// of chain shape, length, or any trailing links after it (`client.inputSchema(Z)
// .action(fn)`, `a.b(1).c().action(fn)`, `client.action(fn).metadata(m)`). Returns
// that call together with the chain ROOT identifier (server actions contract).
export function terminalActionCall(node: Node): { call: CallExpression; root: string } | undefined {
  let current: Node | undefined = node
  while (current) {
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression()
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'action') {
        const target = callee.getExpression()
        return { call: current, root: chainRoot(target) ?? target.getText() }
      }
      current = callee
      continue
    }
    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isParenthesizedExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    return undefined
  }
  return undefined
}

// The leftmost identifier of a property/call chain: the ROOT that named the
// wrapping client (e.g. `authenticatedActionClient` in
// `authenticatedActionClient.schema(z).action(fn)`) — server actions contract.
export function chainRoot(node: Node): string | undefined {
  let current: Node | undefined = node
  while (current) {
    if (Node.isIdentifier(current)) return current.getText()
    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isCallExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isParenthesizedExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    return undefined
  }
  return undefined
}
