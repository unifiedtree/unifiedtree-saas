// Live check of w43 (testers' Workforce feedback, 6 Oct 2026), against a running backend (with V143_102) and web app:
//   1. Photos and logos (V143.102): an employee changes their own photo, not someone else's; HR changes anyone's;
//      a branch logo and an agency logo upload; only JPG / PNG up to 2 MB is taken; the picture is served without
//      sign-in at /v1/public/images/{tenant}/{token}; the photo lands on the employee record and their login.
//      The web shows them: the directory row, the employee profile (with the photo button), the Branches row, the
//      agency card, and the person's own profile.
//   2. Directory: a Designation filter (with department, branch, type, status); the Type filter lists the
//      workspace's own employment types (not the old fixed three).
//   3. Add employee: picking Contract shows the staffing agency picker, required; saved, the person is linked to the
//      agency and listed under its workers (Contractor Master → the card's workers count).
// What it creates, and removes at the end: a staffing agency (ended at the end — agencies can't be deleted), its
// logo, a branch logo, two photos, and one contract employee (marked exited at the end — people can't be deleted).
// On the slot's throw-away database (ut_w3_dev) the agency and the employee are deleted outright.
//
//   node e2e/recovery/live-w3-w43-workforce.mjs
//   env: RECOVERY_APP_URL, RECOVERY_API_URL (default http://127.0.0.1:8080/api), RECOVERY_DB (default ut_w3_dev), RECOVERY_PASSWORD
/* global process, console, fetch, Blob, FormData */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const base = process.env.RECOVERY_APP_URL || 'http://demo.localhost:3002'
const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8080/api'
const db = process.env.RECOVERY_DB || 'ut_w3_dev'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const company = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const SHOTS = 'C:/REACT/ut-wt/_results/shots'
mkdirSync(SHOTS, { recursive: true })
const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().replace(/\r/g, '').trim()
const throwaway = db === 'ut_w3_dev'

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`) }

// ── a small PNG made here (no image library): w × h, one colour, the left half another ──
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c } return (crc ^ 0xffffffff) >>> 0 }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }
function png(w, h, [r, g, b], [r2, g2, b2]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const left = x < w / 2; raw[o] = left ? r : r2; raw[o + 1] = left ? g : g2; raw[o + 2] = left ? b : b2 } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PHOTO = png(320, 240, [15, 110, 86], [240, 200, 120])
const LOGO = png(400, 160, [30, 64, 175], [255, 255, 255])

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json()
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body !== undefined ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  call.upload = async (path, bytes, type = 'image/png') => {
    const form = new FormData(); form.append('file', new Blob([bytes], { type }), 'x.png')
    const res = await fetch(api + path, { method: 'POST', headers: { 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: form })
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return call
}

const browser = await chromium.launch({ headless: true })
async function signIn(email, { width = 1440, height = 1000, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((t) => { try { localStorage.setItem('ut.theme', t) } catch { /* none */ } }, theme)
  const page = await ctx.newPage()
  const errors = [], failedApi = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  page.setDefaultNavigationTimeout(90_000)
  await page.goto(base + '/login', { timeout: 180_000 })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(2500)
  errors.length = 0; failedApi.length = 0
  return { ctx, page, errors, failedApi }
}
const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}); await page.waitForTimeout(900) }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/w43-live-${name}.png` })

let owner, reader, agencyId = null, newEmpId = null, branchId = null
const readerId = sql(`select employee_id from auth.user_credentials where lower(email)='reader@unifiedtree.demo'`)
const otherId = sql(`select id from hrms.employees where id <> '${readerId}' and is_active order by employee_code limit 1`)
const stamp = Date.now().toString().slice(-6)

