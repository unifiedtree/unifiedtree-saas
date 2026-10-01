// What the content area shows while a page's code arrives: the outline of that
// kind of page in the redesign's look (prototype PgGeneric: a header with no
// card behind it, stat tiles, a table card; or a chart, a form, a record), in
// the page frame, instead of a bare "Loading…" line on a blank screen.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { Skeleton } from '@/design/kit/Skeleton'
import { DesignFrame } from '@/design/dc/DesignFrame'

const card: CSSProperties = { background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 16, boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))' }
const line = 'inset 0 1px 0 var(--u-ln2,#EDF1EF)'
const Bar = ({ w, h = 12, r, tone, style }: { w: number | string; h?: number; r?: number; tone?: 'hv' | 'ln'; style?: CSSProperties }) => (
  <Skeleton width={w} height={h} radius={r ?? Math.min(6, h / 2)} tone={tone} style={style} />
)

function Header({ actions = true }: { actions?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
      <div style={{ display: 'grid', gap: 10, flex: '1 1 260px', minWidth: 0 }}>
        <Bar w={96} h={12} />
        <Bar w={260} h={28} r={8} tone="ln" />
        <Bar w="min(520px,80%)" h={14} />
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}><Bar w={110} h={38} r={10} /><Bar w={130} h={38} r={10} /></div>}
    </div>
  )
}
function Tiles({ n = 4 }: { n?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 12 }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ ...card, height: 132, boxSizing: 'border-box', padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <Bar w={42} h={42} r={21} />
          <div style={{ display: 'grid', gap: 8 }}><Bar w="52%" h={10} /><Bar w="34%" h={18} r={6} tone="ln" /></div>
        </div>
      ))}
    </div>
  )
}
function Table({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 20px' }}><Bar w={180} h={14} tone="ln" /><Bar w="min(220px,45%)" h={34} r={10} /></div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) 90px', alignItems: 'center', gap: 16, padding: '14px 20px', boxShadow: line }}>
          <Bar w={34} h={34} r={17} />
          <Bar w={['64%', '48%', '62%', '55%', '76%', '44%'][i % 6]} h={10} />
          <Bar w={['40%', '58%', '46%', '66%', '38%', '52%'][i % 6]} h={10} />
          <Bar w="60%" h={10} />
          <Skeleton height={22} radius={999} className="uk-skel--pill" />
        </div>
      ))}
    </div>
  )
}
const Chart = ({ h = 240 }: { h?: number }) => (
  <div style={{ ...card, padding: 20, display: 'grid', gap: 16, minWidth: 0 }}>
    <Bar w={180} h={14} tone="ln" />
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: h }}>
      {[55, 80, 40, 95, 65, 75, 50, 85].map((p, i) => <Bar key={i} w="100%" h={p * h / 100} r={8} style={{ flex: 1, maxWidth: 46 }} />)}
    </div>
  </div>
)
/** The page's own view tabs (outlined pills) for pages that still draw them. */
const Tabs = () => (
  <div style={{ display: 'flex', gap: 8, overflow: 'hidden' }}>
    {[92, 126, 118, 104, 132].map((w, i) => <Bar key={i} w={w} h={36} r={999} />)}
  </div>
)
const Bare = createContext(false)
const SELF_SERVICE = /^\/(me|team|hrms\/ess)(\/|$)/
const Path = createContext('')
function Frame({ children, tabs }: { children: ReactNode; tabs?: boolean }) {
  const bare = useContext(Bare)
  const path = useContext(Path)
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      {tabs && !bare && <Tabs />}
      {children}
    </div>
  )
  return bare
    ? <div aria-busy="true" aria-label="Loading page">{body}</div>
    : <div aria-busy="true" aria-label="Loading page"><DesignFrame width={SELF_SERVICE.test(path) ? 'narrow' : 'wide'}>{body}</DesignFrame></div>
}

/** The kind of page at a path, so the outline matches what's about to appear. */
function kindOf(path: string) {
  if (/^\/hrms\/employees\/[^/]+$/.test(path) || /^\/me\/?$/.test(path)) return 'record'
  if (/^\/(dashboard|me\/dashboard|team)\/?$/.test(path) || /dashboard$/.test(path)) return 'dashboard'
  if (/^\/hrms\/(reports|workforce-analytics|att-analytics)/.test(path)) return 'report'
  if (/^\/(settings|profile)|\/settings(\/|$)|\/hrms\/settings/.test(path)) return 'settings'
  if (/^\/hrms\/(master|employees|organization|policies)|^\/hrms\/payroll\/components/.test(path)) return 'master'
  return 'list'
}

/** `bare`: just the page body, for a page that already drew its own tabs and frame. */
export function PageSkeleton({ path, bare }: { path: string; bare?: boolean }) {
  return <Path.Provider value={path}><Bare.Provider value={!!bare}><Outline kind={kindOf(path)} /></Bare.Provider></Path.Provider>
}

function Outline({ kind }: { kind: string }) {
  if (kind === 'record') return (
    <Frame>
      <div style={{ ...card, padding: 24, display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Bar w={64} h={64} r={32} /><div style={{ display: 'grid', gap: 10, flex: 1, minWidth: 0 }}><Bar w={220} h={20} r={7} tone="ln" /><Bar w="min(320px,90%)" h={11} /></div><Bar w={120} h={38} r={10} /></div>
        <div style={{ display: 'flex', gap: 22, overflow: 'hidden' }}>{[70, 70, 50, 80, 70, 80].map((w, i) => <Bar key={i} w={w} h={12} />)}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16 }}><Chart h={160} /><Chart h={160} /></div>
    </Frame>
  )
  if (kind === 'dashboard') return <Frame><Header /><Tiles /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16 }}><Chart /><Chart /></div></Frame>
  if (kind === 'report') return <Frame><Header /><Tiles /><Chart /><Table rows={5} /></Frame>
  if (kind === 'settings') return (
    <Frame>
      <Header actions={false} />
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ ...card, borderRadius: 18, padding: 20, display: 'grid', gap: 16 }}>
          <Bar w={200} h={16} tone="ln" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((j) => <div key={j} style={{ display: 'grid', gap: 8 }}><Bar w={110} h={10} /><Bar w="100%" h={40} r={11} /></div>)}</div>
        </div>
      ))}
    </Frame>
  )
  if (kind === 'master') return <Frame tabs><Header /><Tiles /><Table /></Frame>
  return <Frame><Header /><Tiles /><Table /></Frame>
}
