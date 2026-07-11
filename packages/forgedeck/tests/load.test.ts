import { describe, it, expect } from 'vitest'
import { loadProject } from '../src/load/project'

describe('loadProject', () => {
  it('loads the mini-shop fixture', () => {
    const loaded = loadProject('tests/fixtures/mini-shop')
    expect(loaded.appName).toBe('mini-shop')
    expect(loaded.appDir?.endsWith('app')).toBe(true)
    const files = loaded.project.getSourceFiles().map((f) => loaded.relPath(f.getFilePath()))
    expect(files).toContain('app/api/products/route.ts')
    expect(files).toContain('app/actions/cart.ts')
  })
  it('loads the hybrid fixture with both surfaces', () => {
    const loaded = loadProject('tests/fixtures/hybrid-shop')
    expect(loaded.framework).toBe('nextjs-hybrid')
    expect(loaded.appDir?.endsWith('app')).toBe(true)
    expect(loaded.pagesApiDir?.endsWith('pages/api')).toBe(true)
    const files = loaded.project.getSourceFiles().map((f) => loaded.relPath(f.getFilePath()))
    expect(files).toContain('pages/api/documents.ts')
    expect(files).toContain('lib/schemas.ts')
  })
  it('detects app router only as before', () => {
    expect(loadProject('tests/fixtures/mini-shop').framework).toBe('nextjs-app-router')
  })
  it('throws when no nextjs surfaces exist', () => {
    expect(() => loadProject('src')).toThrow(/no nextjs surfaces/)
  })
})
