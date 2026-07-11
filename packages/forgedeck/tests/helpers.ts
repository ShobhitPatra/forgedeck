import { Project } from 'ts-morph'
import type { LoadedProject } from '../src/load/project'

export function fakeLoaded(files: Record<string, string>): LoadedProject {
  const project = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) project.createSourceFile(path, content)
  return {
    rootDir: '/',
    appDir: '/app',
    appName: 'fake',
    project,
    relPath: (abs) => abs.replace(/^\//, ''),
  }
}
