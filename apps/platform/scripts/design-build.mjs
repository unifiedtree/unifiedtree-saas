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
const OUT = resolve(here, '../src/design/dc')

// ── unpack ───────────────────────────────────────────────────────────────────
const src = readFileSync(EXPORT, 'utf8')
const grab = (type) => { const open = `<script type="${type}">`; const a = src.indexOf(open); const b = src.indexOf('</script>', a); return src.slice(a + open.length, b) }
const manifest = JSON.parse(grab('__bundler/manifest'))
const ext = JSON.parse(grab('__bundler/ext_resources'))
const template = JSON.parse(grab('__bundler/template'))
const text = (uuid) => { const e = manifest[uuid]; let b = Buffer.from(e.data, 'base64'); if (e.compressed) b = gunzipSync(b); return b.toString('utf8') }
const components = {}
for (const e of ext) if (e.id.endsWith('.dc.html')) components[e.id.replace('./', '').replace('.dc.html', '')] = text(e.uuid)
components.HrmsPrototype = template

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
/** Replace every occurrence of `{{ token }}`, in order, with the matching key. */
function sequence(s, token, keys, fmt) {
  const parts = s.split(`{{ ${token} }}`)
  if (parts.length - 1 !== keys.length) throw new Error(`${token}: expected ${keys.length}, found ${parts.length - 1}`)
  return parts.reduce((acc, part, i) => (i === 0 ? part : acc + `{{ ${fmt(keys[i - 1])} }}` + part), '')
}

// ── derived components + patches ─────────────────────────────────────────────
const CARDS = ['trend', 'today', 'dept', 'performers', 'onboarding', 'hiring', 'projects', 'payroll', 'activity', 'notices', 'milestones', 'probations']
const DERIVED = {
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
    return '<x-dc>\n' + t + '\n</x-dc>\n'
  },
}
// Prototype literals (fixed demo dates) replaced by real values the logic supplies.
const LITERALS = {
  AttCalendar: [['September 2026', '{{ monthLabel }}']],
  AttendancePage: [['September 2026', '{{ monthLabel }}']],
  ShiftOvertime: [['Overtime · September 2026', 'Overtime · {{ monthLabel }}']],
  AttRegularization: [
    ['max="2026-09-23"', 'max="{{ todayMax }}"'],
    // The API takes no file for a fix request yet — the picker stays, switched off and marked.
    ['<input type="file" accept=".pdf,.jpg,.png"', '<input type="file" disabled="{{ proofOff }}" title="{{ proofTip }}" accept=".pdf,.jpg,.png"'],
    ['A gate log, an email or a photo. PDF or image, up to 5 MB.', '{{ proofHelp }}'],
  ],
  ShiftRequests: [['min="2026-09-24"', 'min="{{ tomorrowMin }}"']],
  // The sample data used the employee code as the row id; real rows keep the id for the API.
  AttDailyLogs: [['name="{{ r.name }}" sub="{{ r.id }}"', 'name="{{ r.name }}" sub="{{ r.code }}"']],
  ShiftRoster: [['min="2026-09-24"', 'min="{{ tomorrowMin }}"'], ['name="{{ r.name }}" sub="{{ r.id }}"', 'name="{{ r.name }}" sub="{{ r.code }}"']],
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
    return out
  },
}

// Post-conversion edits on the generated TSX, when a markup patch can't express it.
const POST = {}

// ── build ────────────────────────────────────────────────────────────────────
const wanted = process.argv.slice(2)
const all = [...Object.keys(components).filter((n) => n !== 'HrmsPrototype'), ...Object.keys(DERIVED)]
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
