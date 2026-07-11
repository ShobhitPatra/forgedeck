import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { Project } from 'ts-morph'
import type { Framework } from '../ir/types.js'

export interface LoadedProject {
  rootDir: string
  appDir?: string
  pagesApiDir?: string
  framework: Framework
  appName: string
  project: Project
  relPath(abs: string): string
}

export function loadProject(projectDir: string): LoadedProject {
  const rootDir = resolve(projectDir)
  const appDir = [join(rootDir, 'app'), join(rootDir, 'src', 'app')].find(existsSync)
  const pagesApiDir = [join(rootDir, 'pages', 'api'), join(rootDir, 'src', 'pages', 'api')].find(
    existsSync,
  )
  if (!appDir && !pagesApiDir) throw new Error(`no nextjs surfaces found: ${rootDir}`)
  const framework: Framework =
    appDir && pagesApiDir ? 'nextjs-hybrid' : appDir ? 'nextjs-app-router' : 'nextjs-pages-router'

  let appName = basename(rootDir)
  const pkgPath = join(rootDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg.name === 'string') appName = pkg.name
  }

  const project = new Project({
    compilerOptions: { allowJs: false },
    skipAddingFilesFromTsConfig: true,
  })
  const globs: string[] = []
  if (appDir) globs.push(join(appDir, '**/*.ts'), join(appDir, '**/*.tsx'))
  if (pagesApiDir) globs.push(join(pagesApiDir, '**/*.ts'))
  // shared code (imported schemas, service layers) must be resolvable:
  for (const extra of ['lib', 'src/lib', 'server', 'src/server', 'utils', 'src/utils']) {
    const p = join(rootDir, extra)
    if (existsSync(p)) globs.push(join(p, '**/*.ts'))
  }
  project.addSourceFilesAtPaths(globs)

  return {
    rootDir,
    appDir,
    pagesApiDir,
    framework,
    appName,
    project,
    relPath: (abs: string) => relative(rootDir, abs).split('\\').join('/'),
  }
}
