// A page's own top-level bar of views (SHELL CONTRACT UPDATE, 1 Oct, DECISIONS 21).
//
//   import { HeaderTabs } from '@/design/shell/HeaderTabs'
//   <HeaderTabs label="Leave views" items={[{ key, label, count?, urgent? }]} active={view} onChange={setView} />
//
// The top bar now shows the open module's PAGES (ModuleTabs, drawn by the shell), so a page's own views no
// longer go up there: this bar renders where it stands, inside the page under the top bar, in the kit's
// lighter in-page pills (PillTabs), so the two levels never look alike. It used to portal into a header
// slot; the slot is gone and the name stays so existing callers keep working. New pages use ModuleKit
// Views or the kit PillTabs directly.
//
// Semantics stay as before:
//   'views' (default) role="group" aria-label={label} + buttons with aria-pressed (ModuleKit Views)
//   'tabs'            role="tablist" + role="tab" + aria-selected
// Counts and urgent counts stay, inside the button, so its accessible name reads as before.
import { PillTabs, type PillTab } from '@/design/kit/display'

export interface HeaderTabItem { key: string; label: string; count?: number; urgent?: boolean }

export interface HeaderTabsProps {
  /** Accessible name of the bar, e.g. "Leave views". */
  label: string
  items: HeaderTabItem[]
  active: string
  onChange: (key: string) => void
  semantics?: 'views' | 'tabs'
}

function countBadge(t: HeaderTabItem, on: boolean) {
  if (t.count == null || t.count === 0) return null
  return <span className={['ut-htab-n', on ? 'is-on' : t.urgent ? 'is-urgent' : ''].filter(Boolean).join(' ')}>{t.count}</span>
}

export function HeaderTabs({ label, items, active, onChange, semantics = 'views' }: HeaderTabsProps) {
  const pills: PillTab[] = items.map((t) => ({ key: t.key, label: <><span>{t.label}</span>{countBadge(t, t.key === active)}</> }))
  return (
    <PillTabs items={pills} activeKey={active} onSelect={(k) => onChange(k)} label={label}
      semantics={semantics === 'tabs' ? 'tabs' : 'toggle'} className="ut-htabs ut-htabs--inline" />
  )
}
