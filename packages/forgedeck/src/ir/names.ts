export function routePathFromFile(relFile: string): string {
  const noApp = relFile.replace(/^app\//, '').replace(/\/route\.tsx?$/, '')
  const segments = noApp
    .split('/')
    .map((s) => (s.startsWith('[') && s.endsWith(']') ? `{${s.slice(1, -1)}}` : s))
  return '/' + segments.join('/')
}

export function routeToName(method: string, path: string): string {
  const parts = path
    .replace(/^\/api\//, '')
    .split('/')
    .map((p) => (p.startsWith('{') ? `by_${p.slice(1, -1)}` : p))
  return [method.toLowerCase(), ...parts].join('_').replace(/[^a-z0-9_]/g, '_')
}

export function fnToName(fnName: string): string {
  return fnName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
