// HR Configuration, 6 Oct: the probation "Extend automatically" switch is hidden (auto-extension kept for
// later), and the page waits for the company instead of flashing its sections empty (regression: it
// treated "no company chosen yet" as loaded). Rendered as markup (the repo has no DOM test environment).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const co = { companyId: '', company: null as null | { id: string; name: string }, multi: false, isLoading: true }
const q = (data: unknown, isLoading = false) => ({ data, isLoading, error: null, refetch: async () => ({}), notAvailable: false })
let probation = { reminderDaysBefore: 14, autoExtendEnabled: true, autoExtendDays: 30 }

vi.mock('@unifiedtree/sdk', async () => ({ ...(await vi.importActual<object>('@unifiedtree/sdk')), usePermission: () => true }))
vi.mock('../company/CurrentCompany', () => ({ useCurrentCompany: () => co, useCompanySwitchGuard: () => {} }))
const mutation = { mutateAsync: async () => ({ available: true }), mutate: () => {}, isPending: false }
vi.mock('../api/useSettings', () => ({
  useHrConfig: (id: string) => (id ? q({ employeeCodePrefix: 'EMP', employeeCodeNextNumber: 1, employeeCodePadding: 4, probationPeriodMonths: 6, defaultNoticePeriodDays: 30, retirementAge: 60, workweekStartDay: 1, weekendDays: [6, 7] }) : q(undefined)),
  useUpdateHrConfig: () => mutation,
}))
vi.mock('../api/useProbation', () => ({
  useProbationConfig: () => q(probation), useUpdateProbationConfig: () => mutation, useProbationReminders: () => q([]), useTriggerProbationScan: () => mutation,
}))
vi.mock('../api/useAttendanceReview', () => ({
  useAttendancePolicy: (id?: string) => (id ? q({ graceMinutes: 10, defaultStartTime: '09:15', lateAllowanceCount: 0, lateAllowancePeriod: 'MONTH', afterAllowanceAction: 'KEEP_LATE', earlyLeaveMinutes: 0 }) : q(undefined)),
  useSaveAttendancePolicy: () => mutation,
}))
vi.mock('../api/shared/useWebPunchSetting', () => ({ useWebPunchSetting: () => q(undefined), useSaveWebPunchSetting: () => mutation }))
vi.mock('../api/shared/usePunchAlertSetting', () => ({ usePunchAlertSetting: () => q(undefined), usePunchAlertOptions: () => q(undefined), useSavePunchAlertSetting: () => mutation }))
vi.mock('../api/shared/useCelebrationSetting', () => ({ useCelebrationSetting: () => q(undefined), useSaveCelebrationSetting: () => mutation }))

import { HrConfigurationPage } from './HrConfigurationPage'

const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/hrms/settings']}><HrConfigurationPage /></MemoryRouter>)

beforeEach(() => {
  Object.assign(co, { companyId: '', company: null, multi: false, isLoading: true })
  probation = { reminderDaysBefore: 14, autoExtendEnabled: true, autoExtendDays: 30 }
})

describe('HR Configuration', () => {
  it('waits while the company is still being worked out (no sections flashing in empty)', () => {
    const html = render()
    expect(html).toContain('aria-label="Loading HR settings"')
    expect(html).not.toContain('Employee IDs</')
  })

  it('shows the sections once the company is known', () => {
    Object.assign(co, { companyId: 'c1', company: { id: 'c1', name: 'Acme' }, isLoading: false })
    const html = render()
    expect(html).not.toContain('aria-label="Loading HR settings"')
    expect(html).toContain('Remind managers and HR')
  })

  it('no company at all (the list loaded empty): not stuck loading', () => {
    Object.assign(co, { isLoading: false })
    expect(render()).not.toContain('aria-label="Loading HR settings"')
  })

  it('probation: no "Extend automatically" switch or "auto-extends" summary, even when it is stored as on', () => {
    Object.assign(co, { companyId: 'c1', company: { id: 'c1', name: 'Acme' }, isLoading: false })
    const html = render()
    expect(html).not.toContain('Extend automatically')
    expect(html).not.toContain('auto-extends')
    expect(html).not.toContain('Extend by')
    expect(html).toContain('reminders 14 days before it ends')
  })
})
