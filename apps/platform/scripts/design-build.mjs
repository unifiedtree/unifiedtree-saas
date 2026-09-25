// Regenerates the design views (src/design/dc/*.view.tsx) from the Claude Design
// export in docs/Designs/. Run from apps/platform:
//
//   node scripts/design-build.mjs [Component ...]
//
// Steps: unpack the self-contained export → take each component's markup →
// apply the documented PATCHES (prototype-only literals and wiring the real app
// needs) → convert with scripts/dc-to-tsx.mjs. Logic files (X.tsx) are written
// by hand and are never touched by this script.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const EXPORT = resolve(here, '../../../docs/Designs/UnifiedTree HRMS Prototype.html')
const WORKSPACE_EXPORT = resolve(here, '../../../docs/Designs/UnifiedTree Employee Workspace (offline).html')
const ANALYTICS_EXPORT = resolve(here, '../../../docs/Designs/UnifiedTree Workforce Analytics (offline).html')
const OUT = resolve(here, '../src/design/dc')

// ── unpack ───────────────────────────────────────────────────────────────────
function unpack(file) {
  const src = readFileSync(file, 'utf8')
  const grab = (type) => { const open = `<script type="${type}">`; const a = src.indexOf(open); const b = src.indexOf('</script>', a); return src.slice(a + open.length, b) }
  const manifest = JSON.parse(grab('__bundler/manifest'))
  const ext = JSON.parse(grab('__bundler/ext_resources'))
  const text = (uuid) => { const e = manifest[uuid]; let b = Buffer.from(e.data, 'base64'); if (e.compressed) b = gunzipSync(b); return b.toString('utf8') }
  const out = {}
  for (const e of ext) if (e.id.endsWith('.dc.html')) out[e.id.replace('./', '').replace('.dc.html', '')] = text(e.uuid)
  return { components: out, template: JSON.parse(grab('__bundler/template')) }
}
const hrms = unpack(EXPORT)
const components = { ...hrms.components, HrmsPrototype: hrms.template }
// The Employee Workspace export (record page with tabs) ships one component, EmployeeBodyOffline.
const ws = unpack(WORKSPACE_EXPORT)
Object.assign(components, ws.components)
// The Workforce Analytics export is a single page: its component is the template itself.
const analytics = unpack(ANALYTICS_EXPORT)

// ── helpers ──────────────────────────────────────────────────────────────────
const body = (html) => html.slice(html.indexOf('<x-dc>') + 6, html.lastIndexOf('</x-dc>'))
function scIfBlock(src, marker) {
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('marker not found: ' + marker)
  const open = src.lastIndexOf('<sc-if', i), startInner = src.indexOf('>', i) + 1
  let depth = 1
  const re = /<(\/?)sc-if\b[^>]*>/g
  re.lastIndex = startInner
  let m
  while ((m = re.exec(src))) { depth += m[1] ? -1 : 1; if (depth === 0) return { outer: src.slice(open, re.lastIndex), inner: src.slice(startInner, m.index) } }
  throw new Error('unbalanced sc-if at ' + marker)
}
function xImportBlock(src, marker) {
  const start = src.indexOf(marker)
  if (start < 0) throw new Error('marker not found: ' + marker)
  let depth = 0
  const re = /<(\/?)x-import\b[^>]*?(\/?)>/g
  re.lastIndex = start
  let m
  while ((m = re.exec(src))) { if (m[2] === '/') continue; depth += m[1] ? -1 : 1; if (depth === 0) return src.slice(start, re.lastIndex) }
  throw new Error('unbalanced x-import at ' + marker)
}
const replaceOnce = (s, a, b) => { if (!s.includes(a)) throw new Error('patch target not found: ' + a.slice(0, 80)); return s.replace(a, b) }
/** Wrap the x-import whose opening tag contains `marker` in <sc-if value="{{ flag }}">. */
function wrapIf(s, marker, flag) {
  const i = s.indexOf(marker)
  if (i < 0) throw new Error('wrapIf marker not found: ' + marker)
  const start = s.lastIndexOf('<x-import', i)
  const block = xImportBlock(s, s.slice(start, i + marker.length))
  return s.slice(0, start) + `<sc-if value="{{ ${flag} }}">` + block + '</sc-if>' + s.slice(start + block.length)
}
/** End index of the <div> element that opens at `start` (balanced). */
function divEnd(s, start) {
  const re = /<(\/?)div\b[^>]*>/g
  re.lastIndex = start
  let depth = 0, m
  while ((m = re.exec(s))) { depth += m[1] ? -1 : 1; if (depth === 0) return re.lastIndex }
  throw new Error('unbalanced div at ' + start)
}
/** Wrap the white card (background:#fff, 16px radius) that contains `marker` in <sc-if value="{{ flag }}">. */
function wrapCard(s, marker, flag) {
  const i = s.indexOf(marker)
  if (i < 0) throw new Error('wrapCard marker not found: ' + marker)
  for (let j = s.lastIndexOf('<div ', i); j >= 0; j = s.lastIndexOf('<div ', j - 1)) {
    const tag = s.slice(j, s.indexOf('>', j))
    if (!tag.includes('background:#fff') || !tag.includes('border-radius:16px')) continue
    const end = divEnd(s, j)
    if (end > i) return s.slice(0, j) + `<sc-if value="{{ ${flag} }}">` + s.slice(j, end) + '</sc-if>' + s.slice(end)
  }
  throw new Error('wrapCard: no card around ' + marker)
}
/** Wrap the <tag> element whose opening tag contains `marker` (no nesting of the same tag inside). */
function wrapTag(s, marker, tag, flag) {
  const i = s.indexOf(marker)
  if (i < 0) throw new Error('wrapTag marker not found: ' + marker)
  const start = s.lastIndexOf('<' + tag, i), end = s.indexOf('</' + tag + '>', i) + tag.length + 3
  return s.slice(0, start) + `<sc-if value="{{ ${flag} }}">` + s.slice(start, end) + '</sc-if>' + s.slice(end)
}
/** Wrap the <section> that opens with `marker`. */
function wrapSection(s, marker, flag) {
  const a = s.indexOf(marker)
  if (a < 0) throw new Error('wrapSection marker not found: ' + marker)
  const b = s.indexOf('</section>', a) + '</section>'.length
  return s.slice(0, a) + `<sc-if value="{{ ${flag} }}">` + s.slice(a, b) + '</sc-if>' + s.slice(b)
}
/** Replace every occurrence of `{{ token }}`, in order, with the matching key. */
function sequence(s, token, keys, fmt) {
  const parts = s.split(`{{ ${token} }}`)
  if (parts.length - 1 !== keys.length) throw new Error(`${token}: expected ${keys.length}, found ${parts.length - 1}`)
  return parts.reduce((acc, part, i) => (i === 0 ? part : acc + `{{ ${fmt(keys[i - 1])} }}` + part), '')
}

