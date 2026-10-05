// The "Select date" picker on the attendance request forms (C-10): Fix a day (regularization) and
// Request overtime pick their one day on the picker, single-day mode, with the person's weekly offs
// and the company's holidays, inside each form's own limits. Rendered as markup (no DOM test
// environment): the side panel is drawn in place and the picker dialog shows the props it was given.
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { addDays, istToday } from '@/design/dc/dates'
import type { DateRangeDialogProps } from '@/design/kit/DateRangePicker'

const ok = <T,>(data: T) => ({ data, isLoading: false, isFetching: false, error: null, isError: false, refetch: () => Promise.resolve() })
const mutation = { mutateAsync: async () => ({}), mutate: () => {}, isPending: false }

vi.mock('@/design/kit/overlays', async () => ({
  ...(await vi.importActual<object>('@/design/kit/overlays')),
  SidePanel: ({ open, title, children, footer }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode }) =>
    open ? <section aria-label={title}>{children}{footer}</section> : null,
}))
vi.mock('@/design/kit/DateRangePicker', async () => ({
  ...(await vi.importActual<object>('@/design/kit/DateRangePicker')),
  DateRangeDialog: (p: DateRangeDialogProps) => (
    <div data-picker="" data-mode={p.mode} data-from={p.from} data-min={p.min ?? ''} data-max={p.max ?? ''} data-title={p.title}
      data-off={[...p.calendar.off].sort().join(',')} data-holidays={[...p.calendar.holidays.keys()].join(',')} />
  ),
}))
vi.mock('../ess/home/homeApi', async () => ({
  ...(await vi.importActual<object>('../ess/home/homeApi')),
  useMeEmployee: () => ok({ companyId: 'c1', weeklyOffDays: '7' }),
}))
vi.mock('../api/useSettings', async () => ({
  ...(await vi.importActual<object>('../api/useSettings')),
  useWeekendDays: () => ok({ weekendDays: [6, 7] }),
  useHolidays: (companyId: string, year: number) => ok(companyId ? [
    { holidayDate: `${year}-01-26`, holidayName: 'Republic Day', active: true },
    { holidayDate: `${year}-08-15T00:00:00`, holidayName: 'Independence Day', active: true },
    { holidayDate: `${year}-03-01`, holidayName: 'Withdrawn', active: false },
  ] : undefined),
}))
vi.mock('../api/useAttendance', async () => ({ ...(await vi.importActual<object>('../api/useAttendance')), useCreateCorrection: () => mutation }))
vi.mock('../api/useOvertime', async () => ({ ...(await vi.importActual<object>('../api/useOvertime')), useRequestOvertime: () => mutation }))
vi.mock('../api/shared/useApprovers', () => ({ useApprovers: () => ({ ...ok({ approver: { name: 'Priya Rao' } }), notAvailable: false }) }))

import { FixDayPanel } from './daily/FixDayPanel'
import { RequestOvertimePanel } from './shifts/MyOvertime'

const wrap = (el: JSX.Element) => {
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{el}</QueryClientProvider>)
}
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const attr = (s: string, name: string) => new RegExp(`data-${name}="([^"]*)"`).exec(s)?.[1]

describe('Fix a day', () => {
  const today = istToday()

  it('picks the day on the picker, not a browser date box', () => {
    const s = wrap(<FixDayPanel open onClose={() => {}} prefill={{ date: '2026-09-14' }} />)
    expect(s).not.toContain('type="date"')
    expect(s).toContain('aria-haspopup="dialog"')
    expect(s).toContain('Which day')
    expect(s).toContain('14/09/2026')
  })

  it('single day, up to today, with the person’s weekly offs and the company’s holidays', () => {
    const s = wrap(<FixDayPanel open onClose={() => {}} />)
    expect(attr(s, 'mode')).toBe('single')
    expect(attr(s, 'max')).toBe(today)
    expect(attr(s, 'min')).toBe('')
    expect(attr(s, 'from')).toBe(addDays(today, -1))
    expect(s).toContain(ddmmyyyy(addDays(today, -1)))
    // Their own weekly off (Sunday, ISO 7) wins over the company's Sat + Sun.
    expect(attr(s, 'off')).toBe('0')
    const year = Number(today.slice(0, 4))
    const holidays = attr(s, 'holidays')?.split(',') ?? []
    expect(holidays).toContain(`${year}-01-26`)
    expect(holidays).toContain(`${year - 1}-08-15`)
    expect(holidays.some((d) => d.endsWith('-03-01'))).toBe(false)
  })
})

describe('Request overtime', () => {
  const today = '2026-10-06'

  it('picks the day on the picker, 60 days back to 30 ahead', () => {
    const s = wrap(<RequestOvertimePanel open onClose={() => {}} today={today} minimumMinutes={60} />)
    expect(s).not.toContain('type="date"')
    expect(s).toContain('Day *')
    expect(s).toContain('06/10/2026')
    expect(s).toContain('Up to 60 days back or 30 days ahead.')
    expect(attr(s, 'mode')).toBe('single')
    expect(attr(s, 'min')).toBe('2026-08-07')
    expect(attr(s, 'max')).toBe('2026-11-05')
    expect(attr(s, 'holidays')).toBe('2026-01-26,2026-08-15')
  })
})
