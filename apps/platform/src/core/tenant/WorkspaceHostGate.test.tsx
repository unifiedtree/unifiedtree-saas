import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The pages shown instead of a sign-in: none of them has a sign-in form, and
// only the ones that are not a business's own link to UnifiedTree (white label).

vi.mock('@unifiedtree/sdk', () => ({
  useAuthStore: Object.assign(() => null, { getState: () => ({}) }),
  getAccessToken: () => '',
  setAccessToken: () => {},
}))

const { WorkspaceHostPage } = await import('./WorkspaceHostGate')

const html = (state: Parameters<typeof WorkspaceHostPage>[0]['state'], host: string) =>
  renderToStaticMarkup(<WorkspaceHostPage state={state} host={host} />)

describe('pages for addresses with no open business', () => {
  it('unknown address: doesn\'t exist, with the way back to unifiedtree.com and no sign-in', () => {
    const s = html({ kind: 'not_found' }, 'tata.unifiedtree.com')
    expect(s).toContain('This workspace doesn’t exist')
    expect(s).toContain('tata.unifiedtree.com')
    expect(s).toContain('href="https://www.unifiedtree.com"')
    expect(s).not.toMatch(/<form|<input|type="password"/)
  })

  it('UnifiedTree address: a neutral page, nothing business-like', () => {
    const s = html({ kind: 'reserved' }, 'admin.unifiedtree.com')
    expect(s).toContain('There’s no business here')
    expect(s).toContain('admin.unifiedtree.com')
    expect(s).not.toMatch(/<form|<input|type="password"/)
  })

  it('suspended business: its own name, no vendor link, no sign-in', () => {
    const s = html({ kind: 'unavailable', branding: { workspaceName: 'Acme Pvt Ltd', logoUrl: null, markUrl: null, status: 'SUSPENDED' } }, 'acme.unifiedtree.com')
    expect(s).toContain('This workspace isn’t available')
    expect(s).toContain('Acme Pvt Ltd')
    expect(s).not.toContain('unifiedtree.com"')
    expect(s).not.toMatch(/<form|<input|type="password"/)
  })
})
