// What the content area shows while a page's code arrives: the outline of that
// kind of page (header card, tiles, table, chart, form…) in the redesign's
// look, inside the shell, instead of a bare "Loading…" line on a blank screen.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'

const card: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }
const Bar = ({ w, h = 12, r = 6, style }: { w: number | string; h?: number; r?: number; style?: CSSProperties }) => (
  <span className="ut-skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
)

function Header({ actions = true }: { actions?: boolean }) {
  return (
    <div style={{ ...card, padding: '26px 30px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
      <div style={{ display: 'grid', gap: 12, flex: 1 }}>
        <Bar w={90} h={10} />
        <Bar w={260} h={26} r={8} />
        <Bar w="min(520px,80%)" h={12} />
      </div>
      {actions && <div style={{ display: 'flex', gap: 10 }}><Bar w={96} h={40} r={12} /><Bar w={140} h={40} r={12} /></div>}
    </div>
  )
}
function Tiles({ n = 4 }: { n?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ ...card, padding: 18, display: 'flex', gap: 14 }}>
          <Bar w={42} h={42} r={12} />
          <div style={{ display: 'grid', gap: 9, flex: 1 }}><Bar w="55%" h={11} /><Bar w="35%" h={24} r={7} /><Bar w="70%" h={10} /></div>
        </div>
      ))}
    </div>
  )
}
function Table({ rows = 7 }: { rows?: number }) {
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}><Bar w={280} h={38} r={11} /><Bar w={150} h={38} r={11} /><Bar w={130} h={38} r={11} /></div>
      <div style={{ height: 44, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', height: 62, borderBottom: i < rows - 1 ? '1px solid #f1f5f9' : 0 }}>
          <Bar w={36} h={36} r={18} />
          <div style={{ display: 'grid', gap: 7, flex: 2 }}><Bar w="60%" h={12} /><Bar w="35%" h={10} /></div>
          <Bar w="12%" h={12} /><Bar w="14%" h={12} /><Bar w={70} h={22} r={11} />
        </div>
      ))}
    </div>
  )
}
const Chart = ({ h = 240 }: { h?: number }) => (
  <div style={{ ...card, padding: 20, display: 'grid', gap: 16 }}>
    <Bar w={180} h={14} />
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: h }}>
      {[55, 80, 40, 95, 65, 75, 50, 85].map((p, i) => <Bar key={i} w="100%" h={p * h / 100} r={6} style={{ flex: 1 }} />)}
    </div>
  </div>
)
const Tabs = () => (
  <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', height: 54, display: 'flex', alignItems: 'center', gap: 28, padding: '0 clamp(16px,2.5vw,28px)' }}>
    {[70, 130, 120, 100, 140].map((w, i) => <Bar key={i} w={w} h={12} />)}
  </div>
)
const Bare = createContext(false)
function Frame({ children, tabs }: { children: ReactNode; tabs?: boolean }) {
  return useContext(Bare)
  ? <div aria-busy="true" aria-label="Loading page" style={{ display: 'grid', gap: 18 }}>{children}</div>
  : (
    <div aria-busy="true" aria-label="Loading page">
      {tabs && <Tabs />}
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px clamp(16px,2.5vw,28px) 48px', display: 'grid', gap: 18 }}>{children}</div>
    </div>
  )
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
  return <Bare.Provider value={!!bare}><Outline kind={kindOf(path)} /></Bare.Provider>
}

function Outline({ kind }: { kind: string }) {
  if (kind === 'record') return (
    <Frame>
      <div style={{ ...card, padding: 24, display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Bar w={64} h={64} r={32} /><div style={{ display: 'grid', gap: 10, flex: 1 }}><Bar w={220} h={20} r={7} /><Bar w={320} h={11} /></div><Bar w={120} h={34} r={10} /></div>
        <div style={{ display: 'flex', gap: 22 }}>{[70, 70, 50, 80, 70, 80].map((w, i) => <Bar key={i} w={w} h={12} />)}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}><Chart h={160} /><Chart h={160} /></div>
    </Frame>
  )
  if (kind === 'dashboard') return <Frame><Header /><Tiles /><div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}><Chart /><Chart /></div></Frame>
  if (kind === 'report') return <Frame><Header /><Tiles /><Chart /><Table rows={5} /></Frame>
  if (kind === 'settings') return (
    <Frame>
      <Header actions={false} />
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ ...card, padding: 22, display: 'grid', gap: 16 }}>
          <Bar w={200} h={16} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>{[0, 1, 2, 3].map((j) => <div key={j} style={{ display: 'grid', gap: 8 }}><Bar w={110} h={10} /><Bar w="100%" h={40} r={10} /></div>)}</div>
        </div>
      ))}
    </Frame>
  )
  if (kind === 'master') return <Frame tabs><Header /><Tiles /><Table /></Frame>
  return <Frame><Header /><Tiles /><Table /></Frame>
}
