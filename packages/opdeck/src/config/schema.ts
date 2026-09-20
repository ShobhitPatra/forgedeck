import { z } from 'zod'

// The config is opdeck's authorization audit surface: one committed, diffable
// file answering "what may agents do in this deployment?" Parsing is deliberately
// strict and loud — a silently-ignored typo in a safety allowlist is a safety bug,
// so unknown keys are rejected (with did-you-mean) and config errors fail the build.

/**
 * The public storefront setting. `true` is the auto-curated storefront (only actions
 * that are provably public reads). `{ actions }` adds explicitly named actions to that
 * auto-curated set — each named non-read is a deliberate public mutation, logged loudly.
 */
export type PublicConfig = true | { actions: string[] }

export interface OpdeckConfig {
  /** Path globs never extracted; coverage logs 'excluded by config'. */
  exclude?: string[]
  /** Bundle output directory. */
  out?: string
  /** Mutations enabled in ALL environments (base). Exact action names only. */
  enabledActions?: string[]
  /** Per-environment overlay. An environment's `enabledActions` REPLACES the base list;
   * an environment's `public` REPLACES the base `public` when present. */
  environments?: Record<string, { enabledActions?: string[]; public?: PublicConfig }>
  /**
   * The v1 public storefront. When set, `opdeck build` ALSO emits a separate,
   * pruned `.agent-public/` bundle (never the internal one): only provably-public
   * READ actions (`auth: 'none'`, derived or annotated) survive by construction,
   * plus any explicitly named in `actions` (a deliberate, loudly-logged commitment).
   * `true` is the auto-curated storefront (public reads only). By construction the
   * full internal map can never become public — accidental exposure is impossible.
   */
  public?: PublicConfig
  /** Gates bridge-shim generation. Default false. */
  bridges?: boolean
}

/** Typed identity helper (Vite/Next convention) — gives editor completion and
 * type-checking on the config object while keeping it plain, statically-readable data. */
export function defineConfig(config: OpdeckConfig): OpdeckConfig {
  return config
}

/**
 * A config error is the sole deliberate exception to opdeck's never-break-the-build
 * rule: shipping with misread authorization config is more dangerous than not shipping,
 * so the build fails loudly. Callers that surface this to a build should print
 * {@link ConfigError.explanation} alongside the message.
 */
export class ConfigError extends Error {
  static readonly explanation =
    'Config errors fail the build deliberately — the one exception to opdeck never breaking your build, because shipping with misread authorization config is worse than not shipping.'
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

// zod value schema. Unknown-key detection is handled manually (below) to attach
// did-you-mean suggestions; the strict schema is defense-in-depth on value types.
// `public`: either the literal `true` (auto-curated storefront) or `{ actions: [...] }`.
// Strict on the object shape so a typo like `{ action: [...] }` fails loudly rather
// than silently naming zero actions — a safety allowlist must not be silently empty.
const publicSchema = z.union([z.literal(true), z.strictObject({ actions: z.array(z.string()) })])
const environmentSchema = z.strictObject({
  enabledActions: z.array(z.string()).optional(),
  public: publicSchema.optional(),
})
const valueSchema = z.strictObject({
  exclude: z.array(z.string()).optional(),
  out: z.string().optional(),
  enabledActions: z.array(z.string()).optional(),
  environments: z.record(z.string(), environmentSchema).optional(),
  public: publicSchema.optional(),
  bridges: z.boolean().optional().default(false),
})

export type ParsedConfig = z.infer<typeof valueSchema>

const KNOWN_KEYS = ['exclude', 'out', 'enabledActions', 'environments', 'public', 'bridges']

// Minimal iterative Levenshtein — no dependency. Powers the "did you mean" hint
// for a mistyped top-level config key, and (reused by compile) the near-match
// suggestion for an allowlisted action name that matched no extracted action.
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = Array.from({ length: n + 1 }, () => 0)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// Nearest known key within a small edit distance (scaled to the typo length so
// short keys don't match everything). Returns undefined when nothing is close.
function nearestKey(key: string): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  for (const known of KNOWN_KEYS) {
    const d = levenshtein(key.toLowerCase(), known.toLowerCase())
    if (d < bestDist) {
      bestDist = d
      best = known
    }
  }
  const threshold = Math.max(2, Math.floor(key.length / 3))
  return best !== undefined && bestDist <= threshold ? best : undefined
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.join('.')
      return path ? `${path}: ${i.message}` : i.message
    })
    .join('; ')
}

/**
 * Validate a raw config object (the config file's default export). Throws
 * {@link ConfigError} on any problem. Applies the `bridges` default.
 */
export function parseConfig(raw: unknown): ParsedConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('config default export must be an object')
  }
  const obj = raw as Record<string, unknown>

  // Unknown top-level keys are rejected loudly, with a did-you-mean over known keys.
  for (const key of Object.keys(obj)) {
    if (KNOWN_KEYS.includes(key)) continue
    const near = nearestKey(key)
    throw new ConfigError(
      near
        ? `unknown config key '${key}' — did you mean '${near}'?`
        : `unknown config key '${key}'`,
    )
  }

  const result = valueSchema.safeParse(obj)
  if (!result.success) throw new ConfigError(formatZodError(result.error))
  return result.data
}

export interface ResolvedEnvironment {
  name: string
  source: 'OPDECK_ENV' | 'NODE_ENV' | 'default'
  enabledActions: string[]
  /** The resolved public-storefront setting: the base `public`, REPLACED wholesale
   * by the selected environment's `public` when that block declares one. Undefined
   * when neither the base nor the active overlay opts in. */
  public?: PublicConfig
  line: string
}

/**
 * Resolve which environment applies and the effective `enabledActions`.
 * Selection: OPDECK_ENV -> NODE_ENV -> base. The selected environment's
 * `enabledActions` (when present) REPLACES the base list wholesale — every
 * environment block is a complete, self-contained answer.
 */
export function resolveEnvironment(
  config: OpdeckConfig,
  env: { OPDECK_ENV?: string; NODE_ENV?: string },
): ResolvedEnvironment {
  let name: string
  let source: ResolvedEnvironment['source']
  if (env.OPDECK_ENV) {
    name = env.OPDECK_ENV
    source = 'OPDECK_ENV'
  } else if (env.NODE_ENV) {
    name = env.NODE_ENV
    source = 'NODE_ENV'
  } else {
    name = 'base'
    source = 'default'
  }

  let enabledActions = config.enabledActions ?? []
  let publicConfig = config.public
  const overlay = source === 'default' ? undefined : config.environments?.[name]
  if (overlay?.enabledActions !== undefined) enabledActions = overlay.enabledActions
  // Replace semantics, identical to enabledActions: an environment block that names
  // `public` is a complete, self-contained answer for that environment.
  if (overlay?.public !== undefined) publicConfig = overlay.public

  return {
    name,
    source,
    enabledActions,
    public: publicConfig,
    line: `environment: ${name} (via ${source})`,
  }
}
