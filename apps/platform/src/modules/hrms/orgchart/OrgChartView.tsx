// The org chart (client ask, 1 Oct 2026: "the top candidate should be at the
// top and in hierarchy the positions-wise a tree is formed as Keka … for every
// role"). Keka's organization tree, on the redesign kit:
//   - the top person at the top, reports in a row below with elbow connectors;
//     a count pill under each card opens and closes their reports
//   - "Search employee" jumps to a person; "Go to: Me / Top of the org"
//   - drag to move, zoom in/out, fit to screen; an indented list on phones
//   - you are highlighted, with the line from the top to you in brand
// Data: GET /v1/hrms/org-chart (useOrgChart). People with hrms.employee.read
// see the whole company (any company of the workspace); everyone else their
// own line up to the top and everyone below them. A card opens the person's
// profile when the viewer may open it, else a small card with public fields.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpToLine, LayoutList, Network, UserRound } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Avatar, Button, Callout, Card, EmptyState, ErrorState, SegmentedControl, Skeleton, SkeletonBlock, StatusPill } from '@/design/kit/display'
import { Dropdown, Popover } from '@/design/kit/overlays'
import { useIsMobile } from '@/design/dc/DesignFrame'
import { useCompanies } from '../api/useOrg'
import { useOrgChart, type OrgChartData, type OrgPerson } from './useOrgChart'
import { COMPANY_ROOT, buildTree, defaultExpanded, pathEdges as edgesTo, plural, revealed, statusLabel, type OrgTree } from './orgTree'
import { OrgCanvas, type MoveRequest, type View } from './OrgCanvas'
import { OrgList } from './OrgList'
import { OrgSearch } from './OrgSearch'
import './orgchart.css'

export interface OrgChartViewProps {
  /** The company to show (people with hrms.employee.read); empty = their own. Ignored for everyone else. */
  companyId?: string | null
  onCompanyChange?: (companyId: string) => void
  /** A person to open the chart on ("View in org chart" links: ?focus=<employeeId>). */
  focusId?: string | null
  /** Inside another page (Organization Setup): a shorter board. */
  embedded?: boolean
  /** Told what the chart shows, for the page's sub-line. */
  onLoaded?: (data: OrgChartData) => void
}

type Mode = 'chart' | 'list'
interface Saved { expanded: string[]; view: View | null; mode: Mode }

const storeKey = (data: OrgChartData) => `ut.orgchart:${data.scope}:${data.companyId ?? 'none'}`

function readSaved(key: string): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    return Array.isArray(s?.expanded) ? s : null
  } catch {
    return null
  }
}

function writeSaved(key: string, s: Saved) {
  try { window.sessionStorage.setItem(key, JSON.stringify(s)) } catch { /* private mode or full: the chart just starts fresh */ }
}

export function OrgChartView({ companyId, onCompanyChange, focusId, embedded, onLoaded }: OrgChartViewProps) {
  const canReadAll = usePermission(P.HRMS_EMPLOYEE_READ)
  const q = useOrgChart(canReadAll ? companyId : null)
  const companies = useCompanies()
  const data = q.data

  useEffect(() => { if (data) onLoaded?.(data) }, [data, onLoaded])

  const companyOptions = useMemo(
    () => (canReadAll ? (companies.data ?? []).filter((c) => c.active !== false || c.id === data?.companyId).map((c) => ({ value: c.id, label: c.name })) : []),
    [canReadAll, companies.data, data?.companyId],
  )
  const picker = canReadAll && companyOptions.length > 1 && data?.companyId
    ? (
      <Dropdown className="uoc-co" label="Company" options={companyOptions} value={data.companyId}
        onChange={(v) => onCompanyChange?.(v)} searchable={companyOptions.length > 6} />
    )
    : null

  if (q.isLoading) return <Shell bar={null}><Loading /></Shell>
  if (q.notAvailable) {
    return <Shell bar={null}><EmptyState icon="users" title="The org chart isn’t available yet" hint="It will show here once it’s switched on for your workspace." minHeight={360} /></Shell>
  }
  if (q.isError || !data) {
    return <Shell bar={null}><ErrorState title="The org chart couldn’t load" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} minHeight={360} /></Shell>
  }
  // Keyed by what's shown, so another company starts its own chart.
  return <Chart key={storeKey(data)} data={data} focusId={focusId} embedded={embedded} picker={picker} />
}