// ── derived components + patches ─────────────────────────────────────────────
const CARDS = ['trend', 'today', 'dept', 'performers', 'onboarding', 'hiring', 'projects', 'payroll', 'activity', 'notices', 'milestones', 'probations']
const DERIVED = {
  // Workforce Analytics (also the template the report pages follow). The
  // template's <helmet> only loaded the prototype's demo data and design
  // system; the app supplies both.
  WorkforceAnalytics() {
    const tpl = analytics.template
    let t = tpl.slice(tpl.indexOf('<x-dc>'), tpl.indexOf('</x-dc>') + 7)
    t = t.replace(/<helmet>[\s\S]*?<\/helmet>\n?/, '')
    // Each chart shows only for people allowed to read its report (the page opens with any one of them).
    const section = (marker, flag) => {
      const a = t.indexOf(marker)
      if (a < 0) throw new Error('WorkforceAnalytics: section not found: ' + marker)
      const b = t.indexOf('</section>', a) + '</section>'.length
      t = t.slice(0, a) + `<sc-if value="{{ ${flag} }}">` + t.slice(a, b) + '</sc-if>' + t.slice(b)
    }
    section('<section style="flex:2 1 520px', 'canHead')
    section('<section style="flex:1 1 300px', 'canDiv')
    section('<section style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.05);padding:16px 18px 14px;min-width:0">', 'canAttr')
    return t
  },
  // The Employee Workspace export's page body; the app names it for what it is.
  EmployeeWorkspace() {
    let t = components.EmployeeBodyOffline
    // Actions only for the people who may take them (each maps to the permission its endpoint checks).
    t = wrapIf(t, 'on-click="{{ openShift }}"', 'canShift')
    t = wrapIf(t, 'on-click="{{ openEdit }}"', 'canEdit')
    t = wrapIf(t, 'on-click="{{ mConfirm }}"', 'canLifecycle')
    t = wrapIf(t, 'on-click="{{ mExtend }}"', 'canLifecycle')
    t = wrapIf(t, 'on-click="{{ mNotice }}"', 'canLifecycle')
    t = wrapIf(t, 'on-click="{{ invite }}"', 'canInvite')
    t = wrapIf(t, 'on-click="{{ askReset }}"', 'canFace')
    return t
  },
  // The dashboard lives inside the prototype's app template; pull out its
  // section, the mobile calendar sheet and the notice form.
  AdminDashboard() {
    const tpl = body(components.HrmsPrototype)
    let t = scIfBlock(tpl, 'value="{{ isDashboard }}"').inner + '\n' + scIfBlock(tpl, 'value="{{ calMobile }}"').outer + '\n' + xImportBlock(tpl, '<x-import component-from-global-scope="UnifiedTree.Modal"')
    // Each card gets its own loading / empty / error state (the prototype had one global switch).
    const SS = ['live', 'summary', 'alerts', ...CARDS]
    let i = 0
    t = t.replace(/<dc-import name="SectionState"[^>]*>/g, (tag) => { const k = SS[i++]; return tag.replace('{{ state }}', `{{ sec.${k}.state }}`).replace('{{ retry }}', `{{ sec.${k}.retry }}`) })
    if (i !== SS.length) throw new Error('SectionState count ' + i)
    t = sequence(t, 'tilesOk', ['live', 'summary'], (k) => `sec.${k}.tilesOk`)
    t = sequence(t, 'isError', ['live', 'summary'], (k) => `sec.${k}.isError`)
    t = sequence(t, 'isLive', CARDS, (k) => `sec.${k}.isLive`)
    t = sequence(t, 'notLive', CARDS, (k) => `sec.${k}.notLive`)
    // Prototype literals → real values.
    t = replaceOnce(t, 'Apr – Sep 2026', '{{ payRange }}')
    t = replaceOnce(t, 'min="2026-09-23"', 'min="{{ todayMin }}"')
    // Notice management (add / edit / archive) is for people who may write notices.
    for (const marker of ['sc-camel-on-click="{{ openNotice }}"', 'sc-camel-on-click="{{ n.onEdit }}"', 'sc-camel-on-click="{{ n.onArchive }}"']) t = wrapIf(t, marker, 'canManageNotices')
    // Sections and cards the viewer has no permission for are hidden, not shown
    // as an empty box (the design's rule; STATIC-UI-TO-BUILD §2). The container
    // sets each `show.*` from the permission its endpoint checks.
    for (const [marker, flag] of [['sec.dept.isLive', 'show.dept'], ['sec.performers.isLive', 'show.performers'], ['sec.onboarding.isLive', 'show.onboarding'],
      ['sec.projects.isLive', 'show.projects'], ['sec.activity.isLive', 'show.activity'], ['sec.probations.isLive', 'show.probations']]) t = wrapCard(t, marker, flag)
    t = wrapTag(t, 'sc-camel-on-click="{{ goEmployees }}"', 'button', 'show.directory')
    for (const [marker, flag] of [['<section aria-labelledby="sec-live"', 'show.live'], ['<section aria-labelledby="sec-summary"', 'show.summary'], ['<section aria-labelledby="sec-att"', 'show.att'],
      ['<section aria-labelledby="sec-emp"', 'show.emp'], ['<section aria-label="Recruitment and projects"', 'show.recruit'], ['<section aria-label="Payroll and activity"', 'show.payact'],
      ['<section aria-labelledby="sec-notices"', 'show.notices'], ['<section aria-labelledby="sec-ops"', 'show.ops']]) t = wrapSection(t, marker, flag)
    return '<x-dc>\n' + t + '\n</x-dc>\n'
  },
}
// Prototype literals (fixed demo dates) replaced by real values the logic supplies.
const LITERALS = {
  WorkforceAnalytics: [
    // The prototype's fixed 504 message → what actually went wrong.
    ['The analytics service took too long to respond (504 Gateway Timeout). Your filters are kept.', '{{ errText }}'],
    // The attrition chart's scroll box clipped its top axis label; give it room.
    ['<div style="overflow-x:auto"><div style="min-width:560px">', '<div style="overflow-x:auto;padding-top:10px"><div style="min-width:560px">'],
  ],
  // Employee Workspace: the sample person → the real record; states the design didn't draw.
  EmployeeWorkspace: [
    ['name="Aarav Menon" seed="{{ zero }}"', 'name="{{ name }}" seed="{{ seed }}"'],
    ['>EMP-0142</span>', '>{{ code }}</span>'],
    ['>Acme Technologies · Engineering · Joined 18 Sep 2026</div>', '>{{ metaLine }}</div>'],
    ['>Senior Engineer</div><div style="font-size:12.5px;color:#64748b">Engineering · Mumbai HQ</div>', '>{{ jobTitle }}</div><div style="font-size:12.5px;color:#64748b">{{ jobSub }}</div>'],
    ['<div style="zoom:.85"><x-import component-from-global-scope="UnifiedTree.HrAvatar" name="Priya Nair" sub="Engineering Manager" seed="{{ one }}" hint-size="160px,36px"></x-import></div>', '<sc-if value="{{ hasMgr }}"><div style="zoom:.85"><x-import component-from-global-scope="UnifiedTree.HrAvatar" name="{{ mgrName }}" sub="{{ mgrSub }}" seed="{{ mgrSeed }}" hint-size="160px,36px"></x-import></div></sc-if><sc-if value="{{ noMgr }}"><div style="font-size:13.5px;font-weight:600;margin-top:2px">—</div></sc-if>'],
    ['aarav.menon@acme.in · signed in today 09:12', '{{ accActiveSub }}'],
    // Face enrollment: the real status, and (a slot) HR's Enroll / Re-enroll with the web camera.
    ['<div style="flex:1 1 140px;font-size:13px;font-weight:600">Face enrollment</div>', '<div style="flex:1 1 140px;font-size:13px;font-weight:600">Face enrollment<div style="font-size:12px;font-weight:500;color:#64748b">{{ faceSub }}</div></div>{{ faceEnroll }}'],
    ['<span style="font-size:12.5px;font-weight:700;color:#0f6e56;white-space:nowrap">{{ n.cta }} ›</span></div></sc-for></div>', '<span style="font-size:12.5px;font-weight:700;color:#0f6e56;white-space:nowrap">{{ n.cta }} ›</span></div></sc-for><sc-if value="{{ noAtt }}"><div style="padding:10px 16px;border-top:1px solid #f8fafc;font-size:13px;color:#64748b">Nothing needs attention right now.</div></sc-if></div>'],
    // The onboarding record is only readable by people who can edit employees, and may not exist.
    ['<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">\n<div><div style="font-size:15px;font-weight:700">Onboarding record</div><div style="font-size:12.5px;color:#64748b">Captured when Aarav was hired · 18 Sep 2026</div></div>', '<sc-if value="{{ showOnb }}"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">\n<div><div style="font-size:15px;font-weight:700">Onboarding record</div><div style="font-size:12.5px;color:#64748b">{{ onbSub }}</div></div><sc-if value="{{ onbNote }}"><div style="font-size:13px;color:#64748b">{{ onbNoteText }}</div></sc-if>'],
    ['<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 16px"><sc-for list="{{ onb }}" as="f" hint-placeholder-count="6"><div><div style="font-size:11.5px;font-weight:600;color:#64748b">{{ f.l }}</div><div style="font-weight:600;margin-top:1px">{{ f.v }}</div></div></sc-for></div>', '<sc-if value="{{ hasOnb }}"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 16px"><sc-for list="{{ onb }}" as="f" hint-placeholder-count="6"><div><div style="font-size:11.5px;font-weight:600;color:#64748b">{{ f.l }}</div><div style="font-weight:600;margin-top:1px">{{ f.v }}</div></div></sc-for></div></sc-if>'],
    ['<div><div style="font-size:13px;font-weight:700;margin-bottom:6px">Recorded asset issues</div>', '<sc-if value="{{ hasAssets }}"><div><div style="font-size:13px;font-weight:700;margin-bottom:6px">Recorded asset issues</div>'],
    ['key-field="id" hint-size="100%,190px"></x-import></x-import></div>', 'key-field="id" hint-size="100%,190px"></x-import></x-import></div></sc-if>'],
    ['<div><div style="font-size:13px;font-weight:700;margin-bottom:6px">Policies selected for the hire</div>', '<sc-if value="{{ hasPolicies }}"><div><div style="font-size:13px;font-weight:700;margin-bottom:6px">Policies selected for the hire</div>'],
    ['{{ p }}</span></sc-for></div></div>', '{{ p }}</span></sc-for></div></div></sc-if>'],
    ['<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px"><sc-for list="{{ checklists }}"', '<sc-if value="{{ hasChecklists }}"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px"><sc-for list="{{ checklists }}"'],
    ['{{ r.s }}</x-import></div></sc-for></div></sc-for></div>\n</div>\n</div></x-import></sc-if>', '{{ r.s }}</x-import></div></sc-for></div></sc-for></div></sc-if>\n</div></sc-if>\n</div></x-import></sc-if>'],
    // Every other tab: its real content; the dashed card stays for tabs the backend can't fill yet.
    ['<div style="background:#fff;border:1.5px dashed #cbd5e1;border-radius:14px;padding:18px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px"><div style="flex:1 1 260px"><div style="font-size:15px;font-weight:700">{{ otherLabel }}</div><div style="font-size:13px;color:#64748b;margin-top:2px">{{ otherNote }}</div></div><x-import component-from-global-scope="UnifiedTree.HrButton" size="sm" variant="ghost" on-click="{{ toOverview }}" hint-size="130px,32px">Back to Overview</x-import></div>', '<sc-if value="{{ otherPlaceholder }}"><div style="background:#fff;border:1.5px dashed #cbd5e1;border-radius:14px;padding:18px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px"><div style="flex:1 1 260px"><div style="font-size:15px;font-weight:700">{{ otherLabel }}</div><div style="font-size:13px;color:#64748b;margin-top:2px">{{ otherNote }}</div></div><x-import component-from-global-scope="UnifiedTree.HrButton" size="sm" variant="ghost" on-click="{{ otherAction }}" hint-size="130px,32px">{{ otherCta }}</x-import></div></sc-if>{{ otherContent }}'],
    ['>General Shift · 09:00 – 18:00</div>', '>{{ curShift }}</div><sc-if value="{{ hasUpcoming }}"><div style="font-size:12.5px;color:#64748b;margin-top:2px">{{ upcoming }}</div></sc-if>'],
    ['min="2026-09-18"', 'min="{{ effMin }}"'],
    ['<x-import component-from-global-scope="UnifiedTree.Input" type="{{ f.type }}" default-value="{{ f.v }}" placeholder="{{ f.ph }}" hint-size="100%,40px"></x-import></div></sc-for>', '<sc-if value="{{ f.isSelect }}"><x-import component-from-global-scope="UnifiedTree.HrSelect" value="{{ f.v }}" options="{{ f.opts }}" on-change="{{ f.onSel }}" hint-size="100%,40px"></x-import></sc-if><sc-if value="{{ f.isInput }}"><x-import component-from-global-scope="UnifiedTree.Input" type="{{ f.type }}" value="{{ f.v }}" placeholder="{{ f.ph }}" disabled="{{ f.off }}" on-change="{{ f.on }}" hint-size="100%,40px"></x-import></sc-if><sc-if value="{{ f.hasErr }}"><div style="font-size:12.5px;font-weight:600;color:#be123c">{{ f.err }}</div></sc-if><sc-if value="{{ f.hasHint }}"><div style="font-size:12px;color:#64748b">{{ f.hint }}</div></sc-if></div></sc-for>'],
    // Lifecycle dialogs: a field can be a list (the exit type on Start notice / Mark exited), drawn
    // with the same HrSelect the edit drawer uses; every other field stays the design's Input.
    ['<x-import component-from-global-scope="UnifiedTree.Input" type="{{ f.type }}" value="{{ f.v }}" max-length="{{ f.max }}" placeholder="{{ f.ph }}" on-change="{{ f.on }}" hint-size="100%,40px"></x-import>', '<sc-if value="{{ f.isSelect }}"><x-import component-from-global-scope="UnifiedTree.HrSelect" value="{{ f.v }}" options="{{ f.opts }}" on-change="{{ f.onSel }}" hint-size="100%,40px"></x-import></sc-if><sc-if value="{{ f.isInput }}"><x-import component-from-global-scope="UnifiedTree.Input" type="{{ f.type }}" value="{{ f.v }}" max-length="{{ f.max }}" placeholder="{{ f.ph }}" on-change="{{ f.on }}" hint-size="100%,40px"></x-import></sc-if>'],
    ['variant="{{ mVariant }}" on-click="{{ mOk }}"', 'variant="{{ mVariant }}" disabled="{{ mBusy }}" on-click="{{ mOk }}"'],
    ['<span style="color:#34d399;font-weight:800;margin-right:8px">✓</span>{{ toast }}', '<sc-if value="{{ toastOk }}"><span style="color:#34d399;font-weight:800;margin-right:8px">✓</span></sc-if><sc-if value="{{ toastErr }}"><span style="color:#fb7185;font-weight:800;margin-right:8px">!</span></sc-if>{{ toast }}'],
    // Card titles are headings for screen readers (the design drew them as styled divs; same look).
    ['<div><div style="font-size:15px;font-weight:700">Onboarding record</div>', '<div><h2 style="margin:0;font-size:15px;font-weight:700">Onboarding record</h2>'],
    ['<div style="font-size:15px;font-weight:700">Account</div>', '<h2 style="margin:0;font-size:15px;font-weight:700">Account</h2>'],
    ['<div style="padding:11px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9">Needs attention', '<div role="heading" aria-level="2" style="padding:11px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #f1f5f9">Needs attention'],
  ],
  // Archived branches are listed under the "Inactive" filter; their card button restores them.
  CompaniesPage: [['onClick="{{ b.onArchive }}" data-tip="Archives this branch" hint-size="80px,32px">Archive</x-import>', 'onClick="{{ b.onArchive }}" data-tip="{{ b.archiveTip }}" hint-size="80px,32px">{{ b.archiveLabel }}</x-import>']],
  AttCalendar: [['September 2026', '{{ monthLabel }}']],
  AttendancePage: [['September 2026', '{{ monthLabel }}']],
  ShiftOvertime: [['Overtime · September 2026', 'Overtime · {{ monthLabel }}']],
  AttRegularization: [
    ['max="2026-09-23"', 'max="{{ todayMax }}"'],
    // The proof uploads when chosen (POST /v1/attendance/corrections/attachments, V143.10);
    // the picker is switched off only while a request is being sent.
    ['<input type="file" accept=".pdf,.jpg,.png"', '<input type="file" disabled="{{ proofOff }}" title="{{ proofTip }}" onChange="{{ onProof }}" accept=".pdf,.jpg,.png"'],
    ['A gate log, an email or a photo. PDF or image, up to 5 MB.', '{{ proofHelp }}'],
  ],
  ShiftRequests: [['min="2026-09-24"', 'min="{{ tomorrowMin }}"']],
  // The sample data used the employee code as the row id; real rows keep the id for the API.
  AttDailyLogs: [['name="{{ r.name }}" sub="{{ r.id }}"', 'name="{{ r.name }}" sub="{{ r.code }}"']],
  ShiftRoster: [['min="2026-09-24"', 'min="{{ tomorrowMin }}"'], ['name="{{ r.name }}" sub="{{ r.id }}"', 'name="{{ r.name }}" sub="{{ r.code }}"']],
  // Payroll: the prototype's company and "Sep 2026" run → the real company and the current run.
  PayDashboard: [
    ['Acme Industries Pvt Ltd · cost, dues and where this month’s run stands.', '{{ companyName }} · cost, dues and where this month’s run stands.'],
    ['data-tip="Opens the Sep 2026 payroll run"', 'data-tip="{{ runTip }}"'],
    ['{{ icPlay }} Open Sep 2026 run', '{{ icPlay }} {{ openRunLabel }}'],
    ['letter-spacing:-.01em">Sep 2026</h2>', 'letter-spacing:-.01em">{{ runLabel }}</h2>'],
    ['label="Sep 2026 progress"', 'label="{{ progressLabel }}"'],
    // Real lists can be empty; the design only drew the filled state.
    ['{{ d.amountLabel }}</strong></div></sc-for>', '{{ d.amountLabel }}</strong></div></sc-for><sc-if value="{{ noDues }}"><p style="margin:0;padding:12px 0;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b">{{ duesEmpty }}</p></sc-if>'],
    ['{{ r.employees }} employees · paid {{ r.paidOn }}', '{{ r.meta }}'],
    ['>Paid</x-import></button></sc-for>', '>Paid</x-import></button></sc-for><sc-if value="{{ noRecent }}"><p style="margin:0;padding:12px 0;border-top:1px solid #f1f5f9;font-size:13px;color:#64748b">{{ recentEmpty }}</p></sc-if>'],
  ],
  PaySalary: [
    ['Re-process the Sep 2026 run to include them.', 'Re-process the {{ runLabel }} run to include them.'],
    ['data-tip="Opens the Sep 2026 payroll run"', 'data-tip="{{ runTip }}"'],
    ['>Open Sep 2026 run<', '>Open {{ runLabel }} run<'],
    ['They’re skipped in the Sep 2026 run until you add one.', 'They’re skipped in the {{ runLabel }} run until you add one.'],
    ['value="{{ fDate }}" min="2026-09-01"', 'value="{{ fDate }}" min="{{ fDateMin }}"'],
    ['value="{{ bDate }}" min="2026-10-01"', 'value="{{ bDate }}" min="{{ bDateMin }}"'],
    // Bulk revise CTC (built 2026-09-25): the design's modal keeps its fields and
    // look; slots add what a real revision needs, built from the same field
    // styles and the module kit — how to revise (% or a fixed yearly amount),
    // the people picker when "Who" is a hand-picked list, the reason, and the
    // per-person preview with its warning.
    ['<label style="display:grid;gap:6px;font-size:13px;font-weight:600">Increase by (%) *<input type="number" min="1" max="50" step="0.5" value="{{ bPct }}"', '{{ bModeBlock }}<label style="display:grid;gap:6px;font-size:13px;font-weight:600">{{ bValueLabel }}<input type="number" min="{{ bMin }}" max="{{ bMax }}" step="{{ bStep }}" value="{{ bPct }}"'],
    ['options="{{ deptOptions }}" hint-size="100%,42px"></x-import></div>', 'options="{{ deptOptions }}" hint-size="100%,42px"></x-import></div>{{ bWhoBlock }}'],
    ['min="{{ bDateMin }}" on-change="{{ setBDate }}" label="Effective from" hint-size="100%,42px"></dc-import></div>', 'min="{{ bDateMin }}" on-change="{{ setBDate }}" label="Effective from" hint-size="100%,42px"></dc-import></div>{{ bReasonBlock }}'],
    ['color:#065f46">{{ bPreview }}</p>', 'color:#065f46">{{ bPreview }}</p>{{ bPreviewBlock }}'],
    ['disabled="{{ bBad }}" hint-size="150px,40px">Apply revision</x-import>', 'disabled="{{ bBad }}" hint-size="150px,40px">{{ bApplyLabel }}</x-import>'],
    // The split is the backend's, not the prototype's fixed 50% / 40% / 12% rule.
    ['Basic is 50% of gross, HRA is 40% of basic, and PF is 12% of basic up to ₹1,800.', '{{ splitNote }}'],
    ['Enter at least ₹10,000.', '{{ minNote }}'],
  ],
  // The API records who created, processed, locked and paid a run; the bank file's line has no name, so it's just the time.
  PayrollOverview: [['{{ a.who }} · {{ a.when }}', '{{ a.meta }}']],
  // LWF is deducted only in some months (the design's own "June & December"); which months is a
  // setting, so the LWF card's field grid gets a third slot, built from the same Field + HrSelect kit.
  PaySettings: [['<div style="min-width:0">{{ fx.lwfEr }}</div>', '<div style="min-width:0">{{ fx.lwfEr }}</div><div style="min-width:0">{{ fx.lwfMonths }}</div>']],
  PayrollRunPage: [
    ['title="No one to pay in Sep 2026"', 'title="{{ emptyTitle }}"'],
    // Real data for the run's parts (appended last, so it overrides the prototype's props).
    ['on-navigate="{{ navOverview }}" on-toast="{{ toast }}" hint-size="100%,900px"></dc-import>', 'on-navigate="{{ navOverview }}" on-toast="{{ toast }}" dc-props="{{ pxOverview }}" hint-size="100%,900px"></dc-import>'],
    ['on-process="{{ askProcess }}" on-toast="{{ toast }}" hint-size="100%,640px"></dc-import>', 'on-process="{{ askProcess }}" on-toast="{{ toast }}" dc-props="{{ pxEmployees }}" hint-size="100%,640px"></dc-import>'],
    ['on-close="{{ closeSlip }}" on-toast="{{ toast }}" hint-size="0,0"></dc-import>', 'on-close="{{ closeSlip }}" on-toast="{{ toast }}" dc-props="{{ pxSlip }}" hint-size="0,0"></dc-import>'],
    // The register the API makes is a PDF.
    ['payroll register (Excel)"', 'payroll register (PDF)"'],
    // One bank file per run (the API's rule), and it's cancelled before reopening.
    ['The 2 bank files you generated will be cancelled. Prepare new ones after you lock the run again.', '{{ mBankText }}'],
    // Marking a run paid needs the bank's transfer reference (UTR) — the API requires it.
    ['<sc-if value="{{ mBankNote }}"', '<sc-if value="{{ mIsPaid }}" hint-placeholder-val="{{ false }}"><label style="display:grid;gap:6px;font-size:13px;font-weight:600">Bank reference (UTR) *<input value="{{ utr }}" onChange="{{ setUtr }}" maxLength="120" placeholder="e.g. HDFCN52026092012345" style="font:inherit;font-weight:400;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;outline:none" style-focus="border-color:#0f6e56;box-shadow:0 0 0 3px #a7f3d0"><span style="font-size:12px;font-weight:400;color:#64748b">From your bank’s transfer confirmation. Saved with the payment.</span></label></sc-if> <sc-if value="{{ mBankNote }}"'],
  ],
  PayPli: [
    ['September targets and bonuses by team.', '{{ monthName }} targets and bonuses by team.'],
    ['data-tip="Opens the Sep 2026 payroll run"', 'data-tip="{{ runTip }}"'],
    // PLI isn't part of payroll processing in this backend — say so, and link to the awards it's paid through.
    ['See Sep 2026 run →', '{{ pliLink }}'],
    ['PLI bonuses are added to net pay automatically when payroll is processed. This month: ', '{{ pliLead }} '],
    ['description="Targets for October 2026. Bonuses are paid when a team meets its target."', 'description="{{ targetsDesc }}"'],
  ],
  PayBank: [
    ['data-tip="Opens the Sep 2026 payroll run"', 'data-tip="{{ runTip }}"'],
    ['{{ icRun }} Sep 2026 run', '{{ icRun }} {{ runLabel }} run'],
    ['Both Sep 2026 transfers are confirmed. Mark the run as paid to close it.', '{{ allDoneText }}'],
    ['>Open Sep 2026 run<', '>Open {{ runLabel }} run<'],
    ['>Sep 2026 · {{ totalLabel }}<', '>{{ runLabel }} · {{ totalLabel }}<'],
    // Bank profiles (the account salaries are paid from) have no place in the design; keep them reachable.
    ['<x-import component-from-global-scope="UnifiedTree.HrButton" variant="ghost" onClick="{{ openRun }}"', '<x-import component-from-global-scope="UnifiedTree.HrButton" variant="ghost" onClick="{{ openProfiles }}" data-tip="Opens bank profile setup" hint-size="150px,40px">{{ icBankSm }} Bank profiles</x-import><x-import component-from-global-scope="UnifiedTree.HrButton" variant="ghost" onClick="{{ openRun }}"'],
    // Confirming the transfer marks the run paid, which needs the bank's reference (UTR).
    ['size="sm" hint-size="0,0">\n<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:8px"><x-import component-from-global-scope="UnifiedTree.HrButton" variant="ghost" onClick="{{ closeConfirm }}"', 'size="sm" hint-size="0,0"> <label style="display:grid;gap:6px;margin-top:4px;font-size:13px;font-weight:600;color:#0f172a;font-family:Inter,-apple-system,sans-serif">Bank reference (UTR) *<input value="{{ utr }}" onChange="{{ setUtr }}" maxLength="120" placeholder="e.g. HDFCN52026092012345" style="font:inherit;font-weight:400;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;outline:none" style-focus="border-color:#0f6e56;box-shadow:0 0 0 3px #a7f3d0"><span style="font-size:12px;font-weight:400;color:#64748b">From your bank’s transfer confirmation. Saved with the payment.</span></label> <div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:8px"><x-import component-from-global-scope="UnifiedTree.HrButton" variant="ghost" onClick="{{ closeConfirm }}"'],
    ['onClick="{{ doConfirm }}" hint-size="150px,40px">Confirm transfer', 'onClick="{{ doConfirm }}" disabled="{{ confirmOff }}" hint-size="150px,40px">Confirm transfer'],
  ],
  // The API gives a confidence band, not a percentage.
  AttFacePunch: [
    ['{{ r.conf }}% sure', '{{ r.bandSure }}'], ['{{ r.conf }}% match', '{{ r.bandMatch }}'],
    ['Punches under 85% need a person to check.', '{{ r.rule }}'], ['85% needed', '{{ r.needLabel }}'],
  ],
}

