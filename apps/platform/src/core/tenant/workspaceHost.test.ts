import { describe, expect, it, vi } from 'vitest'

// Which page an address gets: a business's sign-in, "doesn't exist", the
// reserved page, "isn't available", or the app as before when there is no
// clear answer (or the host is not a business address at all).

vi.mock('@unifiedtree/sdk', () => ({
  useAuthStore: Object.assign(() => null, { getState: () => ({}) }),
  getAccessToken: () => '',
  setAccessToken: () => {},
}))

const { HttpError, subdomainOf } = await import('@/core/api/client')
const { resolveWorkspaceHost, resolveWorkspaceHostOnce, stateForError, workspaceHostAnswer } = await import('./workspaceHost')

const ok = (dto: object) => () => Promise.resolve(dto as never)
const fail = (e: unknown) => () => Promise.reject(e)
const notFound = (errorCode: string) => new HttpError('Workspace not found', 404, { status: 404, errorCode, message: 'Workspace not found' })

describe('which hosts are business addresses', () => {
  it('reads the business from <name>.unifiedtree.com and <name>.localhost', () => {
    expect(subdomainOf('tatagroups.unifiedtree.com')).toBe('tatagroups')
    expect(subdomainOf('Demo.localhost')).toBe('demo')
    expect(subdomainOf('admin.unifiedtree.com')).toBe('admin')
  })

  it('treats local, preview and nested hosts as no business, so dev and CI run as before', () => {
    expect(subdomainOf('localhost')).toBe('')
    expect(subdomainOf('127.0.0.1')).toBe('')
    expect(subdomainOf('unifiedtree-platform-git-main-acme.vercel.app')).toBe('')
    expect(subdomainOf('unifiedtree.com')).toBe('')
    expect(subdomainOf('a.b.unifiedtree.com')).toBe('')
  })
})

describe('resolving a business address', () => {
  it('no business address: the app as before, without asking the server', async () => {
    const lookup = vi.fn()
    expect(await resolveWorkspaceHost('', lookup)).toEqual({ kind: 'platform' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('a business: open, with its branding, from one lookup by subdomain', async () => {
    const lookup = vi.fn(ok({ workspaceName: 'Tata Groups', logoUrl: null, markUrl: null, status: 'ACTIVE' }))
    const s = await resolveWorkspaceHost('tatagroups', lookup)
    expect(s.kind).toBe('open')
    expect(lookup).toHaveBeenCalledWith('/v1/public/workspace-branding?subdomain=tatagroups')
  })

  it('an older server without the status field: open, as today', async () => {
    expect((await resolveWorkspaceHost('acme', ok({ workspaceName: 'Acme', logoUrl: null, markUrl: null }))).kind).toBe('open')
  })

  it('a business waiting for approval keeps today\'s flow (sign-in, then the pending page)', async () => {
    expect((await resolveWorkspaceHost('acme', ok({ workspaceName: 'Acme', status: 'PENDING_APPROVAL' }))).kind).toBe('open')
  })

  it('a suspended, closed or rejected business: unavailable', async () => {
    for (const status of ['SUSPENDED', 'TERMINATED', 'REJECTED']) {
      expect((await resolveWorkspaceHost('acme', ok({ workspaceName: 'Acme', status }))).kind).toBe('unavailable')
    }
  })

  it('an unknown address: not found', async () => {
    expect(await resolveWorkspaceHost('tata', fail(notFound('WORKSPACE_NOT_FOUND')))).toEqual({ kind: 'not_found' })
  })

  it('an unknown address on a server older than the code (production today): not found by its message', async () => {
    expect(await resolveWorkspaceHost('tata', fail(notFound('404 NOT_FOUND')))).toEqual({ kind: 'not_found' })
  })

  it('a UnifiedTree address (admin, marketing): reserved', async () => {
    expect(await resolveWorkspaceHost('admin', fail(notFound('WORKSPACE_RESERVED')))).toEqual({ kind: 'reserved' })
  })

  it('no clear answer (network, rate limit, server error, a 404 from something else): the app as before', async () => {
    expect(stateForError(new TypeError('Failed to fetch'))).toEqual({ kind: 'unknown' })
    expect(stateForError(new HttpError('Too many', 429))).toEqual({ kind: 'unknown' })
    expect(stateForError(new HttpError('Boom', 500))).toEqual({ kind: 'unknown' })
    expect(stateForError(new HttpError('The requested resource was not found', 404, { errorCode: 'NOT_FOUND', message: 'The requested resource was not found' }))).toEqual({ kind: 'unknown' })
    expect(stateForError(new SyntaxError('Unexpected token <'))).toEqual({ kind: 'unknown' })
  })

  it('a server that never answers: the app as before after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const pending = resolveWorkspaceHost('acme', () => new Promise(() => {}), 10_000)
      vi.advanceTimersByTime(10_001)
      expect(await pending).toEqual({ kind: 'unknown' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the answer, once it has come back (the sign-in page reads it at its first render)', () => {
  it('is kept for this page load, for the address it was asked about only', async () => {
    vi.stubGlobal('window', { location: { hostname: 'acme.unifiedtree.com' } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ workspaceName: 'Acme', status: 'ACTIVE' }), { status: 200 })))
    try {
      expect(workspaceHostAnswer('acme')).toBeNull()
      const pending = resolveWorkspaceHostOnce('acme')
      expect(workspaceHostAnswer('acme')).toBeNull()
      const state = await pending
      expect(state.kind).toBe('open')
      expect(workspaceHostAnswer('acme')).toBe(state)
      expect(workspaceHostAnswer('beta')).toBeNull()
      expect(resolveWorkspaceHostOnce('acme')).toBe(pending)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
