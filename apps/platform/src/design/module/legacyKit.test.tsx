// F2d: the legacy page kit rebuilt on the redesign kit keeps the markup that pages
// and tests rely on (roles, names, ids, classes). Server-rendered, no DOM library.
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { ApprovalList, DecisionCard, Facts, ModulePage, Note, Panel, Row, RowList, State, StatRow, SubHeading, Views } from './ModuleKit'
import {
  SettingsInput, SettingsNote, SettingsPage, SettingsSection, SettingsSwitch, SettingsToggleRow, SettingsValue,
} from '../settings/SettingsKit'
import { FilterBar, HrAvatar, HrButton, HrPageHeader, HrStatCard, HrStatusPill, HrTabs, TableCard } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { DataTable } from '@/shared/components/DataTable'
import { HrPagination, hrPaginationFooter } from '@/shared/components/HrPagination'
import { PageSkeleton } from '@/shared/components/PageSkeleton'
import { SkeletonBlock, SkeletonCard } from '@/shared/components/SkeletonCard'
import { StatCard } from '@/shared/components/StatCard'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { SubTabs } from '@/design/dc/SubTabs'
import { TimePicker } from '@/design/dc/TimePicker'
import { statTone } from '@/design/dc/StatTile.view'
import { Inbox } from 'lucide-react'

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => {}
type Globals = { window?: unknown }
const g = globalThis as unknown as Globals
afterEach(() => { delete g.window })

/** No raw hex outside var(--u-x, #fallback) in an inline style (dark mode goes through the tokens). */
function rawHexInStyles(s: string): string[] {
  const bad: string[] = []
  for (const m of s.matchAll(/style="([^"]*)"/g)) {
    const style = m[1].replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '')
    const hex = style.match(/#[0-9a-fA-F]{3,8}\b/g)
    if (hex) bad.push(...hex)
  }
  return bad
}