// Markup patches that need code. AttendancePage: give every tab its own props
// slot (real data + its own loading/error state). dc-props is appended last, so
// it overrides the shared props the prototype passed.
const PATCH = {
  // Client, 26 Sep: the page title, its one-line description and Add company
  // belong to the whole page, not to the left column. The prototype nested them
  // inside the <aside>, so the heading was squeezed into the company card's
  // width and Add company sat mid-page instead of at the right edge. Lift the
  // row out above the two columns and give it the page-header type scale.
  CompaniesPage(html) {
    html = replaceOnce(html, '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;min-height:40px;margin-bottom:4px"><h1 style="margin:0;font-family:\'Plus Jakarta Sans\',Inter,sans-serif;font-size:20px;font-weight:700;letter-spacing:-.01em;color:#0f172a">Companies &amp; Branches</h1><sc-if value="{{ canEdit }}" hint-placeholder-val="{{ true }}"><x-import component-from-global-scope="UnifiedTree.HrButton" size="sm" onClick="{{ addCompany }}" data-tip="Opens Add company" hint-size="124px,32px">{{ icPlus }} Add company</x-import></sc-if></div>\n', '')
    html = replaceOnce(html, '<div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:20px;min-width:0">\n', '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 16px;min-width:0"><div style="display:grid;gap:4px;min-width:0"><h1 style="margin:0;font-family:\'Plus Jakarta Sans\',Inter,sans-serif;font-size:28px;font-weight:700;letter-spacing:-.02em;color:#0f172a">Companies &amp; Branches</h1><p style="margin:0;font-size:14px;line-height:1.5;color:#64748b">Manage your company details and branch locations with their attendance boundaries.</p></div><sc-if value="{{ canEdit }}" hint-placeholder-val="{{ true }}"><x-import component-from-global-scope="UnifiedTree.HrButton" size="sm" onClick="{{ addCompany }}" data-tip="Opens Add company" hint-size="124px,32px">{{ icPlus }} Add company</x-import></sc-if></div>\n' + '<div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:20px;min-width:0">\n')
    return html
  },
  AttendancePage(html) {
    // One column capped at the page width, so the section bar scrolls sideways
    // on a phone (as its overflow-x:auto intends) instead of widening the page.
    html = replaceOnce(html, 'style="display:grid;gap:16px;min-width:0;font-family:Inter', 'style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px;min-width:0;font-family:Inter')
    const KIDS = 'AttOverview|AttCalendar|AttDailyLogs|AttFacePunch|AttRegularization|AttMine|ShiftSchedules|ShiftRoster|ShiftOvertime|ShiftRequests'
    let n = 0
    const out = html.replace(new RegExp(`<dc-import name="(${KIDS})"([^>]*?)(/?)>`, 'g'), (m, name, attrs, slash) => {
      n++
      const mode = /mode="(hr|mine)"/.exec(attrs)
      const key = name === 'ShiftRequests' ? (mode && mode[1] === 'mine' ? 'ShiftRequestsMine' : 'ShiftRequestsHr') : name
      return `<dc-import name="${name}"${attrs} dc-props="{{ px.${key} }}"${slash}>`
    })
    if (n !== 11) throw new Error('AttendancePage: expected 11 tab components, patched ' + n)
    // Daily Tracking → Review (V143.10): the attendance review list, built from
    // the module kit by the container, sits after Regularization.
    return replaceOnce(out, '<sc-if value="{{ tMine }}"', '<sc-if value="{{ tReview }}" hint-placeholder-val="{{ false }}">{{ reviewBlock }}</sc-if>\n<sc-if value="{{ tMine }}"')
  },
  // The server refuses a bank file while anyone in it lacks bank details
  // (BATCH_HAS_EXCLUDED_EMPLOYEES). The design had nowhere to say who, so a
  // slot after the file rows lists them with the way to fix it.
  PayBank(html) {
    const i = html.indexOf('<sc-for list="{{ batches }}"')
    if (i < 0) throw new Error('PayBank: batches list not found')
    const j = html.indexOf('</sc-for>', i) + '</sc-for>'.length
    return html.slice(0, j) + '\n{{ excludedBlock }}' + html.slice(j)
  },
  // The design drew only a loaded payslip; while it loads, or if it can't be
  // loaded, the drawer was blank forever. A slot after it shows either state.
  PayslipDrawer(html) {
    const i = html.lastIndexOf('</sc-if>')
    if (i < 0) throw new Error('PayslipDrawer: payslip block not found')
    return html.slice(0, i + '</sc-if>'.length) + '\n{{ stateBlock }}' + html.slice(i + '</sc-if>'.length)
  },
  // Bulk revise CTC is for people who may revise many salaries at once
  // (payroll.structure.bulk-revise); others don't see the button.
  PaySalary(html) {
    return wrapIf(html, 'onClick="{{ openBulk }}"', 'canBulk')
  },
  // Same for the payroll module: every section gets its own real-data props slot.
  PayrollModule(html) {
    const KIDS = 'PayDashboard|PaySalary|PayRuns|PayrollRunPage|PaySettings|PayPli|PayAdvances|PayBank'
    let n = 0
    const out = html.replace(new RegExp(`<dc-import name="(${KIDS})"([^>]*?)(/?)>`, 'g'), (m, name, attrs, slash) => {
      n++
      return `<dc-import name="${name}"${attrs} dc-props="{{ px.${name} }}"${slash}>`
    })
    if (n !== 8) throw new Error('PayrollModule: expected 8 section components, patched ' + n)
    return out
  },
}

