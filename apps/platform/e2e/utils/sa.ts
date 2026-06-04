import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Shared helpers for the Super Admin (P2) E2E suite.
 *
 * These encode realities discovered by reading the app source (not the P2 spec's
 * guesses), so the tests stay robust:
 *  - Most HRMS create-forms render a plain <label> NOT associated with its input
 *    (no htmlFor/id) → getByLabel does not work there; use placeholders.
 *  - ui-kit <Field> DOES associate label↔input (useId + htmlFor) → getByLabel works
 *    for PayrollRuns / PayrollSettings / Organization.
 *  - <select> elements are role="combobox"; a select's accessible text contains all
 *    its option labels, so we can locate "the company select" by filtering on a
 *    known company name.
 */

export const DEMO_COMPANY = 'Kishore' // first seeded company in the demo tenant

/** Locate the single <select> that lists companies (it contains the company name). */
export function companySelect(scope: Page | Locator, companyName = DEMO_COMPANY): Locator {
  return scope.getByRole('combobox').filter({ hasText: companyName }).first()
}

/**
 * Select a company by its visible label. Firing selectOption guarantees the React
 * onChange runs even if the option already appears visually selected — this avoids
 * the "companyId='' until the user interacts" trap in several forms whose state is
 * seeded from a query that may resolve after first render.
 */
export async function pickCompany(scope: Page | Locator, companyName = DEMO_COMPANY): Promise<void> {
  await companySelect(scope, companyName).selectOption({ label: companyName })
}

/** GET helper over the authenticated apiRequest fixture; asserts 200 and returns JSON. */
export async function apiGet<T = unknown>(
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>,
  path: string,
): Promise<T> {
  const res = await apiRequest(path)
  expect(res.status, `GET ${path} should be 200`).toBe(200)
  return (await res.json()) as T
}

/** First company id in the demo tenant (for report queries etc.). */
export async function firstCompanyId(
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  const companies = await apiGet<Array<{ id: string; name: string }>>(apiRequest, '/api/v1/hrms/companies')
  expect(companies.length, 'demo tenant must have at least one company').toBeGreaterThan(0)
  return companies[0].id
}

/** First employee id in the demo tenant (for letter preview etc.). */
export async function firstEmployeeId(
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  const page = await apiGet<{ content: Array<{ id: string }> }>(apiRequest, '/api/v1/hrms/employees?pageSize=1')
  expect(page.content.length, 'demo tenant must have at least one employee').toBeGreaterThan(0)
  return page.content[0].id
}

/** First letter-template id in the demo tenant (for letter generation). */
export async function firstLetterTemplateId(
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  const page = await apiGet<{ content: Array<{ id: string }> }>(apiRequest, '/api/v1/letters/templates')
  expect(page.content.length, 'demo tenant must have at least one letter template').toBeGreaterThan(0)
  return page.content[0].id
}

/** A unique suffix for created entities so tests are re-runnable. */
export function uniq(prefix: string): string {
  // Note: Date.now() is fine in Playwright test files (Node runtime), unlike workflow scripts.
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}