describe('ModuleKit', () => {
  it('ModulePage: the kit header (context line, h1, summary, actions) in the frame', () => {
    const s = html(<ModulePage crumb="Leave management" title="Leave" subtitle="Approve requests" actions={<button>New</button>}><p>body</p></ModulePage>)
    expect(s).toContain('<div class="uk-ph__eyebrow">Leave management</div><h1 class="uk-ph__title">Leave</h1>')
    expect(s).toContain('<p class="uk-ph__sub">Approve requests</p>')
    expect(s).toContain('<div class="uk-ph__actions"><button>New</button></div>')
    expect(s).toContain('max-width:1440px')
    expect(s).toContain('padding:28px clamp(16px,2.4vw,36px) 56px')
    expect(rawHexInStyles(s)).toEqual([])
  })

  it('Views: role=group with its label, aria-pressed pills, counts (0 hidden), urgent badge', () => {
    const s = html(<Views label="Leave views" active="b" onChange={noop} items={[{ key: 'a', label: 'Approvals', count: 3, urgent: true }, { key: 'b', label: 'Decided', count: 0 }, { key: 'c', label: 'Encash', count: 5 }]} />)
    expect(s).toContain('role="group" aria-label="Leave views"')
    expect((s.match(/aria-pressed="true"/g) || []).length).toBe(1)
    expect((s.match(/aria-pressed="false"/g) || []).length).toBe(2)
    expect(s).toMatch(/aria-pressed="true"[^>]*class="uk-fpill is-on"><span><span class="sc-interp">Decided<\/span><\/span><\/button>/)
    expect(s).toContain('uk-fpill__n dcsub-n is-urgent')
    expect(s).toContain('>5</span>')
  })

  it('StatRow: a group of stat cards; each tile stays a button (.ut-card), tones follow the design', () => {
    const s = html(<StatRow tiles={[{ icon: 'clock', color: 'orange', label: 'Waiting', value: '4', sub: 'Not decided' }, { icon: 'users', color: 'blue', label: 'Members', value: '12', onClick: noop }]} />)
    expect(s).toContain('role="group"')
    expect((s.match(/<button type="button" class="ut-card uk-stat uk-stat--stat/g) || []).length).toBe(2)
    expect(s).toContain('uk-stat__circle--gold')
    expect(s).toContain('uk-stat__circle--brand')
    expect(s).toContain('<span class="uk-stat__label">Waiting</span>')
    expect(s).toContain('Not decided')
    expect(statTone('red')).toBe('red')
    expect(statTone('teal')).toBe('brand')
  })

  it('State: error = role=alert with "Try again" only when there is a retry; loading = role=status', () => {
    const e = html(<State kind="error" description="Server said no" onRetry={noop} />)
    expect(e).toContain('role="alert"')
    expect(e).toContain('Unable to load this section.')
    expect(e).toContain('Server said no')
    expect(e).toContain('Try again</button>')
    expect(html(<State kind="error" />)).not.toContain('Try again')
    expect(html(<State kind="loading" />)).toContain('role="status" aria-label="Loading"')
    expect(html(<State kind="empty" title="Nothing waiting" />)).toContain('Nothing waiting')
  })

  it('ApprovalList and DecisionCard: <article> cards, the note box and the buttons keep their names', () => {
    const a = html(<ApprovalList onDecide={noop} approveLabel="Approve fix" items={[{ id: '1', name: 'Priya Sharma', facts: [{ k: 'Days', v: '2' }], reason: 'Family', raised: '25 Sep' }]} />)
    expect(a).toContain('<article class="uko-apprc dcap">')
    expect(a).toContain('placeholder="Decision note (optional)" aria-label="Decision note"')
    expect(a).toMatch(/>Reject<\/button>/)
    expect(a).toMatch(/Approve fix<\/span><\/button>/)
    expect(a).toContain('Pending')
    const d = html(<DecisionCard name="Rahul" status={['Approved', 'ok']} facts={[{ k: 'Amount', v: '₹500' }]} reason="Travel" actions={<button>Mark reimbursed</button>} />)
    expect(d).toContain('<article class="uko-apprc dcap">')
    expect(d).toContain('Mark reimbursed')
    expect(d).toContain('uk-tone--success')
  })

  it('RowList / Row: a clickable row is one button, rows sit in one card', () => {
    const s = html(<RowList><Row title="Onboarding" meta="3 tasks left" onClick={noop} /><Row title="Plain" muted /></RowList>)
    expect(s).toContain('<div class="umk-rows"')
    expect(s).toContain('<button type="button" class="umk-row">')
    expect(s).toContain('<div class="umk-row" style="opacity:0.7">')
    expect(rawHexInStyles(s)).toEqual([])
  })

  it('Panel, Note, Facts, SubHeading: tokens only; a red note is an alert', () => {
    const p = html(<Panel title="Apply" sub="Pick the days"><Note tone="red">Not allowed</Note><Note>Plain</Note><Facts items={[{ k: 'Balance', v: '4' }]} /></Panel>)
    expect(p).toContain('<p role="alert" class="umk-note uk-tone--danger">Not allowed</p>')
    expect(p).toContain('<p class="umk-note uk-tone--neutral">Plain</p>')
    expect(p).toContain('<dt class="uk-kv__k">Balance</dt><dd class="uk-kv__v">4</dd>')
    expect(p).toContain('<h3')
    expect(rawHexInStyles(p)).toEqual([])
    const h = html(<SubHeading aside={<button>Add</button>}>Waiting for your OK</SubHeading>)
    expect(h).toContain('<h3 class="uk-shead__title">Waiting for your OK</h3>')
    expect(h).toContain('<button>Add</button>')
  })
})

describe('SettingsKit', () => {
  const page = (extra: Partial<Parameters<typeof SettingsPage>[0]> = {}) => html(
    <SettingsPage crumb="HR Setup" title="HR Configuration" subtitle="Rules" entity="HR settings" access="edit" status="live"
      nav={[{ key: 'ids', label: 'Employee IDs', state: 'on' }, { key: 'week', label: 'Work week', state: 'none', errors: 2 }]}
      dirty={false} changeCount={0} errorCount={0} saving={false} onSave={noop} onDiscard={noop} toast={null} onDismissToast={noop} {...extra}>
      <SettingsSection id="ids" icon="hash" title="Employee IDs" summary="Next EMP-0001" />
    </SettingsPage>,
  )

  it('the "On this page" list links to #st- sections; the heading is the page title', () => {
    const s = page()
    expect(s).toContain('<nav aria-label="On this page" class="uks-toc">')
    expect(s).toContain('href="#st-ids"')
    expect(s).toContain('href="#st-week"')
    expect(s).toContain('aria-label="2 to fix"')
    expect(s).toContain('<h1 class="uk-ph__title">HR Configuration</h1>')
    expect(s).not.toMatch(/class="(on|active)"/)
    expect(s).toContain('<section id="st-ids" aria-labelledby="st-ids-h"')
    expect(s).toContain('<h2 id="st-ids-h" tabindex="-1" class="uks-sec__title">Employee IDs</h2>')
  })

  it('the unsaved-changes bar, the error jump and the view-only note', () => {
    const dirty = page({ dirty: true, changeCount: 2 })
    expect(dirty).toContain('role="region" aria-label="Unsaved changes"')
    expect(dirty).toContain('You have unsaved changes')
    expect(dirty).toContain('2 changes · not saved yet')
    expect(dirty).toContain('Save settings')
    expect(dirty).toContain('Discard')
    const err = page({ dirty: true, changeCount: 1, errorCount: 1 })
    expect(err).toContain('Fix 1 error to save')
    const view = page({ access: 'view' })
    expect(view).toContain('role="note"')
    expect(view).toContain('>View only<')
    expect(page({ status: 'loading' })).toContain('role="status" aria-label="Loading HR settings"')
    expect(page({ status: 'error', onRetry: noop })).toContain('Try again')
    expect(page({ access: 'none' })).toContain('Access restricted')
  })

  it('switches keep role=switch and their names; Coming soon and read-only pills', () => {
    expect(html(<SettingsSwitch on onToggle={noop} label="Push notifications" />)).toContain('role="switch" aria-checked="true" aria-label="Push notifications"')
    const sec = html(<SettingsSection id="wfh" icon="home" title="Work from home" summary="On" on onToggle={noop} />)
    expect(sec).toContain('aria-label="Turn Work from home off"')
    expect(html(<SettingsSection id="x" icon="lock" title="SSO" summary="Later" soon />)).toContain('>Coming soon</span>')
    expect(html(<SettingsSection id="y" icon="lock" title="Y" summary="s" on onToggle={noop} readOnly />)).toContain('>On</span>')
    expect(html(<SettingsToggleRow label="Email notifications" detail="d" on={false} onToggle={noop} />)).toContain('role="switch" aria-checked="false" aria-label="Email notifications"')
    expect(html(<SettingsToggleRow label="Email" detail="d" on onToggle={noop} readOnly />)).not.toContain('role="switch"')
  })

  it('inputs: a real label, the error as an alert (hint hidden), affixes, read-only as text', () => {
    const s = html(<SettingsInput label="Prefix" value="" onChange={noop} error="Use 1–10 letters or digits" hint="Shown before the number" suffix="days" />)
    const id = s.match(/<label class="uks-label" for="([^"]+)">Prefix<\/label>/)?.[1]
    expect(id).toBeTruthy()
    expect(s).toContain(`id="${id}"`)
    expect(s).toContain('aria-invalid="true"')
    expect(s).toContain('role="alert" class="uks-error">Use 1–10 letters or digits</p>')
    expect(s).not.toContain('Shown before the number')
    expect(s).toContain('<span class="uks-affix">days</span>')
    const ro = html(<SettingsInput label="Prefix" value="EMP" onChange={noop} readOnly />)
    expect(ro).not.toContain('<input')
    expect(ro).toContain('EMP')
    expect(html(<SettingsValue label="Plan" value="ENTERPRISE" />)).toContain('ENTERPRISE')
    expect(html(<SettingsNote tone="amber">Careful</SettingsNote>)).toContain('uk-tone--warning')
  })
})

describe('hr.tsx and shared pieces', () => {
  it('HrStatusPill maps the old tones onto the kit palette', () => {
    expect(html(<HrStatusPill tone="ok">Active</HrStatusPill>)).toContain('uk-tone--success')
    expect(html(<HrStatusPill tone="warn">Pending</HrStatusPill>)).toContain('uk-tone--warning')
    expect(html(<HrStatusPill tone="red">Rejected</HrStatusPill>)).toContain('uk-tone--danger')
    expect(html(<HrStatusPill tone="teal">WFH</HrStatusPill>)).toContain('uk-tone--mint')
    expect(html(<HrStatusPill>Draft</HrStatusPill>)).toContain('uk-tone--neutral')
    expect(html(<HrStatusPill tone={'nonsense' as never}>X</HrStatusPill>)).toContain('uk-tone--neutral')
  })

  it('HrButton keeps its variants and passes callers\' classes and props through', () => {
    const s = html(<HrButton variant="ghost" size="sm" className="mt-2" data-tip="Rejects">Reject</HrButton>)
    expect(s).toContain('mt-2')
    expect(s).toContain('data-tip="Rejects"')
    expect(s).toContain('>Reject</button>')
    expect(html(<HrButton>Save</HrButton>)).toContain('bg-[var(--u-br,#0F6E56)]')
  })

  it('HrPageHeader: the crumb sits right before the h1; the old bottom margin override still applies', () => {
    const s = html(<HrPageHeader crumb="Reports & Analytics" title="Reports Center" subtitle="Every report" className="!mb-0" />)
    expect(s).toContain('<div class="uk-ph__eyebrow">Reports &amp; Analytics</div><h1 class="uk-ph__title">Reports Center</h1>')
    expect(s).toContain('!mb-0')
  })

  it('TableCard keeps .ut-card; FilterBar keeps data-filter; HrTabs keeps tab roles and ids', () => {
    const t = html(<TableCard search={{ value: '', onChange: noop }} filters={[{ key: 'dept', allLabel: 'All departments', value: 'x', options: [{ value: 'x', label: 'X' }], onChange: noop }]}><table /></TableCard>)
    expect(t).toContain('class="ut-card overflow-hidden"')
    expect(t).toContain('data-filter="dept"')
    expect(t).toContain('Clear filter</button>')
    const f = html(<FilterBar filters={[{ key: 'from', allLabel: 'From', value: '', type: 'date', onChange: noop }]} />)
    expect(f).toContain('data-filter="from"')
    const tabs = html(<HrTabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'pay', label: 'Pay', badge: 3 }]} active="pay" onChange={noop} />)
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('id="tab-pay" aria-selected="true" aria-controls="panel-pay" tabindex="0"')
    expect(tabs).toContain('id="tab-overview" aria-selected="false" aria-controls="panel-overview" tabindex="-1"')
    expect(tabs).toContain('uk-ptab is-on')
  })

  it('HrAvatar keeps its two initials and survives a missing name; HrStatCard is the kit stat card', () => {
    expect(html(<HrAvatar name="Anil Kumar Reddy" sub="EMP1" />)).toContain('>AK</span>')
    expect(html(<HrAvatar name={null} />)).toContain('—')
    const c = html(<HrStatCard icon={<Inbox />} color="red" value="7" label="Late" sub="Today" trend={{ dir: 'down', value: '2' }} onClick={noop} />)
    expect(c).toContain('<button type="button" class="ut-card uk-stat uk-stat--stat')
    expect(c).toContain('uk-stat__circle--red')
    expect(c).toContain('uk-stat__delta--bad')
    expect(html(<HrStatCard icon={<Inbox />} value="1" label="Staff" loading />)).toContain('aria-label="Loading Staff"')
  })

  it('EmptyState, StatCard, DataTable, pager and skeletons', () => {
    const e = html(<EmptyState icon={Inbox} title="No claims" description="Claims show up here." action={{ label: 'Try again', onClick: noop }} />)
    expect(e).toContain('No claims')
    expect(e).toContain('Claims show up here.')
    expect(e).toMatch(/Try again<\/span><\/span><\/button>/)
    expect(html(<StatCard title="Open tickets" value="5" icon={Inbox} iconColor="text-red-400" change="+2" changeType="negative" />)).toContain('uk-stat__circle--red')
    const d = html(<DataTable columns={[{ key: 'name', header: 'Name', sortable: true }]} data={[]} keyField={'name' as never} emptyMessage="No one matches" />)
    expect(d).toContain('>Name<')
    expect(d).toContain('No one matches')
    const p = html(<HrPagination page={1} pageSize={20} totalElements={45} totalPages={3} onPageChange={noop} onPageSizeChange={noop} />)
    expect(p).toContain('aria-label="Previous page"')
    expect(p).toContain('aria-label="Next page"')
    expect(p).toContain('data-testid="rows-per-page"')
    expect(p).toContain('2 / 3')
    expect(html(<HrPagination page={0} pageSize={20} totalElements={3} totalPages={1} onPageChange={noop} />)).toBe('')
    expect(hrPaginationFooter({ page: 0, pageSize: 20, totalElements: 3, totalPages: 1, onPageChange: noop })).toBeUndefined()
    expect(html(<PageSkeleton path="/hrms/leave" />)).toContain('aria-label="Loading page"')
    expect(html(<PageSkeleton path="/me/payslips" />)).toContain('data-frame="narrow"')
    expect(html(<SkeletonCard />)).toContain('role="status" aria-label="Loading"')
    expect(html(<SkeletonBlock className="h-4 w-40" />)).toContain('h-4 w-40')
  })
})