// Post-conversion edits on the generated TSX, when a markup patch can't express it.
const POST = {}

// ── build ────────────────────────────────────────────────────────────────────
const wanted = process.argv.slice(2)
// PlaceholderPage is the prototype's stand-in for screens that weren't designed; the app keeps its own pages there.
const SKIP = new Set(['HrmsPrototype', 'PlaceholderPage', 'EmployeeBodyOffline'])
const all = [...Object.keys(components).filter((n) => !SKIP.has(n)), ...Object.keys(DERIVED)]
const list = wanted.length ? wanted : all
const work = mkdtempSync(join(tmpdir(), 'design-build-'))
mkdirSync(OUT, { recursive: true })
for (const name of list) {
  let html = DERIVED[name] ? DERIVED[name]() : components[name]
  if (!html) { console.warn('unknown component', name); continue }
  for (const [from, to] of LITERALS[name] || []) {
    if (!html.includes(from)) throw new Error(`${name}: literal not found: ${from}`)
    html = html.split(from).join(to)
  }
  if (PATCH[name]) html = PATCH[name](html)
  const f = join(work, name + '.html')
  writeFileSync(f, html)
  execFileSync(process.execPath, [join(here, 'dc-to-tsx.mjs'), name, f, OUT], { stdio: 'inherit' })
  if (POST[name]) {
    const vf = join(OUT, name + '.view.tsx')
    writeFileSync(vf, POST[name](readFileSync(vf, 'utf8')))
  }
}
