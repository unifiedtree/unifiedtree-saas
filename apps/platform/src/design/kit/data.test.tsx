import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { SectionGrid, SectionCell, Timeline, CheckList, ActionCard, ActionCardGrid, DateChip, BulkBar } from './data'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1
const noop = () => {}

describe('SectionGrid', () => {
  it('wraps cards full or half width (UtSections), 16px apart', () => {
    const s = html(
      <SectionGrid>
        <SectionCell><div>A</div></SectionCell>
        <SectionCell width="half"><div>B</div></SectionCell>
      </SectionGrid>,
    )
    expect(s).toBe('<div class="uk-sgrid" style="--uk-sgap:16px"><div class="uk-sgrid__cell uk-sgrid__cell--full"><div>A</div></div><div class="uk-sgrid__cell uk-sgrid__cell--half"><div>B</div></div></div>')
  })
  it('equal heights, own gap, a group name', () => {
    const s = html(<SectionGrid gap={20} equal label="Shifts"><SectionCell>x</SectionCell></SectionGrid>)
    expect(s).toContain('role="group" aria-label="Shifts" class="uk-sgrid uk-sgrid--equal" style="--uk-sgap:20px"')
  })
})

describe('Timeline', () => {
  const steps = [
    { label: 'Sent', sub: 'Today, 1:58 PM', state: 'done' as const },
    { label: 'Siddharth Rao', sub: 'Reviewing now', state: 'current' as const },
    { label: 'Balance updated', sub: 'After approval', state: 'todo' as const },
  ]
  it('bars: an ordered list with one bar per step, the state spoken, the waiting step current', () => {
    const s = html(<Timeline items={steps} label="Leave request progress" />)
    expect(s).toContain('<ol class="uk-tl uk-tl--bars" aria-label="Leave request progress" style="--uk-tl-n:3">')
    expect(s).toContain('<li class="uk-tl__item is-done"><span class="uk-tl__bar" aria-hidden="true"></span><span class="uk-tl__label">Sent<span class="uk-sr">, done</span></span><span class="uk-tl__sub">Today, 1:58 PM</span></li>')
    expect(s).toContain('<li class="uk-tl__item is-current" aria-current="step">')
    expect(s).toContain('<span class="uk-sr">, in progress</span>')
    expect(s).toContain('<span class="uk-sr">, not yet</span>')
    expect(count(s, 'aria-current')).toBe(1)
  })
  it('a stopped request, and the words a page chooses for a state', () => {
    const s = html(<Timeline label="x" items={[{ label: 'Sent', state: 'todo' }, { label: 'You', sub: 'Stopped', state: 'failed', stateLabel: 'cancelled' }]} />)
    expect(s).toContain('is-failed')
    expect(s).toContain('<span class="uk-sr">, cancelled</span>')
    expect(s).toContain('--uk-tl-n:2')
  })
  it('rail: dots joined by a line, none after the last', () => {
    const s = html(<Timeline variant="rail" label="Lifecycle" items={[{ label: 'Joined', sub: '12 Mar 2022', state: 'done' }, { label: 'Notice started', sub: 'Not started', state: 'todo' }]} />)
    expect(s).toContain('<ol class="uk-tl uk-tl--rail" aria-label="Lifecycle">')
    expect(count(s, 'class="uk-tl__dot"')).toBe(2)
    expect(count(s, 'class="uk-tl__line"')).toBe(1)
    expect(s).not.toContain('uk-tl__time')
  })
  it('rail with times: the day’s punches (time · dot · what happened)', () => {
    const s = html(<Timeline variant="rail" label="Punches" items={[{ time: '09:24', label: 'Checked in', sub: 'Face · Bengaluru HQ', state: 'done' }, { time: '—', label: 'No check-out', sub: 'Fix it before payroll locks', state: 'failed', stateLabel: 'missed' }]} />)
    expect(s).toContain('uk-tl uk-tl--rail uk-tl--timed')
    expect(s).toContain('<span class="uk-tl__time">09:24</span><span class="uk-tl__dot" aria-hidden="true"></span>')
    expect(s).toContain(', missed')
    expect(s).not.toContain('uk-tl__line')
  })
})