describe('design/dc pieces', () => {
  it('DesignFrame: 1440 for admin pages, 1320 for self-service, the design padding', () => {
    expect(html(<DesignFrame>x</DesignFrame>)).toContain('data-frame="wide"')
    g.window = { location: { pathname: '/me/payslips' } }
    expect(html(<DesignFrame>x</DesignFrame>)).toContain('max-width:1320px')
    g.window = { location: { pathname: '/team' } }
    expect(html(<DesignFrame>x</DesignFrame>)).toContain('data-frame="narrow"')
    g.window = { location: { pathname: '/hrms/leave' } }
    expect(html(<DesignFrame>x</DesignFrame>)).toContain('max-width:1440px')
    expect(html(<DesignFrame width="narrow">x</DesignFrame>)).toContain('max-width:1320px')
  })

  it('SubTabs: the same group/pressed semantics when used directly', () => {
    const s = html(<SubTabs label="Overtime views" items={[{ key: 'p', label: 'Pending', count: 2, urgent: true, active: true, onClick: noop }, { key: 'd', label: 'Decided', onClick: noop }]} />)
    expect(s).toContain('role="group" aria-label="Overtime views"')
    expect(s).toContain('aria-pressed="true"')
    expect(s).not.toContain('is-urgent')
  })

  it('TimePicker: the trigger keeps aria-haspopup="dialog" and its accessible name', () => {
    const s = html(<TimePicker value="09:30" onChange={noop} label="Came in at" />)
    expect(s).toContain('aria-haspopup="dialog"')
    expect(s).toContain('aria-label="Came in at: 9:30 AM"')
    expect(s).toContain('9:30 AM')
    expect(rawHexInStyles(s)).toEqual([])
  })
})
