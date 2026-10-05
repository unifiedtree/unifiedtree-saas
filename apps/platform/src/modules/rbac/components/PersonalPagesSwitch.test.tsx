import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PERSONAL_PAGES_LABEL, PersonalPagesSwitchView, personalPagesHint } from './PersonalPagesSwitch'

// Roles & permissions › a role › Personal pages (V143.90).
const ADMIN_DEFAULT = { enabled: false, overridden: false, defaultEnabled: false }
const ADMIN_ON = { enabled: true, overridden: true, defaultEnabled: false }
const render = (p: Partial<Parameters<typeof PersonalPagesSwitchView>[0]>) => renderToStaticMarkup(
  <PersonalPagesSwitchView roleName="Admin" setting={ADMIN_DEFAULT} canEdit ready onChange={() => {}} {...p} />)

describe('personal pages switch', () => {
  it('names what it covers and notes the default', () => {
    const html = render({})
    expect(html).toContain('Personal pages — My work, My leave, My claims, My goals and other “My” pages')
    expect(PERSONAL_PAGES_LABEL).toContain('My work')
    expect(html).toContain('Off by default for Owner and Admin roles')
    expect(html).toContain('at their next sign-in or page reload')
  })

  it('says whether the role uses its default or the owner changed it', () => {
    expect(personalPagesHint(ADMIN_DEFAULT)).toContain('This role uses its default (off).')
    expect(personalPagesHint({ enabled: true, overridden: false, defaultEnabled: true })).toContain('uses its default (on)')
    expect(personalPagesHint(ADMIN_ON)).toContain('The owner turned it on for this role.')
  })

  it('shows the switch as on or off', () => {
    expect(render({ setting: ADMIN_ON })).toContain('aria-checked="true"')
    expect(render({})).toContain('aria-checked="false"')
  })

  it('the owner can flip it', () => {
    const html = render({ canEdit: true })
    expect(html).not.toMatch(/role="switch"[^>]*disabled/)
    expect(html).not.toContain('Only the workspace owner can change this.')
  })

  it('everyone else sees it read-only, with why', () => {
    const html = render({ canEdit: false })
    expect(html).toMatch(/role="switch"[^>]*disabled/)
    expect(html).toContain('Only the workspace owner can change this.')
  })

  it('before the server can save it, even the owner can’t flip it', () => {
    const html = render({ canEdit: true, ready: false })
    expect(html).toMatch(/role="switch"[^>]*disabled/)
    expect(html).toContain('This isn’t switched on yet')
  })
})
