// The month calendar as markup (the repo has no DOM test environment): what a day shows, the chips
// with their counts, the agenda for today, sick leave apart, and what a viewer without leave access sees.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { holidayEvents, leaveEvents, milestoneEvents } from './calendarEvents'

const perms = new Set<string>(['leave.balance.read'])
vi.mock('@unifiedtree/sdk', async () => ({
  ...(await vi.importActual<object>('@unifiedtree/sdk')),
  usePermission: (code: string) => perms.has(code),
}))
vi.mock('../api/useSettings', () => ({
  useWeekendDays: () => ({ data: { weekendDays: [6, 7] } }),
  jsWeekendDays: (iso?: number[]) => new Set((iso ?? [6, 7]).map((d) => d % 7)),
}))
const lo = '2026-10-01', hi = '2026-10-31'
const events = [
  ...holidayEvents([{ id: 'h', holidayDate: '2026-10-20', holidayName: 'Diwali' }], lo, hi),
  ...leaveEvents([
    { id: 's', employeeName: 'Asha Verma', leaveTypeId: 'sl', leaveTypeName: 'Sick Leave', leaveTypeCategory: 'SICK', startDate: '2026-10-06', endDate: '2026-10-06', status: 'APPROVED' },
    { id: 'c', employeeName: 'Ravi Kumar', leaveTypeId: 'cl', leaveTypeName: 'Casual Leave', leaveTypeCategory: 'CASUAL', startDate: '2026-10-06', endDate: '2026-10-07', status: 'APPROVED' },
  ], lo, hi),
  ...milestoneEvents('birthday', [{ employeeId: 'e9', name: 'Meera Iyer', date: '2026-10-06' }], lo, hi),
]
const hook = vi.fn()
vi.mock('./useCalendarEvents', () => ({ useCalendarEvents: (...a: unknown[]) => hook(...a) }))
const { EventsCalendar } = await import('./EventsCalendar')

const ready = { events, loading: false, failed: [] as string[], leaveClipped: false, leaveScope: 'TEAM', refetch: () => {} }
const render = (props: Partial<Parameters<typeof EventsCalendar>[0]> = {}) =>
  renderToStaticMarkup(<EventsCalendar today="2026-10-06" companyId="co" {...props} />)

describe('EventsCalendar', () => {
  it('shows the month with every kind, sick leave apart, and today’s agenda', () => {
    hook.mockReturnValue(ready)
    const html = render()
    expect(html).toContain('October 2026')
    expect(html).toContain('Holidays, leave in your team, birthdays and work anniversaries')
    // the day cell names what is on it, for screen readers
    expect(html).toMatch(/aria-label="Tue, 6 Oct, today, Sick leave: Asha Verma, Leave: Ravi Kumar, Birthday: Meera Iyer"/)
    expect(html).toContain('ec-chip ec-k--sick')
    expect(html).toContain('Today · Tue, 6 Oct')
    expect(html).toContain('Sick Leave · 6 Oct')
    expect(html).toContain('ec-pill ec-k--sick')
    // chips with counts (things, not days), the leave-type pick (two types), the legend
    expect(html).toMatch(/Sick leave.*?1/)
    expect(html).toContain('Leave type')
    expect(html).toContain('Weekly off')
    // the six date picks live in the dialog; the agenda offers Start date / End date
    expect(html).toContain('Start date')
  })

  it('leaves leave out for someone who can’t read it', () => {
    perms.clear()
    hook.mockReturnValue({ ...ready, events: events.filter((e) => e.kind !== 'leave' && e.kind !== 'sick'), leaveScope: undefined })
    const html = render()
    expect(html).toContain('Holidays, birthdays and work anniversaries')
    expect(html).not.toContain('>Sick leave<')
    expect(hook.mock.calls.at(-2)?.[2]).toMatchObject({ canLeave: false })
    perms.add('leave.balance.read')
  })

  it('reports a failed source and keeps the rest', () => {
    hook.mockReturnValue({ ...ready, failed: ['holidays'] })
    expect(render()).toContain('Couldn’t load the holidays. The rest is shown.')
  })

  it('keeps a team’s own birthdays only', () => {
    hook.mockReturnValue(ready)
    expect(render({ people: new Set(['someone-else']) })).not.toContain('Meera Iyer')
  })
})
