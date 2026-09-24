// Ported from the design component SeatsTile.dc.html.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { SeatsTileView } from './SeatsTile.view'
import { dashIcon } from './icons'

export class SeatsTile extends DCLogic {
  renderVals() {
    const purchased = Number(this.props.purchased ?? 0)
    const used = Math.min(Number(this.props.used ?? 0), purchased)
    const remaining = Math.max(purchased - used, 0), r = purchased ? remaining / purchased : 1
    const tier = remaining <= 0 ? 'exhausted' : r <= 0.05 ? 'critical' : r <= 0.15 ? 'low' : 'ok'
    const pulse = (color: string) => createElement('span', { 'aria-hidden': 'true', style: { position: 'relative', display: 'inline-flex', width: 9, height: 9 } },
      createElement('span', { style: { position: 'relative', width: 9, height: 9, borderRadius: 999, background: color, boxShadow: '0 0 0 3px ' + color + '33, 0 0 10px ' + color + '99' } }))
    return {
      used, purchased, remaining,
      pct: purchased ? Math.round((used / purchased) * 100) : 0,
      remainingLabel: remaining === 1 ? 'Only 1 seat left.' : `Only ${remaining} seats left.`,
      isOk: tier === 'ok', isLow: tier === 'low', isCritical: tier === 'critical', isExhausted: tier === 'exhausted',
      icSeats: dashIcon('armchair', 15), pulseOrange: pulse('#ea580c'), pulseRed: pulse('#e11d48'),
      manage: this.props.onManage || (() => {}),
    }
  }
  render() { return dc(this, SeatsTileView, 'SeatsTile') }
}