describe('CheckList', () => {
  it('a mark per line, the state spoken first, a quiet line and an action', () => {
    const s = html(<CheckList label="Before you send" items={[
      { label: 'Within the ₹1,500 limit for meals', state: 'ok' },
      { label: 'Add a receipt. Claims without one take longer.', state: 'warn' },
      { label: 'Offer letter', sub: 'HR · due 3 Oct', state: 'todo', action: <button>Mark done</button> },
    ]} />)
    expect(s).toContain('<ul class="uk-checks" aria-label="Before you send">')
    expect(s).toContain('<li class="uk-checks__item is-ok"><span class="uk-checks__icon" aria-hidden="true"><svg')
    expect(s).toContain('<span class="uk-sr">Done: </span>Within the ₹1,500 limit for meals')
    expect(s).toContain('<span class="uk-sr">Needs attention: </span>Add a receipt.')
    expect(s).toContain('<span class="uk-checks__ring"></span>')
    expect(s).toContain('<span class="uk-checks__sub">HR · due 3 Oct</span>')
    expect(s).toContain('<span class="uk-checks__action"><button>Mark done</button></span>')
  })
  it('small size, a problem line, own words', () => {
    const s = html(<CheckList size="sm" items={[{ label: 'Over the limit', state: 'bad', stateLabel: 'Blocked' }]} />)
    expect(s).toContain('uk-checks uk-checks--sm')
    expect(s).toContain('is-bad')
    expect(s).toContain('Blocked: ')
  })
})

describe('ActionCard', () => {
  it('settled: tile, name as a heading, the green state, one secondary action', () => {
    const s = html(<ActionCard icon="file" title="PAN card" sub="Verified · 14 Mar 2022" status="Verified" secondary={{ label: 'View', onClick: noop }} />)
    expect(s).toMatch(/<article aria-labelledby="([^"]+)-t" class="ut-card uk-acard ufx-rise">/)
    expect(s).toContain('<span class="uk-acard__tile" aria-hidden="true"><svg')
    expect(s).toMatch(/<h3 id="[^"]+-t" class="uk-acard__title">PAN card<\/h3>/)
    expect(s).toContain('<p class="uk-acard__sub">Verified · 14 Mar 2022</p>')
    expect(s).toContain('<span class="uk-acard__state"><svg')
    expect(s).toContain('<span>Verified</span>')
    expect(s).toContain('uk-btn uk-btn--secondary uk-btn--s36')
    expect(s).not.toContain('uk-acard__ring')
  })
  it('needs the person: the gold ring, the gold pill, primary before secondary', () => {
    const s = html(<ActionCard icon="file" title="Address proof" status="Upload again" tone="action"
      primary={{ label: 'Upload new photo', onClick: noop }} secondary={{ label: 'View', onClick: noop }} />)
    expect(s).toContain('class="ut-card uk-acard uk-acard--action ufx-rise"')
    expect(s).toContain('<span class="uk-acard__ring" aria-hidden="true"></span>')
    expect(s).toContain('uk-pill uk-pill--sm uk-tone--warning uk-acard__pill')
    expect(s.indexOf('Upload new photo')).toBeLessThan(s.indexOf('>View<'))
    expect(s).toContain('uk-btn uk-btn--primary uk-btn--s36')
  })
  it('nested cards drop .ut-card; no state and no actions, no footer; heading level', () => {
    const s = html(<ActionCard title="Laptop" cardClass={false} headingLevel={2} />)
    expect(s).toContain('class="uk-acard ufx-rise"')
    expect(s).toContain('<h2 ')
    expect(s).not.toContain('uk-acard__foot')
    expect(s).not.toContain('uk-acard__tile')
  })
  it('the grid: auto-fill, 300px', () => {
    expect(html(<ActionCardGrid label="Your letters"><i /></ActionCardGrid>)).toBe('<div role="group" aria-label="Your letters" class="uk-acards" style="--uk-min:300px"><i></i></div>')
  })
})

