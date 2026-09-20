// Single source of truth for the displayed CLI version: the compiler package's
// own package.json. Bump opdeck's version and the landing nav follows.
import pkg from '../../../packages/opdeck/package.json'

export const version = pkg.version
