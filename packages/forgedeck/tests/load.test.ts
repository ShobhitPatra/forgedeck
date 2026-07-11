import { describe, it, expect } from 'vitest'
import { loadProject } from '../src/load/project'

describe('loadProject', () => {
  it('loads the mini-shop fixture', () => {
    const loaded = loadProject('tests/fixtures/mini-shop')
    expect(loaded.appName).toBe('mini-shop')
    expect(loaded.appDir.endsWith('app')).toBe(true)
    const files = loaded.project.getSourceFiles().map((f) => loaded.relPath(f.getFilePath()))
    expect(files).toContain('app/api/products/route.ts')
    expect(files).toContain('app/actions/cart.ts')
  })
  it('throws for a directory without app/', () => {
    expect(() => loadProject('src')).toThrow(/no app directory/)
  })
})
