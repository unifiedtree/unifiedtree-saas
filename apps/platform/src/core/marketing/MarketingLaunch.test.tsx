// The Marketing tile, the business frame's button and the company chooser, rendered as markup (the repo has no DOM
// test environment). The dialogs themselves need a document; their body is what is checked here.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarketingAppTile, MarketingChooserBody, MarketingLaunchDialog, MarketingShellLink } from './MarketingLaunch'
import type { MarketingLauncher } from './useMarketingLauncher'

const idle = { start: () => {}, busyId: null, chooserOpen: false }
const companies = [
  { companyId: 'c1', name: 'UnifiedTree Demo', current: true },
  { companyId: 'c2', name: 'Second Co', current: false },
]

describe('the tile', () => {
  it('is an app tile called Marketing', () => {
    const html = renderToStaticMarkup(<MarketingAppTile launcher={idle} />)
    expect(html).toContain('class="ut-app"')
    expect(html).toContain('>Marketing<')
    expect(html).toContain('data-app="marketing"')
    expect(html).not.toContain('aria-busy')
  })
  it('says it is opening while the ticket is fetched', () => {
    const html = renderToStaticMarkup(<MarketingAppTile launcher={{ ...idle, busyId: 'c1' }} />)
    expect(html).toContain('Opening Marketing…')
    expect(html).toContain('aria-busy="true"')
  })
  it('the business frame: a Marketing button next to All apps', () => {
    const html = renderToStaticMarkup(<MarketingShellLink launcher={idle} />)
    expect(html).toContain('ut-biz__apps ut-biz__mkt')
    expect(html).toContain('aria-label="Marketing"')
  })
})

describe('the chooser', () => {
  it('lists the companies, the current one marked', () => {
    const html = renderToStaticMarkup(<MarketingChooserBody companies={companies} busyId={null} error={null} onPick={() => {}} />)
    expect(html).toContain('UnifiedTree Demo')
    expect(html).toContain('Second Co')
    expect(html).toContain('Current company')
    expect(html.indexOf('UnifiedTree Demo')).toBeLessThan(html.indexOf('Second Co'))
    expect(html).not.toContain('uk-callout')
  })
  it('while one opens, none can be picked', () => {
    const html = renderToStaticMarkup(<MarketingChooserBody companies={companies} busyId="c2" error={null} onPick={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('Opening…')
  })
  it('a refusal shows in plain words above the list', () => {
    const html = renderToStaticMarkup(<MarketingChooserBody companies={companies} busyId={null} error="MARKETING_NOT_ENTITLED" onPick={() => {}} />)
    expect(html).toContain('uk-callout')
    expect(html).toContain('This company doesn’t have Marketing. Ask your administrator to add it.')
    expect(html).not.toContain('MARKETING_NOT_ENTITLED')
  })
})

describe('the dialog', () => {
  const launcher = (over: Partial<MarketingLauncher>): MarketingLauncher => ({
    visible: true, companies, busyId: null, error: null, chooserOpen: false,
    start: () => {}, launch: () => {}, retry: () => {}, dismiss: () => {}, ...over,
  })
  it('nothing to show: renders nothing', () => {
    expect(renderToStaticMarkup(<MarketingLaunchDialog launcher={launcher({})} />)).toBe('')
  })
})
