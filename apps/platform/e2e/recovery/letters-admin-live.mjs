import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'

const api = 'http://127.0.0.1:8080/api', base = 'http://demo.localhost:3002'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const name = `Browser letter template ${Date.now()}`
const login = await fetch(api + '/v1/canonical-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password: 'Hrms@12345' }) })
assert.equal(login.status, 200)
const token = (await login.json()).accessToken
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` }
const created = await fetch(api + '/v1/letters/templates', { method: 'POST', headers, body: JSON.stringify({ companyId: company, name, type: 'CUSTOM', subject: `Browser employment confirmation ${name}`, bodyHtml: '<html><body><h1>Employment confirmation</h1><p>{{employee.fullName}} ({{employee.code}}) works with {{company.name}}.</p></body></html>' }) })
assert.equal(created.status, 201)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], failures = [], probes = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) { const entry = `${response.status()} ${response.url()}`; if (response.url().includes('/canonical-auth/refresh') && response.status() === 422) probes.push(entry); else failures.push(entry) } })
mkdirSync('test-results/recovery', { recursive: true })
try {
  await page.goto(base + '/login')
  await page.locator('input[type=email]').fill('owner@unifiedtree.demo')
  await page.locator('input[type=password]').fill('Hrms@12345')
  await page.locator('button[type=submit]').click()
  await page.waitForURL(url => !url.pathname.includes('login'))
  await page.goto(base + '/hrms/letters/generated')
  await page.getByRole('button', { name: 'Generate Letter', exact: true }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button').filter({ hasText: name }).click()
  await drawer.getByLabel('Find employee').fill('reader@unifiedtree.demo')
  await drawer.getByRole('button').filter({ hasText: 'Reader User' }).click()
  await drawer.getByRole('button', { name: 'Generate PDF', exact: true }).click()
  await page.waitForURL(/\/letters\/generated\/[0-9a-f-]+$/)
  await expect(page.getByText('Reader User', { exact: false }).first()).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').at(-1)
  const generated = await fetch(api + `/v1/letters/generated/${id}`, { headers })
  assert.equal(generated.status, 200)
  assert.equal((await generated.json()).status, 'GENERATED')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const download = await downloaded
  await download.saveAs('test-results/recovery/letter-generated-live.pdf')
  assert.equal(readFileSync('test-results/recovery/letter-generated-live.pdf').subarray(0, 5).toString(), '%PDF-')
  await page.screenshot({ path: 'test-results/recovery/letter-detail-live.png', fullPage: true })
  await page.getByRole('button', { name: 'Generated Letters', exact: true }).click()
  const row = page.getByRole('row').filter({ has: page.locator(`[title="Browser employment confirmation ${name}"]`) })
  await expect(row.getByText('Reader User', { exact: true })).toBeVisible()
  console.log('PASS: template selection, server employee search, generate without send, named employee list/detail, real PDF browser download')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Generate Letter', exact: true }).click()
  await expect.poll(() => page.getByRole('heading', { name: 'Generate letter', exact: true }).evaluate(element => element.getBoundingClientRect().left)).toBeLessThan(40)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/recovery/letter-generate-mobile-live.png', fullPage: true })
  expect(errors).toEqual([])
  expect(failures).toEqual([])
  console.log(`PASS: mobile generation drawer, zero feature API/browser errors; ${probes.length} expected signed-out refresh probes`)
} catch (error) { console.error((await page.locator('body').innerText()).slice(-4000), failures); await page.screenshot({ path: 'test-results/recovery/letters-failure.png', fullPage: true }); throw error } finally { await browser.close() }
