export function routePathFromFile(relFile: string): string {
  const noApp = relFile.replace(/^app\//, '').replace(/\/route\.tsx?$/, '')
  const segments = noApp
    .split('/')
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.startsWith('[') && s.endsWith(']') ? `{${s.slice(1, -1)}}` : s))
  return '/' + segments.join('/')
}

function snake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
}

export function routeToName(method: string, path: string): string {
  const parts = path
    .replace(/^\/api\//, '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith('{')) return `by_${snake(p.replace(/[{}.]/g, ''))}`
      return snake(p)
    })
  return [method.toLowerCase(), ...parts].join('_').replace(/_+/g, '_')
}

export function paramsFromPath(path: string): string[] {
  return [...path.matchAll(/\{(?:\.\.\.)?(\w+)\}/g)].map((m) => m[1])
}

export function fnToName(fnName: string): string {
  return fnName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
