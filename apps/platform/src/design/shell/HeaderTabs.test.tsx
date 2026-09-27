import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { HeaderSections, HeaderSlotProvider, HeaderTabs } from './HeaderTabs'
import { SubTabs, subTabsHeaderProps } from '@/design/dc/SubTabs'
import { Views } from '@/design/module/ModuleKit'

const items = [
  { key: 'my', label: 'My leave' },
  { key: 'approvals', label: 'Approvals', count: 3, urgent: true },
  { key: 'history', label: 'Decided', count: 0 },
]

describe('HeaderTabs (shell contract 1)', () => {
  it('outside the shell it renders in place, as views: role=group + aria-pressed', () => {
    const html = renderToString(createElement(HeaderTabs, { label: 'Leave views', items, active: 'approvals', onChange: () => {} }))
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Leave views"')
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

  it('inside the shell it waits for the header slot instead of flashing in place', () => {
    const html = renderToString(createElement(HeaderSlotProvider, null, createElement(HeaderTabs, { label: 'Leave views', items, active: 'my', onChange: () => {} })))
    expect(html).not.toContain('Leave views')
  })

  it('the dashboard’s section pills are a nav with aria-current="location"', () => {
    const html = renderToString(createElement(HeaderSections, { label: 'Dashboard sections', items: [{ key: 'overview', label: 'Overview' }, { key: 'people', label: 'People' }], active: 'people', onSelect: () => {} }))
    expect(html).toContain('<nav aria-label="Dashboard sections"')
    expect(html).toContain('aria-current="location"')
  })
})

describe('placement on the legacy bars (ModuleKit Views, design/dc SubTabs)', () => {
  const sub = [
    { key: 'p', label: 'Pending', count: 2, urgent: true, active: true, onClick: () => {} },
    { key: 'd', label: 'Decided', count: '', onClick: () => {} },
  ]

  it('inline (the default) is today’s bar, unchanged', () => {
    const html = renderToString(createElement(SubTabs, { label: 'Overtime views', items: sub }))
    expect(html).toContain('dcsub')
    expect(html).not.toContain('ut-htabs')
    const views = renderToString(createElement(Views, { label: 'Leave views', items: [{ key: 'a', label: 'A' }], active: 'a', onChange: () => {} }))
    expect(views).toContain('dcsub')
  })

  it('header: the HeaderTabs bar with the same group/pressed semantics and counts (in place outside the shell)', () => {
    const html = renderToString(createElement(SubTabs, { label: 'Overtime views', items: sub, placement: 'header' }))
    expect(html).toContain('ut-htabs')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Overtime views"')
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1)
    expect(html).toMatch(/<span>Pending<\/span><span class="ut-htab-n is-on">2<\/span>/)
    expect(html).not.toMatch(/Decided<\/span><span class="ut-htab-n/)
  })

  it('header inside the shell waits for the top bar’s slot (Views passes placement through)', () => {
    const html = renderToString(createElement(HeaderSlotProvider, null,
      createElement(Views, { label: 'Leave views', items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', count: 4 }], active: 'b', onChange: () => {}, placement: 'header' })))
    expect(html).not.toContain('Leave views')
  })

  it('a header pill runs the item’s own onClick; the active item is the one flagged active', () => {
    const hits: string[] = []
    const props = subTabsHeaderProps({ label: 'X', items: [{ key: 'a', label: 'A', onClick: () => hits.push('a') }, { key: 'b', label: 'B', active: true, onClick: () => hits.push('b') }] })
    expect(props.active).toBe('b')
    props.onChange('a')
    expect(hits).toEqual(['a'])
    expect(subTabsHeaderProps({ items: [] }).label).toBe('Views')
  })
})
