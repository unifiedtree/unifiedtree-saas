// Ported from the design component SubTabs.dc.html.
//
// A page's own views (ModuleKit Views): the kit's lighter in-page pills, where the bar stands, under the
// top bar. The top bar shows the open module's PAGES (the shell's ModuleTabs), so a page's views never
// go up there (SHELL CONTRACT UPDATE, DECISIONS 21). `placement` is kept for the callers that pass it;
// 'header' and 'inline' both render here, in the page.
import { DCLogic, dc } from './dc-runtime'
import { SubTabsView } from './SubTabs.view'

export type SubTabsPlacement = 'header' | 'inline'

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
  render() {
    return dc(this, SubTabsView, 'SubTabs')
  }
}
