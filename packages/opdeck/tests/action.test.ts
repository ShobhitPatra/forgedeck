/**
 * Lint-level validation of the opdeck-diff Action + dogfood workflow (Task 6).
 *
 * The real proof this feature works is the live dogfood run on the PR itself
 * (the sticky comment appearing, then updating to no-changes on revert). These
 * unit tests are a cheap tripwire against the two YAML files rotting: they check
 * the structural invariants that make the Action correct — GITHUB_TOKEN posture,
 * the sticky marker, silent-by-default, fork degradation, and the promise that
 * the workflow never gates the PR (no `--check`).
 *
 * We have no YAML parser dependency (adding one needs sign-off), so this does a
 * parser-free sanity pass: reject tabs and odd indentation (the common YAML lint
 * failures), then assert the load-bearing content is present.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const actionYml = join(repoRoot, '.github', 'actions', 'opdeck-diff', 'action.yml')
const workflowYml = join(repoRoot, '.github', 'workflows', 'opdeck-diff.yml')

// A YAML file must not indent with tabs, and block indentation here is 2-space.
// This catches the overwhelmingly common way these files break in review.
// Strip full-line comments so "does this file INVOKE --check?" is not fooled by
// prose that merely explains why we don't.
function nonCommentLines(text: string): string {
  return text
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
}

function assertWellFormedYaml(text: string): void {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    expect(line.slice(0, indent), `line ${i + 1} indents with a tab`).not.toContain('\t')
    expect(indent % 2, `line ${i + 1} has odd indentation`).toBe(0)
  }
}

describe('opdeck-diff action.yml', () => {
  const yml = readFileSync(actionYml, 'utf8')

  it('is well-formed (no tabs, 2-space indentation)', () => {
    assertWellFormedYaml(yml)
  })

  it('is a composite action with the base-sha input', () => {
    expect(yml).toMatch(/using:\s*composite/)
    expect(yml).toMatch(/base-sha:/)
    expect(yml).toMatch(/required:\s*true/)
  })

  it('runs the diff without --check (a report, never a gate)', () => {
    expect(yml).toMatch(/diff\b/)
    expect(yml).toMatch(/--format\s+md/)
    expect(nonCommentLines(yml)).not.toContain('--check')
  })

  it('upserts a sticky comment via the marker using github-script', () => {
    expect(yml).toContain('<!-- opdeck-diff -->')
    expect(yml).toContain('actions/github-script@v7')
    expect(yml).toMatch(/updateComment/)
    expect(yml).toMatch(/createComment/)
  })

  it('is silent by default but keeps an existing comment honest on empty', () => {
    // No new comment when empty + none exists; existing one updated to no-changes.
    expect(yml).toMatch(/No semantic changes/)
    expect(yml).toMatch(/staying silent/)
  })

  it('degrades to the job summary on fork PRs, never commenting', () => {
    expect(yml).toMatch(/head\?\.repo\?\.fork/)
    expect(yml).toMatch(/core\.summary/)
  })
})

describe('opdeck-diff workflow', () => {
  const yml = readFileSync(workflowYml, 'utf8')

  it('is well-formed (no tabs, 2-space indentation)', () => {
    assertWellFormedYaml(yml)
  })

  it('triggers only on fixture changes and grants pull-requests: write', () => {
    expect(yml).toMatch(/on:/)
    expect(yml).toMatch(/pull_request:/)
    expect(yml).toContain('packages/opdeck/tests/fixtures/**')
    expect(yml).toMatch(/pull-requests:\s*write/)
  })

  it('checks out full history and mirrors the ci.yml pnpm setup', () => {
    expect(yml).toMatch(/fetch-depth:\s*0/)
    expect(yml).toContain('pnpm/action-setup@v4')
    expect(yml).toContain('actions/setup-node@v4')
    expect(yml).toContain('pnpm install --frozen-lockfile')
  })

  it('invokes the local composite action with the PR base sha', () => {
    expect(yml).toContain('./.github/actions/opdeck-diff')
    expect(yml).toContain('github.event.pull_request.base.sha')
  })

  it('never passes --check (the workflow must not gate the PR)', () => {
    expect(nonCommentLines(yml)).not.toContain('--check')
  })
})
