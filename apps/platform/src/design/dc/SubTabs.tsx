// Ported from the design component SubTabs.dc.html.
import { DCLogic, dc } from './dc-runtime'
import { SubTabsView } from './SubTabs.view'

export class SubTabs extends DCLogic {
  renderVals() {
    const src: any[] = this.props.items || []
    const items = src.map((it) => {
      const has = it.count !== undefined && it.count !== null && it.count !== ''
      return {
        key: it.key, label: it.label, icon: it.icon || null, count: it.count, tip: it.tip || '', onClick: it.onClick || (() => {}),
        active: !!it.active, inactive: !it.active, hasCount: has, plainCount: has && !it.urgent, urgentCount: has && !!it.urgent,
      }
    })
    return { items, label: this.props.label || 'Views' }
  }
  render() { return dc(this, SubTabsView, 'SubTabs') }
}
