import type { FullConfig } from '@playwright/test'
import { USERS, TENANT_ID } from './users'
import * as path from 'path'
import * as fs from 'fs'

// ─────────────────────────────────────────────────────────────────────────────
// DEVIATION FROM THE P1 SPEC — auth storage
//
// The spec assumed the access token lives in localStorage and that Playwright's
// storageState could carry it. It does NOT: the SDK keeps the access token in
// module memory (packages/sdk/src/auth/tokenStorage.ts):
//
//     // Access token lives in module-level memory only — never in localStorage…
//     let _accessToken: string | null = null;
//
// …with a sessionStorage fallback under key `__ut_access_token__` ONLY when the
// dev server runs with VITE_DEV_TOKEN_STORAGE=session. Playwright storageState
// persists cookies + localStorage but NOT sessionStorage, so it cannot carry
// this token.
//
// Therefore: this globalSetup API-logs-in each role and writes just the token to
// e2e/.auth/<role>.json. The test-base fixture injects that token into
// sessionStorage on every page (via context.addInitScript), and the dev server
// must run with VITE_DEV_TOKEN_STORAGE=session.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:8080'
const AUTH_DIR = path.join(process.cwd(), 'e2e', '.auth')

async function loginViaApi(email: string, password: string): Promise<{ accessToken: string }> {
  const response = await fetch(`${BACKEND}/api/v1/canonical-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: TENANT_ID, email, password }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Login failed for ${email}: HTTP ${response.status} — ${body}`)
  }

  const data = await response.json()
  const accessToken = data.accessToken ?? data.token
  if (!accessToken) {
    throw new Error(`Login response missing token for ${email}: ${JSON.stringify(data)}`)
  }
  return { accessToken }
}

export default async function globalSetup(_config: FullConfig) {
  console.log('🔐 Setting up authenticated sessions for 5 roles…')
  fs.mkdirSync(AUTH_DIR, { recursive: true })

  for (const [, user] of Object.entries(USERS)) {
    try {
      const { accessToken } = await loginViaApi(user.email, user.password)
      const file = path.join(AUTH_DIR, user.storageFile)
      fs.writeFileSync(
        file,
        JSON.stringify({ accessToken, role: user.role, email: user.email }, null, 2),
      )
      console.log(`✓ Saved auth token for ${user.email} → ${file}`)
    } catch (e) {
      console.error(`❌ Auth setup failed for ${user.email}:`, e)
      throw e
    }
  }

  console.log('✅ All 5 roles authenticated')
}
