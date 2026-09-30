import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { ColumnChart, columnHeight, Ledger, LedgerNet, StepTrack, Callout, type ColumnBar, type LedgerGroup } from './display'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1

describe('ColumnChart', () => {
  it('heights: the tallest column fills 86% (room for its figure), never below a 3% sliver', () => {
    expect(columnHeight({ pct: 100 }, 0)).toBeCloseTo(86)
    expect(columnHeight({ pct: 50 }, 0)).toBeCloseTo(43)
    expect(columnHeight({ pct: 140 }, 0)).toBeCloseTo(86)
    expect(columnHeight({ pct: 0 }, 0)).toBe(3)
    expect(columnHeight({ amount: 31.25 }, 62.5)).toBeCloseTo(43)
    expect(columnHeight({ amount: Number.NaN }, 62.5)).toBe(3)
    expect(columnHeight({ amount: 10 }, 0)).toBe(3)
    expect(columnHeight({}, 10)).toBe(3)
  })

  const bars: ColumnBar[] = [
    { key: 'apr', label: 'Apr', value: '₹59.6L', amount: 59.6, tip: 'April 2026 · ₹59.6 lakh gross · paid' },
    { key: 'may', label: 'May', value: '₹62.5L', amount: 62.5 },
    { key: 'sep', label: 'Sep', value: '₹61.0L', amount: 61, tone: 'warning' },
  ]

  it('a labelled figure: columns hidden from screen readers, the figures as a list instead', () => {
    const s = html(<ColumnChart bars={bars} label="Payroll cost, last 6 months" legend={[{ label: 'Paid', tone: 'brand' }, { label: 'In review', tone: 'warning' }]} />)
    expect(s).toContain('<figure class="uk-colchart" aria-label="Payroll cost, last 6 months">')
    expect(s).toContain('<div class="uk-colchart__plot" style="height:180px" aria-hidden="true">')
    expect(s).toContain('<ul class="uk-sr"><li>April 2026 · ₹59.6 lakh gross · paid</li><li>May: ₹62.5L</li><li>Sep: ₹61.0L</li></ul>')
    expect(s).toContain('<div class="uk-colchart__labels" aria-hidden="true"><span class="uk-colchart__l">Apr</span>')
    expect(s).toContain('<div class="uk-colchart__legend" aria-hidden="true">')
    expect(s).toContain('uk-colchart__sw--warning')
  })

  it('bars scale against the largest amount, grow in with a stagger, and take their tone', () => {
    const s = html(<ColumnChart bars={bars} label="x" height={200} />)
    expect(s).toContain('style="height:200px"')
    expect(s).toContain('class="uk-colchart__bar uk-colchart__bar--brand ufx-grow-y" style="height:82.0%;--i:0"')
    expect(s).toContain('class="uk-colchart__bar uk-colchart__bar--brand ufx-grow-y" style="height:86.0%;--i:1"')
    expect(s).toContain('class="uk-colchart__bar uk-colchart__bar--warning ufx-grow-y" style="height:83.9%;--i:2"')
    expect(s).toContain('<div class="uk-colchart__col" title="April 2026 · ₹59.6 lakh gross · paid">')
    expect(s).not.toContain('uk-colchart__legend')
  })

  it('a fixed max keeps the scale steady across periods', () => {
    const s = html(<ColumnChart bars={[{ label: 'Apr', value: '3', amount: 3 }]} max={6} label="Exits" />)
    expect(s).toContain('height:43.0%')
  })
})

