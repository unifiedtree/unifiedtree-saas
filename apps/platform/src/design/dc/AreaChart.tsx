// Ported from the design component AreaChart.dc.html.
import { DCLogic, dc } from './dc-runtime'
import { AreaChartView } from './AreaChart.view'
import { DashChart } from './chart'

export class AreaChart extends DCLogic {
  state: any = { hover: null }
  renderVals() {
    const p = this.props
    const rows: any[] = p.rows || []
    const series: any[] = p.series || []
    const n = Math.max(rows.length, 1), H = 50, yMin = p.yMin ?? 0, yMax = p.yMax ?? 120, span = yMax - yMin || 1
    const X = (i: number) => ((i + 0.5) / n) * 100
    const Y = (v: any) => Math.max(0, Math.min(H, H - ((Number(v) - yMin) / span) * H))
    const sel = this.state.hover ?? ((p.selectedIndex ?? -1) >= 0 ? p.selectedIndex : rows.length - 1)
    const ser = series.map((s: any, si: number) => {
      const pts = rows.map((r: any, i: number) => [X(i), Y(r.values[si])])
      const line = DashChart.smooth(pts, H)
      const last = pts[pts.length - 1] || [0, 0], first = pts[0] || [0, 0]
      const hp = pts[sel] || last
      return {
        color: s.color, lineD: line,
        areaD: s.area && line ? `${line} L${last[0].toFixed(2)},${H} L${first[0].toFixed(2)},${H} Z` : '',
        areaOpacity: s.area ? 0.16 : 0, dash: s.dashed ? '5 4' : 'none', hx: hp[0].toFixed(2), hy: hp[1].toFixed(2),
      }
    })
    const cols = rows.map((r: any, i: number) => ({
      label: r.label, title: r.title || r.label, tip: r.tip || r.title || r.label, active: i === sel, idle: i !== sel,
      onEnter: () => this.setState({ hover: i }), onClick: () => p.onPick && p.onPick(i),
    }))
    const cur = rows[sel] || {}
    const readout = {
      title: cur.title || cur.label || '',
      items: series.map((s: any, si: number) => ({ label: s.short || s.label, value: (cur.display || [])[si] ?? (cur.values || [])[si], color: s.color })),
    }
    return { ser, cols, readout, legend: series, yTicks: p.yTicks || ['120', '90', '60', '30', '0'], onLeave: () => this.setState({ hover: null }) }
  }
  render() { return dc(this, AreaChartView, 'AreaChart') }
}
