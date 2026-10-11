// The business's sign-in page at its first render (rendered as markup: the repo has no DOM test environment).
// Signed in on the website: "Signing you in…" and no form, so the form never flashes before the website's sign-in
// is tried (silentSignIn.ts). Otherwise the form, exactly as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const host = vi.hoisted(() => ({ answer: null as unknown }))
vi.mock('@/core/tenant/workspaceHost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/tenant/workspaceHost')>()),
  workspaceHostAnswer: () => host.answer,
}))
vi.mock('@/core/tenant/workspaceBranding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/tenant/workspaceBranding')>()),
  useWorkspaceBranding: () => ({
    isWorkspace: true, workspaceName: 'Acme', monogram: 'A', logoUrl: null, markUrl: null,
    logoSize: null, markSize: null, loginUrl: null, loaded: true,
  }),
  usePageTitle: () => {},
}))
const sdk = vi.hoisted(() => ({ state: { status: 'idle', loginWithCredentials: () => {} } as Record<string, unknown> }))
vi.mock('@unifiedtree/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@unifiedtree/sdk')>()
  const useAuthStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(sdk.state), { getState: () => sdk.state })
  return { ...real, useAuthStore }
})

const { LoginPage } = await import('./LoginPage')

let stored: Map<string, string>
beforeEach(() => {
  stored = new Map()
  host.answer = { kind: 'open', branding: { workspaceName: 'Acme', status: 'ACTIVE' } }
  sdk.state.status = 'idle'
  vi.stubGlobal('window', {
    location: { hostname: 'acme.unifiedtree.com', pathname: '/login', search: '', hash: '', port: '', protocol: 'https:', href: 'https://acme.unifiedtree.com/login' },
    localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v) }, removeItem: (k: string) => { stored.delete(k) } },
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  })
})
afterEach(() => { vi.unstubAllGlobals() })

const page = (url = '/login') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><LoginPage /></MemoryRouter>)
const hasForm = (html: string) => /type="password"/.test(html) && /type="email"/.test(html)

describe('the sign-in page, first render', () => {
  it('may use the website’s sign-in: "Signing you in…", no form, no other ways in', () => {
    for (const status of ['idle', 'loading', 'unauthenticated']) {
      sdk.state.status = status
      const html = page()
      expect(html, status).toContain('Signing you in…')
      expect(html).toContain('role="status"')
      expect(hasForm(html)).toBe(false)
      expect(html).not.toContain('Continue with Google')
      expect(html).not.toContain('Sign in to Acme')
    }
  })

  it('after "Sign out" on this business: the form, at once', () => {
    stored.set('ut.signed-out:acme', '1')
    const html = page()
    expect(hasForm(html)).toBe(true)
    expect(html).toContain('Sign in to Acme')
    expect(html).not.toContain('Signing you in…')
  })

  it('over a refusal (?error=): the form and the refusal, at once', () => {
    const html = page('/login?error=USE_PASSWORD_FOR_TWO_FACTOR')
    expect(hasForm(html)).toBe(true)
    expect(html).toContain('Your account uses two-factor sign-in')
    expect(html).not.toContain('Signing you in…')
  })

  it('where the address lookup did not say "an open business": the form, at once', () => {
    for (const answer of [null, { kind: 'unknown' }]) {
      host.answer = answer
      const html = page()
      expect(hasForm(html), JSON.stringify(answer)).toBe(true)
      expect(html).not.toContain('Signing you in…')
    }
  })
})
