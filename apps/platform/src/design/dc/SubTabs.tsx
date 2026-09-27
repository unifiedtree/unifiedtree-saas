// Ported from the design component SubTabs.dc.html.
//
// placement (SHELL CONTRACT 1): 'inline' (the default) is today's bar, where it stands. 'header' puts a
// page's TOP-LEVEL bar into the shell's top bar as HeaderTabs (the same role="group" + aria-pressed
// buttons, the same counts); outside the shell, or when the top bar already holds a bar, it renders in
// place. The header pills show the label and count only (the design's header tabs have no icon or tooltip).
import { createElement as h } from 'react'
import { HeaderTabs, type HeaderTabItem } from '@/design/shell/HeaderTabs'
import { DCLogic, dc } from './dc-runtime'
import { SubTabsView } from './SubTabs.view'

export type SubTabsPlacement = 'header' | 'inline'

/** The HeaderTabs props for a SubTabs bar (items carry their own active flag and onClick). */
export function subTabsHeaderProps(props: { items?: any[]; label?: string }) {
  const src: any[] = props.items || []
  const items: HeaderTabItem[] = src.map((it) => ({
    key: String(it.key), label: it.label,
    // Same rule as the inline bar: an empty count shows none. (HeaderTabs also hides a 0.)
    count: it.count === undefined || it.count === null || it.count === '' ? undefined : it.count,
    urgent: !!it.urgent,
  }))
  const active = src.find((it) => it.active)
  return {
    label: props.label || 'Views',
    items,
    active: active ? String(active.key) : '',
    onChange: (key: string) => src.find((it) => String(it.key) === key)?.onClick?.(),
  }
}

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
    if (this.props.placement === 'header') return h(HeaderTabs, subTabsHeaderProps(this.props))
    return dc(this, SubTabsView, 'SubTabs')
  }
}
