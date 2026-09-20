import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { Project, type CompilerOptions } from 'ts-morph'
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

  // A tsconfig, when present, supplies path aliases (`@/*`) that `route.ts` barrels
  // re-export through. Its baseUrl+paths are folded into the ts-morph Project so
  // `getModuleSpecifierSourceFile()` resolves alias imports. baseUrl MUST be made
  // absolute here: manually-added files resolve aliases against the Project's
  // compilerOptions, and a relative baseUrl would anchor to the wrong root.
  const compilerOptions: CompilerOptions = { allowJs: false }
  const tsconfigPath = join(rootDir, 'tsconfig.json')
  if (existsSync(tsconfigPath)) {
    try {
      const co = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, 'utf8')))?.compilerOptions
      if (co && typeof co === 'object') {
        const baseUrl = typeof co.baseUrl === 'string' ? resolve(rootDir, co.baseUrl) : rootDir
        compilerOptions.baseUrl = baseUrl
        if (co.paths && typeof co.paths === 'object') compilerOptions.paths = co.paths
      }
    } catch {
      // Malformed tsconfig degrades to no-alias resolution; barrels that needed an
      // alias then surface via the re-export skip-log rather than crashing.
    }
  }

  const project = new Project({
    compilerOptions,
    skipAddingFilesFromTsConfig: true,
  })
  const globs: string[] = []
  if (appDir) globs.push(join(appDir, '**/*.ts'), join(appDir, '**/*.tsx'))
  if (pagesApiDir) globs.push(join(pagesApiDir, '**/*.ts'))
  // shared code (imported schemas, service layers, barrel handler modules) must be
  // resolvable so route re-exports can reach their target declarations:
  for (const extra of [
    'lib',
    'src/lib',
    'server',
    'src/server',
    'utils',
    'src/utils',
    'modules',
    'src/modules',
  ]) {
    const p = join(rootDir, extra)
    if (existsSync(p)) globs.push(join(p, '**/*.ts'))
  }
  // middleware defines matcher-based auth protection at the project root:
  for (const mw of [join(rootDir, 'middleware.ts'), join(rootDir, 'src', 'middleware.ts')]) {
    if (existsSync(mw)) globs.push(mw)
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

// Strip `//` line and `/* */` block comments so a JSONC tsconfig parses, while
// leaving string contents (including comment-like sequences) untouched.
function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  return out
}
