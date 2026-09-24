// "How a payroll run moves" — the lifecycle tiles, ported from the design
// component ProcessPipeline.dc.html. Tiles can filter the runs list.
import { createElement, createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { ProcessPipelineView } from './ProcessPipeline.view'
import { dashIcon } from './icons'

export interface PipelineStep {
  key: string; label: string; icon?: string; tone?: string; value?: string; unit?: string; desc?: string
  alert?: string; active?: boolean; onSelect?: () => void; tip?: string; stepLabel?: string
}

export class ProcessPipeline extends DCLogic<{ steps: PipelineStep[]; aside?: PipelineStep | null; loading?: boolean; label?: string }> {
  state = { w: 1000 }
  rootRef = createRef<HTMLDivElement>()
  private ro?: ResizeObserver
  componentDidMount() {
    const el = this.rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    this.ro = new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w && Math.abs(w - this.state.w) > 2) this.setState({ w }) })
    this.ro.observe(el)
  }
  componentWillUnmount() { this.ro?.disconnect() }
  renderVals() {
    const p = this.props, w = this.state.w
    const steps = p.steps || [], aside = p.aside ?? null, loading = !!p.loading, TONES = ['gray', 'blue', 'teal', 'green', 'red']
    const inRow = w >= steps.length * 200 + (steps.length - 1) * 16
    const bar = (bw: number, bh: number) => createElement('span', { 'aria-hidden': true, style: { display: 'inline-block', width: bw, height: bh, borderRadius: 8, background: '#eef2f5', animation: 'ut-pulse 1.4s ease-in-out infinite' } })
    const big = (v: string) => createElement('strong', { style: { fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontSize: 26, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-.02em', color: '#0f172a', fontVariantNumeric: 'tabular-nums' } }, v)
    const all = steps.map((s, i) => ({ ...s, main: true, idx: i })).concat(aside ? [{ ...aside, main: false, idx: -1 }] : [])
    const tiles = all.map((s) => {
      const tone = TONES.includes(s.tone || '') ? s.tone : 'gray', on = !!s.active, click = typeof s.onSelect === 'function', idle = !on && s.main
      return {
        key: s.key, label: s.label, desc: s.desc || '', unit: loading ? '' : s.unit || '', icon: dashIcon(s.icon || 'activity', 18),
        stepLabel: s.main ? `Step ${s.idx + 1}` : s.stepLabel || 'Other',
        fActive: on, fAside: !on && !s.main, fGray: idle && tone === 'gray', fBlue: idle && tone === 'blue', fTeal: idle && tone === 'teal', fGreen: idle && tone === 'green', fRed: idle && tone === 'red',
        cGray: tone === 'gray', cBlue: tone === 'blue', cTeal: tone === 'teal', cGreen: tone === 'green', cRed: tone === 'red',
        pressed: on, disabled: !click, onClick: click ? s.onSelect : undefined, tip: s.tip || '',
        hasAlert: !loading && !!s.alert, alert: s.alert || '',
        hasArrow: inRow && s.main && s.idx < steps.length - 1,
        valueNode: loading ? bar(34, 24) : big(s.value ?? '—'),
      }
    })
    return { rootRef: this.rootRef, label: p.label || 'Process steps', tiles, icWarn: dashIcon('alertTriangle', 13), icNext: dashIcon('chevronRight', 14) }
  }
  render() { return dc(this, ProcessPipelineView, 'ProcessPipeline') }
}
