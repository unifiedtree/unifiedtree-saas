import { writeFileSync, mkdirSync } from 'node:fs'
const base = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const headers = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, 'X-Tenant-Subdomain': 'demo' }
const response = await fetch(`${base}/v1/canonical-auth/login`, {
  method: 'POST', headers, body: JSON.stringify({ tenantId: tenant, email: 'owner@unifiedtree.demo', password: process.env.RECOVERY_PASSWORD || 'Hrms@12345' }),
})
if (!response.ok) throw new Error(`Login failed: ${response.status} ${await response.text()}`)
const login = await response.json()
headers.Authorization = `Bearer ${login.accessToken}`
console.log('Authenticated roles:', login.roles)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const paths = [
  '/v1/public/module-plans',
  '/v1/canonical-auth/me', '/v1/hrms/companies', '/v1/users/me',
  `/v1/attendance/dashboard?date=${today}`, `/v1/attendance/dashboard/trend?to=${today}`,
  '/v1/attendance/corrections/approvals?status=PENDING&page=0&size=20',
  `/v1/shifts?companyId=${company}`, '/v1/shifts/change-requests/pending',
  `/v1/reports/headcount?companyId=${company}`,
  '/v1/performance/cycles', '/v1/performance/reviews?page=0&size=20', '/v1/performance/goals/my',
  '/v1/document/employee/11111111-1111-1111-1111-111111111111',
]
const results = []
for (const path of paths) {
  const result = await fetch(base + path, { headers })
  const body = await result.text()
  results.push({ path, status: result.status, body: body.slice(0, 12000) })
  console.log(result.status, path)
}
mkdirSync('test-results/recovery', { recursive: true })
writeFileSync('test-results/recovery/live-api.json', JSON.stringify(results, null, 2))
if (results.some(r => r.status >= 400)) process.exitCode = 1
