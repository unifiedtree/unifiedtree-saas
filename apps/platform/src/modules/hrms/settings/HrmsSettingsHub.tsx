// HRMS settings (/hrms/settings): the one settings place in HRMS. Every HR
// setting is listed here, grouped by what it's about, and shown only to people
// allowed to open it (shared/navigation/hrmsSettings.ts holds the list and the
// rules). Pages that are only settings open inside this hub, under its section
// tabs; the rest open on the page where they live (for example Shift Rules in
// Master data). Workspace settings (branding, billing, users) are not here:
// they open from the Apps page.
import { useNavigate } from 'react-router-dom'
import { HrButton } from '@/shared/components/hr'
import { ModulePage, State, Note, CARD, HEAD_FONT } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { hrmsSettingsFor, type HrmsSettingsItem } from '@/shared/navigation/hrmsSettings'
import { workspaceSettingsFor } from '@/shared/navigation/workspaceSettings'

const TONE: Record<string, [string, string, string]> = {
  company: ['#ecfdf5', '#d1fae5', '#0f6e56'], attendance: ['#eff6ff', '#dbeafe', '#2563eb'], leave: ['#f0fdfa', '#99f6e4', '#0f766e'],
  payroll: ['#f5f3ff', '#ddd6fe', '#7c3aed'], documents: ['#fff7ed', '#fed7aa', '#c2410c'], notifications: ['#fffbeb', '#fde68a', '#b45309'], access: ['#fff1f2', '#fecdd3', '#e11d48'],
}

function SettingCard({ item, tone, go }: { item: HrmsSettingsItem; tone: [string, string, string]; go: (to: string) => void }) {
  const [bg, border, fg] = tone
  return (
    <button type="button" onClick={() => go(item.path)} className="ut-report-card" data-setting={item.key}
      style={{ ...CARD, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, background: bg, border: `1px solid ${border}`, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{dashIcon(item.icon, 19)}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700 }}>{item.label}</span>
        <span aria-hidden="true" className="ut-report-go" style={{ color: '#94a3b8', display: 'inline-flex' }}>{dashIcon('arrowRight', 16)}</span>
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: '#475569' }}>{item.desc}</span>
      {item.lives && (
        <span style={{ marginTop: 'auto', alignSelf: 'flex-start', padding: '2px 8px', borderRadius: 999, background: '#f8fafc', border: '1px solid #eef2f6', fontSize: 11.5, fontWeight: 600, color: '#475569' }}>Opens in {item.lives}</span>
      )}
    </button>
  )
}

export function HrmsSettingsHub() {
  const navigate = useNavigate()
  const ctx = useAccessContext()
  const groups = hrmsSettingsFor(ctx)
  const workspace = workspaceSettingsFor(ctx).length > 0

  return (
    <ModulePage crumb="HRMS" title="HRMS settings" subtitle="Every HR setting in one place. Each opens only for the people allowed to change it.">
      {groups.length === 0 ? (
        <State kind="empty" icon="lock" title="No HR settings for your role" description="Ask an HR admin if something needs to change." />
      ) : (
        <div style={{ display: 'grid', gap: 28, minWidth: 0 }}>
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`hs-${g.key}`} style={{ display: 'grid', gap: 12, minWidth: 0 }}>
              <div>
                <h2 id={`hs-${g.key}`} style={{ margin: 0, fontFamily: HEAD_FONT, fontSize: 16, fontWeight: 700 }}>{g.title}</h2>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{g.desc}</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))', gap: 12 }}>
                {g.items.map((item) => <SettingCard key={item.key} item={item} tone={TONE[g.key] || TONE.company} go={(to) => navigate(to)} />)}
              </div>
            </section>
          ))}
          {workspace && (
            <Note>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
                <span style={{ flex: '1 1 260px' }}>Branding, billing, users, security and audit logs belong to the whole workspace. They open from the Apps page.</span>
                <HrButton size="sm" variant="ghost" onClick={() => navigate('/settings')}>Workspace settings</HrButton>
              </span>
            </Note>
          )}
        </div>
      )}
    </ModulePage>
  )
}
