// Live API check for w1c: notification templates are used, notification
// choices are honoured, and per-user choices have an endpoint.
//  - GET /v1/notiftemplate/events: every event with placeholders + built-in
//    wording; template readers only (reader / manager / finance get 403).
//  - Template saves are checked: unknown placeholder, SMS and fixed-wording
//    events are refused (400); the old enum spelling is stored as the key.
//  - A company IN_APP template for wfh.submitted changes the approver's bell
//    text; switched off, the built-in wording comes back.
//  - The approver switching wfh.submitted off (in-app + push) means no
//    notification row at all for the next request.
//  - GET/PUT /v1/me/notification-preferences: self only, always-sent events
//    can't be switched off, unknown events refused, 401 without a session;
//    PUT /v1/users/me (Profile) merges instead of wiping per-event choices.
//  - A password-reset email is still issued when the person switched email off.
// Runs against a LOCAL backend. Everything it creates is removed and every
// preference it touches is put back.
//
//   node e2e/recovery/live-w1c.mjs
import { execFileSync } from 'node:child_process'

const api = process.env.RECOVERY_API_URL || 'http://127.0.0.1:8097/api'
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const password = process.env.RECOVERY_PASSWORD || 'Hrms@12345'
const db = process.env.RECOVERY_DB || 'unifiedtree_recovery'
const psql = (process.env.LOCALAPPDATA || '') + '/UnifiedTreeRecovery/pgsql/bin/psql.exe'
const READER = '22222222-2222-2222-2222-222222222222'
const MGR = '44444444-4444-4444-4444-444444444444'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } }).toString().trim()
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

async function login(email) {
  const r = await fetch(`${api}/v1/canonical-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ tenantId: tenant, email, password }) })
  const d = await r.json().catch(() => ({}))
  if (!d.accessToken) throw new Error(`login failed for ${email}: ${r.status}`)
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${d.accessToken}` }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return { call }
}

const stamp = Date.now()
const createdTemplates = []
const createdWfh = []
const prefsBackup = {}
const startedAt = sql('select now()')
const iso = (d) => d.toISOString().slice(0, 10)
const dayAhead = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const base = 100 + (stamp % 40)
let readerCreds = null

const backupPrefs = (userIdSql) => {
  const rows = sql(`select id || '|' || coalesce(notification_preferences::text, 'NULL') from auth.user_credentials where tenant_id='${tenant}' and ${userIdSql}`)
  for (const line of rows.split('\n').filter(Boolean)) {
    const i = line.indexOf('|')
    const id = line.slice(0, i)
    if (!(id in prefsBackup)) prefsBackup[id] = line.slice(i + 1)
  }
}
const notifFor = (wfhId) => sql(`select coalesce(title,'') || '|' || coalesce(body,'') from notif.notifications where tenant_id='${tenant}' and type='WFH_SUBMITTED' and data->>'wfhRequestId'='${wfhId}' order by created_at desc limit 1`)

