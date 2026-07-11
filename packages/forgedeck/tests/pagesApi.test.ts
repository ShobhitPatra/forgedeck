import { describe, it, expect } from 'vitest'
import { loadProject } from '../src/load/project'
import { fakeLoaded } from './helpers'
import { extractPagesApi } from '../src/extract/pagesApi'

describe('extractPagesApi', () => {
  const { actions, skipped } = extractPagesApi(loadProject('tests/fixtures/hybrid-shop'))

  it('extracts one action per discriminated method across all export forms and control flow', () => {
    const names = actions.map((a) => a.name).sort()
    // get_debug is gone: its handler carries `@agent ignore` (honored in Task 3).
    expect(names).toEqual([
      'delete_documents_by_id',
      'get_documents',
      'get_documents_by_id',
      'get_folders',
      'get_health',
      'get_teams',
      'post_documents',
      'post_folders',
      'post_views',
      'put_settings',
    ])
  })
  it('attributes early-return guard remainder to its method with evidence', () => {
    const views = actions.find((a) => a.name === 'post_views')!
    expect(views.effect).toBe('write')
    expect(views.evidence).toContain('method POST via early return guard')
    const settings = actions.find((a) => a.name === 'put_settings')!
    expect(settings).toMatchObject({ effect: 'write', entitiesTouched: ['User'] })
    expect(settings.evidence).toContain('method PUT via early return guard')
  })
  it('splits else-if dispatch chains into one action per arm', () => {
    const get = actions.find((a) => a.name === 'get_folders')!
    const post = actions.find((a) => a.name === 'post_folders')!
    expect(get.effect).toBe('read')
    expect(post.effect).toBe('write')
    expect(post.entitiesTouched).toEqual(['Document'])
  })
  it('resolves extended schemas across files', () => {
    const put = actions.find((a) => a.name === 'put_settings')!
    expect(put.inputs).toContainEqual({
      name: 'email',
      type: 'string',
      required: true,
      location: 'body',
    })
    expect(put.inputs).toContainEqual({
      name: 'theme',
      type: 'string',
      required: false,
      location: 'body',
    })
    expect(put.inputs).toContainEqual({
      name: 'notifyOnShare',
      type: 'boolean',
      required: true,
      location: 'body',
    })
  })
  it('extracts handler map dispatch', () => {
    const { actions: mapActions } = extractPagesApi(
      fakeLoaded(
        {
          '/pages/api/tags.ts': `
      async function list() { return db.product.findMany() }
      async function create() { return db.product.create({ data: {} }) }
      const handlers = { GET: list, POST: create }
      export default function handler(req, res) { return handlers[req.method]?.(req, res) }
    `,
        },
        { pagesApiDir: '/pages/api' },
      ),
    )
    expect(mapActions.map((a) => a.name).sort()).toEqual(['get_tags', 'post_tags'])
    expect(mapActions.find((a) => a.name === 'post_tags')!.effect).toBe('write')
  })
  it('resolves identifier and wrapped default exports', () => {
    expect(actions.find((a) => a.name === 'get_health')).toBeTruthy()
    const teams = actions.find((a) => a.name === 'get_teams')!
    expect(teams).toMatchObject({ effect: 'read', enabled: true, entitiesTouched: ['User'] })
  })
  it('classifies and locks correctly', () => {
    const post = actions.find((a) => a.name === 'post_documents')!
    expect(post).toMatchObject({
      kind: 'pages-api',
      method: 'POST',
      path: '/api/documents',
      effect: 'write',
      enabled: false,
      entitiesTouched: ['Document'],
    })
    expect(post.inputs).toContainEqual({
      name: 'title',
      type: 'string',
      required: true,
      location: 'body',
    })
    expect(post.inputs).toContainEqual({
      name: 'tags',
      type: 'unknown',
      required: true,
      location: 'body',
    })
    const del = actions.find((a) => a.name === 'delete_documents_by_id')!
    expect(del).toMatchObject({ effect: 'write', enabled: false })
    const get = actions.find((a) => a.name === 'get_documents')!
    expect(get).toMatchObject({ effect: 'read', enabled: true })
  })
  it('adds path params as required path inputs', () => {
    const get = actions.find((a) => a.name === 'get_documents_by_id')!
    expect(get.inputs).toContainEqual({
      name: 'id',
      type: 'string',
      required: true,
      location: 'path',
    })
  })
  it('emits the fallback GET for undiscriminated tail', () => {
    // [id].ts falls through to findUnique with no explicit GET comparison:
    // the DELETE branch is discriminated, the tail read is the undiscriminated remainder.
    // Expected behavior per rules: methods found = [DELETE]; tail exists but has no discriminator,
    // so ALSO emit the conservative fallback for the remainder ONLY when zero methods matched.
    // Here DELETE matched, so no fallback is emitted; the tail read is attributed to GET
    // only if a GET comparison exists. It does not, so get_documents_by_id must come from
    // the fallback rule NOT firing. This test documents the decision:
    expect(skipped).toContainEqual({
      file: 'pages/api/documents/[id].ts',
      reason: 'undiscriminated code after method branches, attributed to GET',
    })
  })
})
