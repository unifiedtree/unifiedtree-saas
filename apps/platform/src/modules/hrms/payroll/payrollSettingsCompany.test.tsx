// Payroll settings per company (V143.105, owner decision 7 Oct 2026): the settings page shows and saves
// the chosen company's settings, names the company in its heading, and another company shows its own.
// Rendered as markup (the repo has no DOM test environment).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

const auth = vi.hoisted(() => ({ state: { status: 'authenticated', user: { id: 'u-1', roles: ['OWNER'] }, tenant: { id: 't-1' }, modules: [] } as Record<string, unknown> }))
vi.mock('@unifiedtree/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@unifiedtree/sdk')>()
  const useAuthStore = Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(auth.state), { getState: () => auth.state })
  return { ...real, useAuthStore, useAnyPermission: () => true, usePermission: () => true, getAccessToken: () => '' }
})
vi.mock('@/shared/navigation/useAccess', () => ({ useAccessContext: () => ({ modules: ['hrms'] }) }))
const api = vi.hoisted(() => ({ calls: [] as { path: string; init?: RequestInit }[] }))
vi.mock('@/core/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/core/api/client')>()
  return { ...real, apiJson: async (path: string, init?: RequestInit) => { api.calls.push({ path, init }); return {} } }
})

import { CurrentCompanyProvider } from '../company/CurrentCompany'
import { accessibleCompaniesQuery } from '../company/companySource'
import { PayrollContainer } from './PayrollContainer'
import { PaySettings, settingsHeading, type ApiPayrollSettings } from '@/design/dc/PaySettings'
import { payrollSettingsKey, payrollSettingsUrl } from '../api/usePayroll'
import { SYNC } from '../master/masterSync'

const A = { id: 'co-a', name: 'Acme Labs' }
const B = { id: 'co-b', name: 'Beta Works' }

const settings = (processingDay: number, pfEnabled: boolean): ApiPayrollSettings => ({
  pfEnabled, pfEmployeePercent: 12, pfEmployerPercent: 12, pfWageCeiling: 15000, pfApplyCeiling: true,
  esiEnabled: false, esiEmployeePercent: 0.75, esiEmployerPercent: 3.25, esiWageCeiling: 21000,
  ptEnabled: false, lwfEnabled: false, lwfEmployeeAmount: 0, lwfEmployerAmount: 0,
  sandwichRuleEnabled: false, payrollCycleStartDay: 1, payrollCycleEndDay: 31, salaryProcessingDay: processingDay,
})

beforeEach(() => {
  api.calls = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

/** The settings page with two companies loaded (home company B), each with its own settings in the cache. */
function renderPage(url: string, companies = [A, B]) {
  const qc = new QueryClient()
  qc.setQueryData(accessibleCompaniesQuery(true, qc).queryKey, { companies, homeId: companies.some((c) => c.id === B.id) ? B.id : null })
  qc.setQueryData(['hrms', 'companies'], companies.map((c) => ({ ...c, active: true })))
  qc.setQueryData(payrollSettingsKey(A.id), settings(28, false))
  qc.setQueryData(payrollSettingsKey(B.id), settings(5, true))
  const html = renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <CurrentCompanyProvider>
          <Routes><Route path="/hrms/payroll/settings" element={<PayrollContainer />} /></Routes>
        </CurrentCompanyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { html, qc }
}

describe('the settings API names the company', () => {
  it('GET and PUT carry companyId; without one the server uses the chosen company', () => {
    expect(payrollSettingsUrl('co-b')).toBe('/v1/payroll/settings?companyId=co-b')
    expect(payrollSettingsUrl('')).toBe('/v1/payroll/settings')
    expect(payrollSettingsUrl(null)).toBe('/v1/payroll/settings')
  })

  it('each company has its own cache entry, and a save refreshes them all', async () => {
    expect(payrollSettingsKey('co-a')).not.toEqual(payrollSettingsKey('co-b'))
    const qc = new QueryClient()
    qc.setQueryData(payrollSettingsKey('co-a'), settings(28, false))
    qc.setQueryData(payrollSettingsKey('co-b'), settings(5, true))
    await qc.invalidateQueries({ queryKey: ['hrms', 'payroll', 'settings'] })
    expect(qc.getQueryState(payrollSettingsKey('co-a'))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(payrollSettingsKey('co-b'))?.isInvalidated).toBe(true)
  })
})

describe('Payroll › Settings page', () => {
  it('heading names the company', () => {
    expect(settingsHeading('Beta Works').title).toBe('Payroll settings · Beta Works')
    expect(settingsHeading('').title).toBe('Payroll settings')
    const html = renderToStaticMarkup(createElement(PaySettings, { settings: settings(5, true), access: 'edit', companyName: 'Beta Works' }))
    expect(html).toContain('Payroll settings · Beta Works')
  })

  it('shows the chosen company’s settings (home company B: pays on the 5th, PF on)', () => {
    const { html } = renderPage('/hrms/payroll/settings')
    expect(html).toContain('Payroll settings · Beta Works')
    expect(html).toContain('processed on the 5th')
    expect(html).not.toContain('processed on the 28th')
  })

  it('another company (A, chosen with ?co=) shows its own settings', () => {
    const { html } = renderPage('/hrms/payroll/settings?co=co-a')
    expect(html).toContain('Payroll settings · Acme Labs')
    expect(html).toContain('processed on the 28th')
    expect(html).not.toContain('processed on the 5th')
  })

  it('one company: its settings under its name', () => {
    const { html } = renderPage('/hrms/payroll/settings', [A])
    expect(html).toContain('Payroll settings · Acme Labs')
    expect(html).toContain('processed on the 28th')
  })
})

describe('Master › Statutory switches', () => {
  it('save the settings of the company the page is on', async () => {
    const env = { defaultCo: 'co-b', settings: settings(5, false) } as unknown as Parameters<typeof SYNC.statutory>[1]
    const rec = { id: 'PF', on: true } as unknown as Parameters<typeof SYNC.statutory>[0]['added'][number]
    const keys = await SYNC.statutory({ added: [], changed: [[rec, rec]], removed: [] }, env)
    expect(api.calls.at(-1)?.path).toBe('/v1/payroll/settings?companyId=co-b')
    expect(api.calls.at(-1)?.init?.method).toBe('PUT')
    expect(JSON.parse(String(api.calls.at(-1)?.init?.body)).pfEnabled).toBe(true)
    expect(keys).toEqual([['hrms', 'payroll', 'settings']])
  })
})
