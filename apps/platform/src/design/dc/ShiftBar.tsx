// Ported from the design component ShiftBar.dc.html.
import { DCLogic, dc } from './dc-runtime'
import { ShiftBarView } from './ShiftBar.view'

export class ShiftBar extends DCLogic {
  renderVals() {
    const p = this.props
    const mins = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
    const fmt = (t: string) => {
      const [h, m] = String(t || '0:0').split(':').map(Number)
      return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
    }
    const start = p.start || '09:00', end = p.end || '17:00', s = mins(start), e = mins(end), pc = (n: number) => ((n / 1440) * 100).toFixed(3) + '%'
    const segs = e > s ? [{ x: pc(s), w: pc(e - s) }] : e === s ? [] : [{ x: pc(s), w: pc(1440 - s) }, { x: '0%', w: pc(e) }]
    return { segs, color: p.color || '#10b981', ticks: !!p.ticks, aria: `Works ${fmt(start)} to ${fmt(end)}${e <= s ? ' the next day' : ''}` }
  }
  render() { return dc(this, ShiftBarView, 'ShiftBar') }
}
