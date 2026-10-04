import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { HeaderTabs } from './HeaderTabs'
import { SubTabs } from '@/design/dc/SubTabs'
import { Views } from '@/design/module/ModuleKit'

const items = [
  { key: 'my', label: 'My leave' },
  { key: 'approvals', label: 'Approvals', count: 3, urgent: true },
  { key: 'history', label: 'Decided', count: 0 },
]

describe('HeaderTabs (a page’s own views, in the page: SHELL CONTRACT UPDATE)', () => {
  it('renders where it stands, as views: role=group + aria-pressed', () => {
    const html = renderToString(createElement(HeaderTabs, { label: 'Leave views', items, active: 'approvals', onChange: () => {} }))
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Leave views"')
    expect(html).toContain('ut-htabs--inline')
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1)
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2)
    expect(html).not.toContain('role="tab"')
  })

  it('keeps the counts inside the button (0 shows no count); urgent ones are marked', () => {
    const html = renderToString(createElement(HeaderTabs, { label: 'Leave views', items, active: 'my', onChange: () => {} }))
    expect(html).toMatch(/<span>Approvals<\/span><span class="ut-htab-n is-urgent">3<\/span>/)
    expect(html).not.toMatch(/Decided<\/span><span class="ut-htab-n/)
  })

  it('tabs semantics: role=tablist + role=tab + aria-selected', () => {
    const html = renderToString(createElement(HeaderTabs, { label: 'Attendance sections', items, active: 'my', onChange: () => {}, semantics: 'tabs' }))
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)?.length).toBe(3)
    expect(html).toContain('aria-selected="true"')
  })
})

describe('placement on the legacy bars (ModuleKit Views, design/dc SubTabs)', () => {
  const sub = [
    { key: 'p', label: 'Pending', count: 2, urgent: true, active: true, onClick: () => {} },
    { key: 'd', label: 'Decided', count: '', onClick: () => {} },
  ]

  it('inline (the default) is the in-page bar: role=group + aria-pressed, counts kept', () => {
    const html = renderToString(createElement(SubTabs, { label: 'Overtime views', items: sub }))
    expect(html).toContain('dcsub')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Overtime views"')
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1)
    expect(html).toMatch(/Pending<\/span><\/span><span class="uk-fpill__n dcsub-n"><span class="sc-interp">2<\/span>/)
    // ModuleKit Views is the kit PillTabs now (4 Oct): the same group/pressed semantics, the kit's pill classes.
    const views = renderToString(createElement(Views, { label: 'Leave views', items: [{ key: 'a', label: 'A' }], active: 'a', onChange: () => {} }))
    expect(views).toContain('role="group"')
    expect(views).toContain('aria-pressed="true"')
    expect(views).toContain('uk-ptabs')
  })

  it('placement="header" no longer moves a page’s views into the top bar: the same in-page bar', () => {
    const inline = renderToString(createElement(SubTabs, { label: 'Overtime views', items: sub }))
    const header = renderToString(createElement(SubTabs, { label: 'Overtime views', items: sub, placement: 'header' }))
    expect(header).toBe(inline)
    const views = renderToString(createElement(Views, { label: 'Leave views', items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', count: 4 }], active: 'b', onChange: () => {}, placement: 'header' }))
    expect(views).toContain('aria-label="Leave views"')
    expect(views).toContain('uk-ptabs')
    expect(views).toMatch(/<span>B<\/span><span class="uk-count uk-count--neutral uk-count--sm">4<\/span>/)
  })
})
