// HRMS Settings (owner, Q-06, 9 Oct 2026): one page that lists every HR setting as a card. Each card
// opens the page where that setting already lives (nothing moves: the client's 26 Sep rule); a card
// shows only when that page would open for this person. The list is shared/navigation/hrmsSettingsIndex.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CARD, ModulePage, Section, State } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { useVisibleEntries } from '@/shared/navigation/useAccess'
import { hrmsSettingsFor } from '@/shared/navigation/hrmsSettingsIndex'
import { usePageTitle } from '@/core/tenant/workspaceBranding'
import './HrmsSettingsIndex.css'

export function HrmsSettingsIndex() {
  usePageTitle('HRMS settings')
  const { ctx, entries } = useVisibleEntries()
  const groups = useMemo(() => {
    const open = new Map(entries.filter((e) => e.state === 'open').map((e) => [e.id, e.path]))
    return hrmsSettingsFor(open, ctx.has)
  }, [entries, ctx])

  return (
    <ModulePage crumb="HRMS" title="Settings"
      subtitle="Every HR setting in one place. Each one opens where it lives, so nothing has moved.">
      {groups.length === 0 ? (
        <State kind="empty" title="No settings for you here" description="Your role doesn’t include any HR settings. Ask your administrator if you need one." icon="settings" />
      ) : groups.map((g) => (
        <Section key={g.key} icon={g.icon} title={g.title}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
            {g.cards.map((c) => (
              <Link key={c.id} to={c.path} className="uhs-card" data-setting={c.id}
                style={{ ...CARD, display: 'flex', gap: 12, alignItems: 'flex-start', padding: 16, borderRadius: 14, textDecoration: 'none', color: 'inherit' }}>
                <span aria-hidden style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, background: 'var(--u-brs,#E7F3EE)', color: 'var(--u-br,#0F6E56)' }}>
                  {dashIcon(c.icon, 18)}
                </span>
                <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                  <span style={{ fontWeight: 650, fontSize: 14.5, color: 'var(--u-ink,#0E1B16)' }}>{c.label}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--u-ink3,#6A7A73)' }}>{c.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </Section>
      ))}
    </ModulePage>
  )
}
