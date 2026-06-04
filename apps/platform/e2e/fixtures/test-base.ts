import { test as base, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { USERS, PROJECT_TO_USER, SDK_SESSION_TOKEN_KEY, TENANT_SUBDOMAIN, type UserKey } from '../auth/users'

const AUTH_DIR = path.join(process.cwd(), 'e2e', '.auth')
const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:8080'

function tokenFor(userKey: UserKey): string {
  const file = path.join(AUTH_DIR, USERS[userKey].storageFile)
  if (!fs.existsSync(file)) {
    throw new Error(`Missing auth token file ${file} — did globalSetup run?`)
  }
  const { accessToken } = JSON.parse(fs.readFileSync(file, 'utf-8'))
  return accessToken
}

/**
 * Inject a role's access token into sessionStorage before any page script runs.
 * Works with the SDK's sessionStorage fallback (VITE_DEV_TOKEN_STORAGE=session),
 * which storageState can't provide. Runs on every navigation in the context.
 */
async function injectAuth(context: import('@playwright/test').BrowserContext, userKey: UserKey) {
  const token = tokenFor(userKey)
  await context.addInitScript(
    ({ key, value }) => {
      try {
        window.sessionStorage.setItem(key, value)
      } catch {
        /* sessionStorage unavailable — ignore */
      }
    },
    { key: SDK_SESSION_TOKEN_KEY, value: token },
  )
}

type Fixtures = {
  /** Open a fresh page authenticated as the given role. */
  loginAs: (userKey: UserKey) => Promise<Page>
  /** Make a backend API request authenticated as the current project's role. */
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>
}

export const test = base.extend<Fixtures>({
  // Auto-authenticate the default page based on the project name. The
  // 'unauthenticated' project (and any project not in PROJECT_TO_USER) gets nothing.
  context: async ({ context }, use, testInfo) => {
    const userKey = PROJECT_TO_USER[testInfo.project.name]
    if (userKey) await injectAuth(context, userKey)
    await use(context)
  },

  loginAs: async ({ browser }, use) => {
    const created: import('@playwright/test').BrowserContext[] = []
    await use(async (userKey) => {
      const ctx = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://demo.localhost:3001' })
      created.push(ctx)
      await injectAuth(ctx, userKey)
      const page = await ctx.newPage()
      await page.goto('/')
      return page
    })
    for (const ctx of created) await ctx.close()
  },

  apiRequest: async ({}, use, testInfo) => {
    const userKey = PROJECT_TO_USER[testInfo.project.name] ?? 'superAdmin'
    await use(async (apiPath, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${tokenFor(userKey)}`)
      headers.set('X-Tenant-Subdomain', TENANT_SUBDOMAIN)
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      return fetch(`${BACKEND}${apiPath}`, { ...init, headers })
    })
  },
})

export { expect }