describe('DateChip', () => {
  it('plain on Home: TODAY and the full date, as a <time>', () => {
    const s = html(<DateChip value="2026-09-25" today="2026-09-25" size="home" />)
    expect(s).toBe('<div class="uk-dchip uk-dchip--home"><span class="uk-dchip__tile" aria-hidden="true">'
      + s.slice(s.indexOf('<svg'), s.indexOf('</svg>') + 6)
      + '</span><span class="uk-dchip__text"><span class="uk-dchip__tag">Today</span><time class="uk-dchip__date" dateTime="2026-09-25">Friday, 25 September 2026</time></span></div>')
  })
  it('with onChange: the shared calendar’s combobox over the chip, named with the day shown', () => {
    const s = html(<DateChip value="2026-09-25" today="2026-09-25" max="2026-09-25" onChange={noop} />)
    expect(s).toContain('class="uk-dchip uk-dchip--dashboard is-button"')
    expect(s).toContain('<span class="uk-dchip__text" aria-hidden="true"><span class="uk-dchip__tag">Today</span><span class="uk-dchip__date">Friday, 25 September 2026</span></span>')
    expect(s).toContain('class="utc-field uk-dchip__field"')
    expect(s).toContain('role="combobox"')
    expect(s).toContain('aria-haspopup="dialog"')
    expect(s).toContain('aria-label="Choose the day to show. Showing today, Friday, 25 September 2026"')
    expect(s).toContain('class="uk-dchip__chev"')
  })
  it('another day reads VIEWING; own words and label', () => {
    const s = html(<DateChip value="2026-09-22" today="2026-09-25" onChange={noop} label="Choose dashboard date" />)
    expect(s).toContain('<span class="uk-dchip__tag">Viewing</span><span class="uk-dchip__date">Tuesday, 22 September 2026</span>')
    expect(s).toContain('aria-label="Choose dashboard date. Showing Tuesday, 22 September 2026"')
    expect(html(<DateChip value="2026-09-22" today="2026-09-25" tag="Past day" />)).toContain('>Past day</span>')
  })
})

describe('BulkBar', () => {
  it('nothing while nothing is selected', () => {
    expect(html(<BulkBar selected={[]} onClear={noop} />)).toBe('')
    expect(html(<BulkBar count={0} onClear={noop} />)).toBe('')
  })
  it('a named toolbar: the count (a live region), the actions, Clear selection', () => {
    const s = html(<BulkBar selected={new Set(['a', 'b', 'c'])} onClear={noop} actions={[
      { key: 'shift', label: 'Assign shift', onClick: noop },
      { key: 'letter', label: 'Send letter', onClick: noop, disabled: true, title: 'You can’t send letters' },
      { key: 'export', label: 'Export', onClick: noop, busy: true },
    ]} />)
    expect(s).toContain('<div role="toolbar" aria-label="Bulk actions" class="uk-bulk uk-bulk--inset ufx-pop">')
    expect(s).toContain('<span class="uk-bulk__count" role="status" aria-live="polite">3 selected</span>')
    expect(s).toContain('<button type="button" class="uk-bulk__btn">Assign shift</button>')
    expect(s).toContain('title="You can’t send letters" disabled=""')
    expect(s).toContain('class="uk-bulk__btn is-busy" aria-busy="true"><span class="uk-bulk__spin" aria-hidden="true"></span>Export')
    expect(s).toContain('aria-label="Clear selection"')
  })
  it('an array works too; own words; outside a card', () => {
    const s = html(<BulkBar selected={[1, 2]} onClear={noop} inset={false} countLabel={(n) => `${n} people picked`} />)
    expect(s).toContain('class="uk-bulk ufx-pop"')
    expect(s).toContain('>2 people picked</span>')
  })
})