function Shell({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  return (
    <Card padding="none" radius={18} className="uoc uoc-shell" label="Org chart">
      {bar}
      {children}
    </Card>
  )
}

function Loading() {
  return (
    <SkeletonBlock label="Loading the org chart" className="uoc-skel">
      <Skeleton width={236} height={96} radius={14} />
      <div className="uoc-skel__row">
        {[0, 1, 2].map((i) => <Skeleton key={i} width={236} height={96} radius={14} />)}
      </div>
    </SkeletonBlock>
  )
}

interface ChartProps { data: OrgChartData; focusId?: string | null; embedded?: boolean; picker: ReactNode }

function Chart({ data, focusId, embedded, picker }: ChartProps) {
  const navigate = useNavigate()
  const isPhone = useIsMobile()
  const canReadAll = usePermission(P.HRMS_EMPLOYEE_READ)
  const canTeamRead = usePermission(P.ATTENDANCE_TEAM_READ)
  const tree = useMemo(() => buildTree(data), [data])
  const key = storeKey(data)
  const saved = useMemo(() => readSaved(key), [key])
  const focus = focusId && tree?.nodes.has(focusId) ? focusId : null

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!tree) return new Set()
    if (saved && !focus) {
      const keep = new Set(saved.expanded.filter((id) => tree.nodes.has(id)))
      keep.add(tree.rootId)
      return keep
    }
    return defaultExpanded(tree, focus)
  })
  const [found, setFound] = useState<string | null>(focus)
  const [mode, setMode] = useState<Mode>(saved?.mode === 'list' ? 'list' : 'chart')
  const [request, setRequest] = useState<MoveRequest | null>(focus ? { seq: 1, id: focus, to: 'person' } : null)
  const [revealSeq, setRevealSeq] = useState(focus ? 1 : 0)
  const [card, setCard] = useState<{ id: string } | null>(null)
  const anchorEl = useRef<HTMLElement | null>(null)
  const anchorRef = useRef<string | null>(null)
  const view = useRef<View | null>(saved && !focus ? saved.view : null)
  const seq = useRef(focus ? 1 : 0)
  const showList = isPhone || mode === 'list'

  // Keep the chart as it is for Back (session only; a closed tab starts fresh).
  const save = useCallback(() => writeSaved(key, { expanded: [...expanded], view: view.current, mode }), [key, expanded, mode])
  useEffect(() => { save() }, [save])

  const lit = useMemo(() => (tree ? edgesTo(tree, [tree.you, found]) : new Set<string>()), [tree, found])

  const toggle = useCallback((id: string) => {
    anchorRef.current = id
    setCard(null)
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const profilePath = useCallback((p: OrgPerson): string | null => {
    if (p.id === tree?.you) return '/profile'
    // The record (canViewRecord, the API's rule) and the employee page's own route guard.
    if (p.canViewRecord && (canReadAll || canTeamRead)) return `/hrms/employees/${p.id}`
    return null
  }, [tree?.you, canReadAll, canTeamRead])

  const open = useCallback((id: string, el: HTMLElement) => {
    if (id === COMPANY_ROOT) { toggle(id); return }
    const p = tree?.nodes.get(id)?.person
    if (!p) return
    const path = profilePath(p)
    if (path) { save(); navigate(path); return }
    anchorEl.current = el
    setCard({ id })
  }, [tree, toggle, profilePath, save, navigate])

  const jumpTo = useCallback((id: string, alsoOpen = false) => {
    if (!tree) return
    setCard(null)
    setExpanded((s) => { const n = revealed(tree, s, id); if (alsoOpen) n.add(id); return n })
    setFound(id)
    seq.current += 1
    setRequest({ seq: seq.current, id, to: 'person' })
    setRevealSeq(seq.current)
  }, [tree])

  const goTop = useCallback(() => {
    if (!tree) return
    setCard(null)
    setFound(null)
    seq.current += 1
    if (showList) {
      setExpanded((s) => new Set(s).add(tree.rootId))
      setFound(tree.rootId === COMPANY_ROOT ? null : tree.rootId)
      setRevealSeq(seq.current)
      document.querySelector<HTMLElement>('.uoc-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    setRequest({ seq: seq.current, to: 'top' })
  }, [tree, showList])

  if (!tree) {
    const none = data.scope === 'TEAM' && !data.viewerEmployeeId
    return (
      <Shell bar={picker ? <div className="uoc-bar">{picker}</div> : null}>
        <EmptyState icon="users" minHeight={360}
          title={none ? 'Your login isn’t linked to an employee record' : data.scope === 'TEAM' ? 'Your reporting line isn’t set up yet' : `No one in ${data.companyName ?? 'this company'} yet`}
          hint={none ? 'The org chart shows the people you work with once HR links your login to your employee record.'
            : data.scope === 'TEAM' ? 'Ask HR to add you to the workspace’s employees.' : 'People show here once they are added to this company.'} />
      </Shell>
    )
  }

  const cardPerson = card ? tree.nodes.get(card.id)?.person ?? null : null
  const companyName = data.companyName ?? 'Company'

  const bar = (
    <div className="uoc-bar">
      <OrgSearch tree={tree} onPick={(p) => jumpTo(p.id)} />
      <span className="uoc-bar__grow" />
      <div className="uoc-goto" role="group" aria-label="Go to">
        <span className="uoc-goto__label" aria-hidden="true">Go to</span>
        {tree.you && <Button size={36} icon={<UserRound size={15} strokeWidth={2} />} onClick={() => jumpTo(tree.you!, true)}>Me</Button>}
        <Button size={36} icon={<ArrowUpToLine size={15} strokeWidth={2} />} onClick={goTop}>Top of the org</Button>
      </div>
      {picker}
      {!isPhone && (
        <SegmentedControl label="Show as" semantics="toggle" size="lg" value={mode} onChange={(v) => { setCard(null); setMode(v) }}
          options={[
            { value: 'chart', label: <span className="uoc-seg"><Network size={14} strokeWidth={2} aria-hidden="true" />Chart</span>, ariaLabel: 'Chart' },
            { value: 'list', label: <span className="uoc-seg"><LayoutList size={14} strokeWidth={2} aria-hidden="true" />List</span>, ariaLabel: 'List' },
          ]} />
      )}
    </div>
  )

  return (
    <Shell bar={bar}>
      {data.truncated && (
        <div className="uoc-note">
          <Callout tone="warning">This chart shows the first {plural(data.people.length, 'person', 'people')}; some people further down are left out.</Callout>
        </div>
      )}
      {showList
        ? <OrgList tree={tree} expanded={expanded} found={found} companyName={companyName} revealSeq={revealSeq} onOpen={open} onToggle={toggle} />
        : (
          <OrgCanvas tree={tree} expanded={expanded} found={found} pathEdges={lit} companyName={companyName} embedded={embedded}
            initialView={view.current} request={request} anchorRef={anchorRef}
            onViewChange={(v) => { view.current = v; save() }} onInteract={() => setCard(null)}
            onOpen={open} onToggle={toggle} />
        )}
      <Popover open={!!cardPerson} onClose={() => setCard(null)} anchorRef={anchorEl} placement="bottom" role="dialog"
        aria-label={cardPerson ? `${cardPerson.name}` : undefined} className="uoc-pop-wrap">
        {cardPerson && (
          <PersonCardPop person={cardPerson} tree={tree} open={expanded.has(cardPerson.id)}
            onToggleTeam={() => { const id = cardPerson.id; setCard(null); toggle(id) }} />
        )}
      </Popover>
    </Shell>
  )
}

/** A person's public card: what anyone on the chart may see. */
function PersonCardPop({ person: p, tree, open, onToggleTeam }: { person: OrgPerson; tree: OrgTree; open: boolean; onToggleTeam: () => void }) {
  const node = tree.nodes.get(p.id)
  const parent = node?.parent ? tree.nodes.get(node.parent)?.person : null
  const shown = node?.children.length ?? 0
  const status = statusLabel(p.status)
  return (
    <div className="uoc uoc-pop">
      <div className="uoc-pop__head">
        <Avatar name={p.name} src={p.photoUrl} size={48} tone={p.id === tree.you ? 'solid' : 'soft'} />
        <div className="uoc-pop__who">
          <span className="uoc-pop__name">{p.name}</span>
          {p.designation && <span className="uoc-pop__role">{p.designation}</span>}
          {status && <span><StatusPill tone={status.tone} size="xs">{status.label}</StatusPill></span>}
        </div>
      </div>
      <dl className="uoc-pop__facts">
        {p.department && <><dt>Department</dt><dd>{p.department}</dd></>}
        {p.location && <><dt>Works at</dt><dd>{p.location}</dd></>}
        {parent && <><dt>Reports to</dt><dd>{parent.name}</dd></>}
        <dt>Direct reports</dt><dd>{p.directReports.toLocaleString('en-IN')}</dd>
      </dl>
      {p.note === 'MANAGER_NOT_SHOWN' && <p className="uoc-pop__note">Their manager isn’t on this chart, so they’re shown at the top.</p>}
      {p.note === 'CYCLE' && <p className="uoc-pop__note">Their reporting line comes back round to them, so they’re shown at the top. HR can fix it by changing a reporting manager.</p>}
      {shown > 0 && (
        <div className="uoc-pop__actions">
          <Button size={32} variant="soft" onClick={onToggleTeam}>{open ? 'Hide their team' : `Show their team (${shown})`}</Button>
        </div>
      )}
    </div>
  )
}
