// Ported from the design component StatTile.dc.html.
import { DCLogic, dc } from './dc-runtime'
import { StatTileView } from './StatTile.view'
import { dashIcon } from './icons'

export class StatTile extends DCLogic {
  renderVals() {
    const t = this.props.tile || { icon: dashIcon('users', 17), color: this.props.color || 'blue', label: '', value: '', sub: '', chart: null, onClick: () => {} }
    const c = t.color || 'blue'
    return { t, isBlue: c === 'blue', isGreen: c === 'green', isOrange: c === 'orange', isRed: c === 'red', isPurple: c === 'purple', isTeal: c === 'teal' }
  }
  render() { return dc(this, StatTileView, 'StatTile') }
}