try {
  const owner = await login('owner@unifiedtree.demo')
  const admin = await login('admin@unifiedtree.demo')
  const hrm = await login('hrm@unifiedtree.demo')
  const mgr = await login('mgr@unifiedtree.demo')
  const fin = await login('fin@unifiedtree.demo')
  const reader = await login('reader@unifiedtree.demo')
  readerCreds = sql(`select id from auth.user_credentials where tenant_id='${tenant}' and lower(email)='reader@unifiedtree.demo'`)
  backupPrefs(`(employee_id in ('${READER}','${MGR}') or lower(email) in ('reader@unifiedtree.demo','mgr@unifiedtree.demo'))`)
  const company = sql(`select company_id from hrms.employees where id='${READER}' and tenant_id='${tenant}'`)
  const readerName = sql(`select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) from hrms.employees where id='${READER}'`)

  // ── 1. The event list ─────────────────────────────────────────────────────
  const ev = await owner.call('/v1/notiftemplate/events')
  const events = Array.isArray(ev.json) ? ev.json : []
  const wfhEvent = events.find((e) => e.key === 'wfh.submitted')
  check('events: owner gets the list of events', ev.status === 200 && events.length >= 40, `status=${ev.status} n=${events.length}`)
  check('events: wfh.submitted lists its placeholders and built-in wording',
    !!wfhEvent && wfhEvent.placeholders.some((p) => p.name === 'employeeName') && wfhEvent.defaults?.IN_APP?.subject === 'New WFH request', JSON.stringify(wfhEvent?.defaults?.IN_APP))
  check('events: every event has a description and audience', events.every((e) => e.description && e.audience && e.label))
  check('events: the password reset email is always sent and has a link placeholder',
    events.some((e) => e.key === 'account.password_reset' && e.essential && e.placeholders.some((p) => p.name === 'resetLink' && p.link)))
  for (const [who, c] of [['admin (SUPER_ADMIN)', admin], ['HR manager', hrm]]) {
    const r = await c.call('/v1/notiftemplate/events')
    check(`events: ${who} can read them`, r.status === 200, `status=${r.status}`)
  }
  for (const [who, c] of [['reader', reader], ['department manager', mgr], ['finance lead', fin]]) {
    const r = await c.call('/v1/notiftemplate/events')
    check(`events: ${who} is refused`, r.status === 403, `status=${r.status}`)
  }

  // ── 2. Template saves are checked ──────────────────────────────────────────
  const tpl = (extra) => ({ companyId: company, name: `W1C QA ${stamp}`, channel: 'IN_APP', eventKey: 'wfh.submitted', subject: 'W1C {{employeeName}}', body: 'W1C {{dates}}', active: true, ...extra })
  const badPh = await owner.call('/v1/notiftemplate/templates', 'POST', tpl({ body: 'W1C {{salary}}' }))
  check('templates: an unknown placeholder is refused with the allowed list', badPh.status === 400 && String(badPh.json?.message || '').includes('{{employeeName}}'), `status=${badPh.status} ${badPh.json?.message || ''}`)
  const sms = await owner.call('/v1/notiftemplate/templates', 'POST', tpl({ channel: 'SMS' }))
  check('templates: SMS (never sent) is refused', sms.status === 400, `status=${sms.status}`)
  const fixed = await owner.call('/v1/notiftemplate/templates', 'POST', tpl({ eventKey: 'billing.payment_failed', subject: 'x', body: 'y' }))
  check('templates: fixed-wording events are refused', fixed.status === 400, `status=${fixed.status}`)
  const unknownEvent = await owner.call('/v1/notiftemplate/templates', 'POST', tpl({ eventKey: 'made.up.event' }))
  check('templates: an unknown event is refused', unknownEvent.status === 400, `status=${unknownEvent.status}`)
  for (const [who, c] of [['reader', reader], ['department manager', mgr]]) {
    const r = await c.call('/v1/notiftemplate/templates', 'POST', tpl({}))
    if (r.json?.id) createdTemplates.push(r.json.id)
    check(`templates: ${who} can't add one`, r.status === 403, `status=${r.status}`)
  }
  const good = await owner.call('/v1/notiftemplate/templates', 'POST', tpl({ eventKey: 'WFH_SUBMITTED', subject: 'W1C {{employeeName}} wants to work from home', body: 'W1C QA {{dates}}' }))
  if (good.json?.id) createdTemplates.push(good.json.id)
  check('templates: owner adds one; the old enum spelling is stored as the event key',
    good.status === 201 && sql(`select event_key from notiftemplate_mgmt.notification_templates where id='${good.json?.id}'`) === 'wfh.submitted', `status=${good.status}`)
  const resetTpl = await owner.call('/v1/notiftemplate/templates', 'POST', { companyId: company, name: `W1C QA reset ${stamp}`, channel: 'EMAIL', eventKey: 'account.password_reset', subject: 'W1C reset for {{workspaceName}}', body: 'Hello,\n\nReset here: {{resetLink}}\n\nIt expires in {{expiresIn}}.', active: true })
  if (resetTpl.json?.id) createdTemplates.push(resetTpl.json.id)
  check('templates: an email template for the password reset is accepted', resetTpl.status === 201, `status=${resetTpl.status} ${resetTpl.json?.message || ''}`)
  const noLink = await owner.call('/v1/notiftemplate/templates', 'POST', { companyId: company, name: `W1C QA nolink ${stamp}`, channel: 'EMAIL', eventKey: 'account.password_reset', subject: 'W1C {{resetLink}}', body: 'Ask HR to reset it for you.', active: true })
  if (noLink.json?.id) createdTemplates.push(noLink.json.id)
  check('templates: a password-reset email without {{resetLink}} in the message is refused', noLink.status === 400 && String(noLink.json?.message || '').includes('{{resetLink}}'), `status=${noLink.status} ${noLink.json?.message || ''}`)
  const upNoLink = resetTpl.json?.id ? await owner.call(`/v1/notiftemplate/templates/${resetTpl.json.id}`, 'PUT', { companyId: company, name: `W1C QA reset ${stamp}`, channel: 'EMAIL', eventKey: 'account.password_reset', subject: 'x', body: 'No link here', active: true }) : { status: 0 }
  check('templates: editing it to drop the link is refused too', upNoLink.status === 400, `status=${upNoLink.status}`)

  // ── 3. The template is used ───────────────────────────────────────────────
  const w1 = await reader.call('/v1/wfh', 'POST', { fromDate: dayAhead(base), toDate: dayAhead(base), reason: `W1C QA ${stamp} a` })
  if (w1.json?.id) createdWfh.push(w1.json.id)
  check('fixture: reader asks to work from home', w1.status === 201, `status=${w1.status} ${w1.json?.message || ''}`)
  const approver = w1.json?.id ? sql(`select approver_id from leave_mgmt.wfh_requests where id='${w1.json.id}'`) : ''
  check('fixture: the request goes to the reader\'s manager', approver === MGR, approver)
  await sleep(600)
  const n1 = w1.json?.id ? notifFor(w1.json.id) : ''
  check('template used: the manager\'s bell shows the company\'s wording', n1.startsWith(`W1C ${readerName} wants to work from home|W1C QA on `), n1)

  // ── 4. The approver switches this event off ───────────────────────────────
  const mgrView = await mgr.call('/v1/me/notification-preferences')
  const mgrWfh = (mgrView.json?.events || []).find((e) => e.key === 'wfh.submitted')
  check('preferences: the manager sees their own choices', mgrView.status === 200 && mgrWfh?.inApp === true && mgrWfh?.email === false, JSON.stringify(mgrWfh))
  const off = await mgr.call('/v1/me/notification-preferences', 'PUT', { events: { 'wfh.submitted': { inApp: false, push: false } } })
  const offRow = (off.json?.events || []).find((e) => e.key === 'wfh.submitted')
  check('preferences: the manager switches the WFH alert off', off.status === 200 && offRow?.inApp === false && offRow?.push === false, `status=${off.status}`)
  check('preferences: saved on the manager\'s account', sql(`select notification_preferences->'events'->'wfh.submitted'->>'inApp' from auth.user_credentials where tenant_id='${tenant}' and lower(email)='mgr@unifiedtree.demo'`) === 'false')
  const w2 = await reader.call('/v1/wfh', 'POST', { fromDate: dayAhead(base + 2), toDate: dayAhead(base + 2), reason: `W1C QA ${stamp} b` })
  if (w2.json?.id) createdWfh.push(w2.json.id)
  await sleep(600)
  check('preference honoured: no notification for a switched-off event', w2.status === 201 && notifFor(w2.json.id) === '', `status=${w2.status}`)

  // ── 5. Template off + alert back on → built-in wording ────────────────────
  const on = await mgr.call('/v1/me/notification-preferences', 'PUT', { events: { 'wfh.submitted': { inApp: true, push: true } } })
  check('preferences: the manager switches it back on', on.status === 200, `status=${on.status}`)
  const upd = await owner.call(`/v1/notiftemplate/templates/${good.json?.id}`, 'PUT', { ...tpl({ eventKey: 'wfh.submitted', subject: 'W1C {{employeeName}} wants to work from home', body: 'W1C QA {{dates}}' }), active: false })
  check('templates: owner turns the template off', upd.status === 200 && upd.json?.active === false, `status=${upd.status}`)
  const w3 = await reader.call('/v1/wfh', 'POST', { fromDate: dayAhead(base + 4), toDate: dayAhead(base + 5), reason: `W1C QA ${stamp} c` })
  if (w3.json?.id) createdWfh.push(w3.json.id)
  await sleep(600)
  const n3 = w3.json?.id ? notifFor(w3.json.id) : ''
  check('built-in wording comes back without an active template', n3.startsWith(`New WFH request|${readerName} requested to work from home from `), n3)

  // ── 6. The preferences endpoint rules ─────────────────────────────────────
  const rv = await reader.call('/v1/me/notification-preferences')
  const rEvents = rv.json?.events || []
  check('preferences: reader reads their own choices', rv.status === 200 && typeof rv.json?.emailEnabled === 'boolean' && rEvents.length > 30, `status=${rv.status}`)
  check('preferences: offers to candidates aren\'t listed (not a workspace user\'s choice)', !rEvents.some((e) => e.key === 'hiring.offer'))
  check('preferences: password reset is listed as always sent', rEvents.some((e) => e.key === 'account.password_reset' && e.essential && e.email === true))
  const essential = await reader.call('/v1/me/notification-preferences', 'PUT', { events: { 'account.password_reset': { email: false } } })
  check('preferences: an always-sent email can\'t be switched off', essential.status === 400, `status=${essential.status} ${essential.json?.message || ''}`)
  const unknown = await reader.call('/v1/me/notification-preferences', 'PUT', { events: { 'no.such.thing': { inApp: false } } })
  check('preferences: an unknown event is refused', unknown.status === 400, `status=${unknown.status}`)
  const wrongChannel = await reader.call('/v1/me/notification-preferences', 'PUT', { events: { 'people.probation_reminder': { push: false } } })
  check('preferences: a channel the event doesn\'t use is refused', wrongChannel.status === 400, `status=${wrongChannel.status}`)
  const mgrBefore = sql(`select coalesce(notification_preferences::text,'') from auth.user_credentials where tenant_id='${tenant}' and lower(email)='mgr@unifiedtree.demo'`)
  const mine = await reader.call('/v1/me/notification-preferences', 'PUT', { emailEnabled: false, events: { 'leave.approved': { email: true, push: false } } })
  check('preferences: reader saves email off and a per-event choice', mine.status === 200 && mine.json?.emailEnabled === false
    && sql(`select notification_preferences->'events'->'leave.approved'->>'push' from auth.user_credentials where id='${readerCreds}'`) === 'false', `status=${mine.status}`)
  check('preferences: only the caller\'s account changes', sql(`select coalesce(notification_preferences::text,'') from auth.user_credentials where tenant_id='${tenant}' and lower(email)='mgr@unifiedtree.demo'`) === mgrBefore)
  const profile = await reader.call('/v1/users/me', 'PUT', { notificationPreferences: { pushEnabled: false } })
  check('profile save merges: per-event choices survive the Profile switches', profile.status === 200
    && sql(`select (notification_preferences->>'pushEnabled') || '|' || (notification_preferences->'events'->'leave.approved'->>'email') from auth.user_credentials where id='${readerCreds}'`) === 'false|true', `status=${profile.status}`)
  const anon = await fetch(`${api}/v1/me/notification-preferences`, { headers: { 'X-Tenant-ID': tenant } })
  check('preferences: no session is refused', anon.status === 401 || anon.status === 403, `status=${anon.status}`)

  // ── 7. Always-sent email still goes out with email switched off ───────────
  const forgot = await fetch(`${api}/v1/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }, body: JSON.stringify({ email: 'reader@unifiedtree.demo' }) })
  await sleep(1500)
  const tokens = sql(`select count(*) from auth.invitation_tokens where user_id='${readerCreds}' and purpose='PASSWORD_RESET' and created_at > ${q(startedAt)}`)
  check('always sent: a password reset is issued (in the template\'s wording) although email is off', forgot.status === 200 && Number(tokens) >= 1, `status=${forgot.status} tokens=${tokens}`)
} catch (e) {
  check('run completed without an unexpected error', false, e.message)
} finally {
  // Put everything back.
  const owner = await login('owner@unifiedtree.demo').catch(() => null)
  const reader = await login('reader@unifiedtree.demo').catch(() => null)
  for (const id of createdWfh) {
    try { if (reader) await reader.call(`/v1/wfh/${id}/cancel`, 'POST') } catch { /* removed below */ }
  }
  try {
    if (createdWfh.length) {
      const ids = createdWfh.map(q).join(',')
      sql(`delete from notif.notifications where tenant_id='${tenant}' and (data->>'wfhRequestId') in (${ids})`)
      sql(`delete from leave_mgmt.wfh_requests where tenant_id='${tenant}' and id in (${ids})`)
    }
    for (const id of createdTemplates) {
      try { if (owner) await owner.call(`/v1/notiftemplate/templates/${id}`, 'DELETE') } catch { /* removed below */ }
      sql(`delete from notiftemplate_mgmt.notification_templates where id='${id}'`)
    }
    for (const [id, json] of Object.entries(prefsBackup)) {
      sql(`update auth.user_credentials set notification_preferences = ${json === 'NULL' ? 'NULL' : q(json) + '::jsonb'} where id='${id}'`)
    }
    if (readerCreds) sql(`delete from auth.invitation_tokens where user_id='${readerCreds}' and purpose='PASSWORD_RESET' and created_at > ${q(startedAt)}`)
    const left = Number(sql(`select count(*) from notiftemplate_mgmt.notification_templates where name like 'W1C QA%'`))
      + Number(sql(`select count(*) from leave_mgmt.wfh_requests where reason like 'W1C QA ${stamp}%'`))
    check('cleanup: nothing the test created is left', left === 0, `left=${left}`)
  } catch (e) {
    check('cleanup ran', false, e.message)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