try {
  owner = await login('owner@unifiedtree.demo')
  reader = await login('reader@unifiedtree.demo')
  branchId = sql(`select id from org.branches where company_id='${company}' and is_active order by name limit 1`)
  check('fixtures: reader, another person and a branch', !!readerId && !!otherId && !!branchId)

  // ── 1. photos and logos over the API ──
  const own = await reader.upload(`/v1/hrms/employees/${readerId}/photo`, PHOTO)
  check('an employee uploads their own photo', own.status === 200 && /^\/v1\/public\/images\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(own.json?.url || ''), `${own.status} ${JSON.stringify(own.json)}`)
  const theirs = await reader.upload(`/v1/hrms/employees/${otherId}/photo`, PHOTO)
  check('…but not someone else’s (403)', theirs.status === 403, String(theirs.status))
  const hr = await owner.upload(`/v1/hrms/employees/${otherId}/photo`, PHOTO)
  check('HR (employee write) uploads anyone’s photo', hr.status === 200, String(hr.status))
  const bad = await owner.upload(`/v1/hrms/employees/${otherId}/photo`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/svg+xml')
  check('a non-image (SVG with script) is refused with a plain reason', bad.status === 422 && /Only JPG and PNG/.test(bad.json?.message || ''), `${bad.status} ${JSON.stringify(bad.json)}`)
  const big = await owner.upload(`/v1/hrms/employees/${otherId}/photo`, Buffer.concat([PHOTO, Buffer.alloc(2 * 1024 * 1024)]))
  check('a file over 2 MB is refused', big.status === 422 && /2 MB/.test(big.json?.message || ''), `${big.status} ${JSON.stringify(big.json)}`)
  if (!own.json?.url) throw new Error('the photo upload gave no address; the rest depends on it')
  const pub = await fetch(api + own.json.url)
  const pubType = pub.headers.get('content-type') || ''
  const pubBytes = Buffer.from(await pub.arrayBuffer())
  check('the photo is served without sign-in as a JPG (re-encoded, cropped square)', pub.status === 200 && pubType.startsWith('image/jpeg') && pubBytes[0] === 0xff, `${pub.status} ${pubType}`)
  const wrongTenant = await fetch(api + own.json.url.replace(tenant, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
  check('…and only under its own workspace', wrongTenant.status === 404, String(wrongTenant.status))
  check('the photo is on the employee record', sql(`select profile_photo_url from hrms.employees where id='${readerId}'`) === own.json.url)
  const me = await reader('/v1/users/me')
  check('…and on their login (/v1/users/me avatarUrl)', me.json?.avatarUrl === own.json.url, JSON.stringify(me.json?.avatarUrl))

  const bl = await owner.upload(`/v1/hrms/branches/${branchId}/logo`, LOGO)
  check('a branch logo uploads (org.company.write)', bl.status === 200, `${bl.status} ${JSON.stringify(bl.json)}`)
  const blPub = await fetch(api + bl.json.url)
  check('…kept as a PNG', blPub.status === 200 && (blPub.headers.get('content-type') || '').startsWith('image/png'))
  const readerBranch = await reader.upload(`/v1/hrms/branches/${branchId}/logo`, LOGO)
  check('an employee can’t change a branch logo (403)', readerBranch.status === 403, String(readerBranch.status))
  const ag = await owner('/v1/hrms/contractors', 'POST', { companyId: company, agencyName: `W43 Staffing ${stamp}`, serviceType: 'Security', contactPersonName: 'R. Iyer', siteBranchIds: [branchId] })
  agencyId = ag.json?.id
  check('fixture: a staffing agency', ag.status === 200 || ag.status === 201, `${ag.status} ${JSON.stringify(ag.json)}`)
  const al = await owner.upload(`/v1/hrms/contractors/${agencyId}/logo`, LOGO)
  check('an agency logo uploads (hrms.contractor.write)', al.status === 200, String(al.status))
  const list = await reader('/v1/hrms/record-images?kind=branch')
  check('anyone signed in reads the logo list', list.status === 200 && list.json?.available === true && list.json?.urls?.[branchId] === bl.json.url, JSON.stringify(list.json))

  // ── 2 + 3. the web ──
  const desig = sql(`select d.id || '|' || d.title from hrms.designations d where d.company_id='${company}' and d.is_active and exists (select 1 from hrms.employees e where e.designation_id=d.id) order by d.title limit 1`).split('|')
  for (const v of [{ width: 1440, tag: '1440' }, { width: 390, tag: '390' }]) {
    const o = await signIn('owner@unifiedtree.demo', { width: v.width, height: v.width < 600 ? 844 : 1000 })
    await o.page.goto(base + '/hrms/employees')
    await settle(o.page)
    const filter = o.page.getByRole('button', { name: /All designations/ }).first()
    check(`${v.tag}: directory has a Designation filter`, await filter.count() > 0)
    if (v.tag === '1440') {
      await filter.click()
      await o.page.getByRole('option', { name: new RegExp(desig[1]) }).first().click()
      await settle(o.page)
      const want = Number(sql(`select count(*) from hrms.employees where designation_id='${desig[0]}'`))
      const count = await o.page.locator('.wf-count').innerText()
      check(`1440: Designation "${desig[1]}" narrows the list (${want})`, count.startsWith(`${want} of`), count)
      await shot(o.page, `directory-designation-${v.tag}`)
      await o.page.getByRole('button', { name: 'Clear' }).first().click()
      const types = o.page.getByRole('button', { name: /All types/ }).first()
      await types.click()
      const opts = await o.page.getByRole('option').allInnerTexts()
      check('1440: Type filter lists the workspace’s own types (Consultant from the data; no fixed Part-time)', opts.some((t) => t.includes('Consultant')) && !opts.some((t) => t.includes('Part-time')), opts.join(', '))
      await o.page.keyboard.press('Escape')
      const img = o.page.locator('table img[src*="/api/v1/public/images/"]')
      check('1440: a person’s photo shows on their directory row', await img.count() > 0)
    }

    // Add employee → Contract → staffing agency (required), then save
    await o.page.goto(base + '/hrms/employees?add=1')
    await settle(o.page)
    const form = o.page.getByRole('dialog', { name: 'Add employee' })
    await form.waitFor({ timeout: 20_000 })
    const typeOpts = await form.locator('[data-field="type"] [role="radio"]').allInnerTexts()
    check(`${v.tag}: Add employee's types are the company's own (${typeOpts.join(', ')})`, typeOpts.includes('Consultant') && typeOpts.includes('Contract') && !typeOpts.includes('Part-time'))
    await form.locator('[data-field="type"] [role="radio"]', { hasText: 'Contract' }).click()
    const agencyField = form.locator('[data-field="agency"]')
    check(`${v.tag}: Contract shows the staffing agency picker, required`, await agencyField.count() === 1 && (await agencyField.locator('.uko-req').count()) === 1)
    await agencyField.scrollIntoViewIfNeeded()
    await shot(o.page, `add-contract-agency-${v.tag}`)
    if (v.tag === '1440') {
      await form.getByLabel('First name').fill('W43')
      await form.getByLabel('Last name').fill(`Contract ${stamp}`)
      await form.getByLabel('Work email').fill(`w43.contract.${stamp}@unifiedtree.demo`)
      const pick = async (field, re) => { await form.locator(`[data-field="${field}"] button.uko-dd-trigger`).first().click(); await o.page.getByRole('option', { name: re }).first().click() }
      await pick('branch', /./)
      await pick('dept', /./)
      await pick('desig', /./)
      await form.getByRole('button', { name: 'Add employee' }).click()
      await o.page.waitForTimeout(800)
      check('1440: saving without the agency asks for it', (await agencyField.locator('[role="alert"]').innerText().catch(() => '')).includes('Required'))
      await agencyField.locator('button.uko-dd-trigger').first().click()
      await o.page.getByRole('option', { name: new RegExp(`W43 Staffing ${stamp}`) }).first().click()
      await form.getByRole('button', { name: 'Add employee' }).click()
      await form.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {})
      await o.page.waitForTimeout(3000)
      newEmpId = sql(`select id from hrms.employees where lower(email)='w43.contract.${stamp}@unifiedtree.demo'`)
      check('1440: the contract worker is saved as Contract', !!newEmpId && sql(`select employment_type from hrms.employees where id='${newEmpId}'`) === 'CONTRACT')
      const workers = newEmpId ? await owner(`/v1/hrms/contractors/${agencyId}/workers`) : { json: [] }
      check('1440: …and listed under the agency’s workers', (workers.json || []).some((w) => w.employeeId === newEmpId), JSON.stringify(workers.json))
    }

    // Contractor Master: the agency card's logo and its workers
    await o.page.goto(base + '/hrms/master/contractors')
    await settle(o.page)
    check(`${v.tag}: the agency card shows its logo`, await o.page.locator('.tile.lg.logo img[src*="/api/v1/public/images/"]').count() > 0)
    const crew = o.page.getByRole('button', { name: `Workers of W43 Staffing ${stamp}` })
    await crew.scrollIntoViewIfNeeded()
    await shot(o.page, `contractors-${v.tag}`)
    await crew.click()
    const drawer = o.page.getByRole('dialog', { name: new RegExp(`W43 Staffing ${stamp} · workers`) })
    await drawer.waitFor({ timeout: 15_000 })
    await o.page.waitForTimeout(1200)
    if (v.tag === '1440') check('1440: the workers list shows the new contract worker', (await drawer.innerText()).includes(`W43 Contract ${stamp}`), await drawer.innerText())
    await shot(o.page, `agency-workers-${v.tag}`)
    await drawer.getByRole('button', { name: 'Close' }).first().click()

    // Branches: the row's logo; Edit branch → Logo section
    await o.page.goto(base + '/hrms/master/branches')
    await settle(o.page)
    check(`${v.tag}: the branch row shows its logo`, await o.page.locator('td .tile.logo img[src*="/api/v1/public/images/"]').count() > 0)
    await shot(o.page, `branches-${v.tag}`)
    await o.page.locator('tbody tr').first().click()
    const bform = o.page.getByRole('dialog', { name: /^Edit / })
    await bform.waitFor({ timeout: 15_000 })
    check(`${v.tag}: Edit branch has the logo picker`, await bform.locator('[data-image-picker="branch"]').count() === 1)
    await bform.locator('[data-image-picker="branch"]').scrollIntoViewIfNeeded()
    await shot(o.page, `branch-form-${v.tag}`)
    await bform.getByRole('button', { name: 'Close' }).first().click()

    // Employee profile: photo + the photo button (HR)
    await o.page.goto(base + `/hrms/employees/${readerId}`)
    await settle(o.page)
    check(`${v.tag}: the employee profile shows their photo`, await o.page.locator('.upf-av img[src*="/api/v1/public/images/"]').count() > 0)
    const pbtn = o.page.locator('[data-photo-edit]')
    check(`${v.tag}: HR sees the photo button`, await pbtn.count() === 1)
    await pbtn.click()
    const pd = o.page.getByRole('dialog', { name: 'Profile photo' })
    await pd.waitFor({ timeout: 10_000 })
    check(`${v.tag}: the photo dialog offers Change and Remove`, (await pd.innerText()).includes('Change photo') && (await pd.innerText()).includes('Remove'))
    await shot(o.page, `profile-photo-dialog-${v.tag}`)
    await pd.getByRole('button', { name: 'Done' }).click()
    check(`${v.tag}: no page errors`, o.errors.length === 0, o.errors.join(' | '))
    check(`${v.tag}: no failed API calls`, o.failedApi.length === 0, o.failedApi.join(' | '))
    await o.ctx.close()
  }

  // The person's own profile, dark
  const r = await signIn('reader@unifiedtree.demo', { theme: 'dark' })
  await r.page.goto(base + '/profile')
  await settle(r.page)
  check('reader: their own profile shows their photo', await r.page.locator('.upf-av img[src*="/api/v1/public/images/"]').count() > 0)
  await shot(r.page, 'myprofile-dark-1440')
  await r.page.goto(base + `/hrms/employees/${otherId}`)
  await settle(r.page)
  check('reader: no photo button on someone else’s profile', await r.page.locator('[data-photo-edit]').count() === 0)
  check('reader: no page errors', r.errors.length === 0, r.errors.join(' | '))
  await r.ctx.close()
} catch (e) {
  check('run finished without an exception', false, String(e).split('\n')[0])
} finally {
  // ── clean up ──
  try {
    if (reader && readerId) check('cleanup: own photo removed', (await reader(`/v1/hrms/employees/${readerId}/photo`, 'DELETE')).status === 204)
    if (owner && otherId) await owner(`/v1/hrms/employees/${otherId}/photo`, 'DELETE')
    if (owner && branchId) check('cleanup: branch logo removed', (await owner(`/v1/hrms/branches/${branchId}/logo`, 'DELETE')).status === 204)
    if (owner && agencyId) await owner(`/v1/hrms/contractors/${agencyId}/logo`, 'DELETE')
    check('cleanup: nothing left in hrms.record_images', sql(`select count(*) from hrms.record_images where record_id in ('${readerId}','${otherId}','${branchId}'${agencyId ? `,'${agencyId}'` : ''})`) === '0')
    check('cleanup: the photo is off the record and the login', sql(`select coalesce(profile_photo_url,'') from hrms.employees where id='${readerId}'`) === '' && sql(`select coalesce(avatar_url,'') from auth.user_credentials where employee_id='${readerId}'`) === '')
    if (newEmpId && agencyId) await owner(`/v1/hrms/contractors/${agencyId}/workers/${newEmpId}`, 'DELETE')
    // The throw-away slot database: delete outright; anywhere else (or if rows still point at them): exit / end.
    let gone = false
    if (throwaway) {
      try {
        if (newEmpId) sql(`delete from auth.user_credentials where employee_id='${newEmpId}'; delete from hrms.employees where id='${newEmpId}'`)
        if (agencyId) sql(`delete from hrms.contractors where id='${agencyId}'`)
        gone = true
      } catch { gone = false }
    }
    if (!gone) {
      if (newEmpId) await owner(`/v1/hrms/employees/${newEmpId}/exit?lastWorkingDay=${new Date().toISOString().slice(0, 10)}`, 'POST')
      if (agencyId) await owner(`/v1/hrms/contractors/${agencyId}`, 'DELETE')
    }
    console.log(gone ? 'cleanup: test agency and employee deleted' : 'cleanup: test employee exited and agency ended (they stay as history)')
  } catch (e) {
    check('cleanup finished', false, String(e).split('\n')[0])
  }
  await browser.close()
}
const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