describe('Ledger', () => {
  const groups: LedgerGroup[] = [
    {
      key: 'earn', title: 'Earnings', tone: 'success', totalLabel: 'Gross', total: '₹84,000',
      lines: [{ label: 'Basic', value: '₹42,000' }, { label: 'HRA', value: '₹16,800', note: '40% of basic' }],
    },
    {
      key: 'ded', title: 'Deductions', tone: 'danger', totalLabel: 'Total deductions', total: '₹7,400',
      lines: [{ label: 'PF', value: '₹5,040' }, { label: 'Income tax', value: '' }, { label: 'LWF', value: 'Not calculated yet', muted: true }],
    },
  ]

  it('groups are named, each line a term and its amount, with a total', () => {
    const s = html(<Ledger groups={groups} />)
    expect(count(s, 'role="group"')).toBe(2)
    const ids = [...s.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(s).toContain(`id="${id}" class="uk-ledger__title"`)
    expect(s).toContain('<span class="uk-ledger__dot uk-ledger__dot--success" aria-hidden="true"></span>')
    expect(s).toContain('<dt class="uk-ledger__k">HRA<span class="uk-ledger__note">40% of basic</span></dt><dd class="uk-ledger__v">₹16,800</dd>')
    expect(s).toContain('<div class="uk-ledger__total"><span>Gross</span><span class="uk-ledger__tv">₹84,000</span></div>')
  })

  it('missing amounts show a quiet dash; muted lines are quiet too', () => {
    const s = html(<Ledger groups={groups} />)
    expect(s).toContain('<dt class="uk-ledger__k">Income tax</dt><dd class="uk-ledger__v is-muted">—</dd>')
    expect(s).toContain('<dd class="uk-ledger__v is-muted">Not calculated yet</dd>')
  })

  it('net pay: a brand-soft banner (not a dark green block), with its note', () => {
    const s = html(<Ledger groups={groups} net={{ label: 'Net pay', value: '₹76,600', note: 'Preview until the run is locked' }} />)
    expect(s).toContain('<div class="uk-ledger-net" role="group" aria-label="Net pay"><div class="uk-ledger-net__text"><div class="uk-ledger-net__k">Net pay</div><div class="uk-ledger-net__note">Preview until the run is locked</div></div><div class="uk-ledger-net__v">₹76,600</div></div>')
    expect(html(<LedgerNet label="Take-home" value="₹1,02,300" />)).not.toContain('uk-ledger-net__note')
  })

  it('groups without a total leave the total row out; neutral is the default dot', () => {
    const s = html(<Ledger groups={[{ title: 'Employer', lines: [{ label: 'PF', value: '₹5,040' }] }]} />)
    expect(s).not.toContain('uk-ledger__total')
    expect(s).toContain('uk-ledger__dot--neutral')
  })
})

describe('StepTrack', () => {
  const steps = [
    { key: 'a', label: 'Attendance locked', meta: '25 Sep', state: 'done' as const },
    { key: 'b', label: 'Payroll calculated', meta: '231 payslips', state: 'done' as const },
    { key: 'c', label: 'Review', meta: 'In progress', state: 'current' as const },
    { key: 'd', label: 'Bank file', state: 'todo' as const },
  ]

  it('an ordered list; the current step is marked; states are spoken', () => {
    const s = html(<StepTrack steps={steps} label="Payroll run progress" />)
    expect(s).toContain('<ol class="uk-steps" aria-label="Payroll run progress">')
    expect(count(s, '<li class="uk-step')).toBe(4)
    expect(count(s, 'aria-current="step"')).toBe(1)
    expect(s).toContain('<li class="uk-step uk-step--current" aria-current="step">')
    expect(s).toContain('Attendance locked<span class="uk-sr">, done</span>')
    expect(s).toContain('Review<span class="uk-sr">, current step</span>')
    expect(s).toContain('Bank file<span class="uk-sr">, not started</span>')
  })

  it('done steps show a tick, the others their number; the line after a done step is lit', () => {
    const s = html(<StepTrack steps={steps} label="x" />)
    expect(count(s, '<path d="M20 6 9 17l-5-5"></path>')).toBe(2)
    expect(s).toContain('<span class="uk-step__dot">3</span>')
    expect(s).toContain('<span class="uk-step__dot">4</span>')
    expect(count(s, 'uk-step__line')).toBe(3)
    expect(count(s, 'uk-step__line is-on')).toBe(2)
    expect(count(s, 'uk-step__meta')).toBe(3)
  })
})

describe('Callout', () => {
  it('brand note with an info icon by default', () => {
    const s = html(<Callout>Payslips go out when you lock the run.</Callout>)
    expect(s).toMatch(/^<div class="uk-callout uk-tone--brand"><span class="uk-callout__icon" aria-hidden="true"><svg/)
    expect(s).toContain('<div class="uk-callout__text">Payslips go out when you lock the run.</div>')
    expect(s).not.toContain('role=')
  })

  it('tones, no icon, and a live announcement for results', () => {
    expect(html(<Callout tone="holiday">Fri 2 Oct is a holiday</Callout>)).toContain('uk-tone--holiday')
    expect(html(<Callout icon={null}>x</Callout>)).not.toContain('uk-callout__icon')
    expect(html(<Callout live tone="success">Sent to Siddharth</Callout>)).toContain('role="status"')
  })
})
