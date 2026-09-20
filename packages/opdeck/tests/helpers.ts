import { Project } from 'ts-morph'
import type { LoadedProject } from '../src/load/project'

export function fakeLoaded(
  files: Record<string, string>,
  overrides?: Partial<LoadedProject>,
  compilerOptions?: Record<string, unknown>,
): LoadedProject {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions })
  for (const [path, content] of Object.entries(files)) project.createSourceFile(path, content)
  return {
    rootDir: '/',
    appDir: '/app',
    framework: 'nextjs-app-router' as const,
    appName: 'fake',
    project,
    relPath: (abs) => abs.replace(/^\//, ''),
    ...overrides,
  }
}
