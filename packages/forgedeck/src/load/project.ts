import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { Project } from 'ts-morph'

export interface LoadedProject {
  rootDir: string
  appDir: string
  appName: string
  project: Project
  relPath(abs: string): string
}

export function loadProject(projectDir: string): LoadedProject {
  const rootDir = resolve(projectDir)
  const appDir = [join(rootDir, 'app'), join(rootDir, 'src', 'app')].find(existsSync)
  if (!appDir) throw new Error(`no app directory found: ${rootDir}`)

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
  project.addSourceFilesAtPaths([join(appDir, '**/*.ts'), join(appDir, '**/*.tsx')])

  return {
    rootDir,
    appDir,
    appName,
    project,
    relPath: (abs: string) => relative(rootDir, abs).split('\\').join('/'),
  }
}
