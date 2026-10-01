// The Overview tab of the HR view (prototype PgProfile, tab 0): the four "at a glance" figures,
// Employment, Needs attention, the month's attendance, the Account card and (kept from today) the
// onboarding record. Every figure comes from the page's queries; a block the viewer can't read says so.
import type { ReactNode } from 'react'
import {
  Button, CalendarLegend, KeyValueGrid, ListRow, ListRows, MonthCalendar, Section, StatCard, StatusPill,
  type CalendarDay, type StatTone,
} from '@/design/kit/display'
import { MONTH_NAMES } from './profileFormat'

export interface Glance { label: string; value: string | null; note: string; icon: string; tone: StatTone; loading?: boolean; onClick: () => void }
export interface Attention { tone: 'amber' | 'red' | 'ok'; title: string; sub?: string; cta?: { label: string; onClick: () => void }; actions?: ReactNode }

export const CAL_LEGEND = [
  { tone: 'present' as const, label: 'Present' }, { tone: 'late' as const, label: 'Late' }, { tone: 'absent' as const, label: 'Absent' },
  { tone: 'leave' as const, label: 'On leave' }, { tone: 'home' as const, label: 'Work from home' }, { tone: 'fix' as const, label: 'No punch-out' },
  { tone: 'off' as const, label: 'Week off' },
]

export function GlanceRow({ items }: { items: Glance[] }) {
  return (
    <section aria-label="At a glance" className="upf-glance">
      {items.map((g, i) => (
        <StatCard key={g.label} variant="stat" index={i} label={g.label} value={g.value} note={g.note} icon={g.icon} tone={g.tone} loading={g.loading} onClick={g.onClick} />
      ))}
    </section>
  )
}

export function AttentionList({ items }: { items: Attention[] }) {
  return (
    <div className="upf-attn">
      {items.map((a, i) => (
        <div key={i} className="upf-attn__row">
          <span className="upf-attn__dot" data-tone={a.tone} aria-hidden="true" />
          <div className="upf-attn__t">
            <div className="upf-attn__title">{a.title}</div>
            {a.sub && <div className="upf-attn__sub">{a.sub}</div>}
          </div>
          {(a.actions || a.cta) && (
            <span className="upf-attn__acts">
              {a.actions}
              {a.cta && <Button size={30} variant="ghost" trailingIcon="arrowRight" onClick={a.cta.onClick}>{a.cta.label}</Button>}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** The month's attendance as the Overview's small calendar, with "Attendance" opening the tab. */
export function MonthCard({ ym, days, loading, error, onRetry, onOpen, noAccess }: {
  ym: string; days: CalendarDay[]; loading: boolean; error: unknown; onRetry: () => void; onOpen: () => void; noAccess?: boolean
}) {
  const m = Number(ym.slice(5, 7)), y = Number(ym.slice(0, 4))
  const forbidden = (error as { status?: number } | null)?.status === 403
  return (
    <Section title={MONTH_NAMES[m - 1]} sub={String(y)} variant="section"
      actions={<Button size={30} variant="ghost" onClick={onOpen}>Attendance</Button>}
      loading={loading} error={forbidden || noAccess ? undefined : error} onRetry={onRetry} skeleton="chart"
      empty={forbidden || noAccess ? { title: 'You can’t see this person’s attendance', hint: 'Their manager, HR and attendance admins can.' } : undefined}>
      <MonthCalendar month={ym} days={days} variant="compact" label={`${MONTH_NAMES[m - 1]} ${y} attendance`} />
      <CalendarLegend items={CAL_LEGEND.slice(0, 5)} />
    </Section>
  )
}

export interface AccountView {
  active: boolean
  title: string
  sub: string
  lastSignIn: string
  face: string | null
  faceActions?: ReactNode
  invite?: { label: string; primary: boolean; busy: boolean; onClick: () => void } | null
  resetNote?: boolean
}

export function AccountCard({ a }: { a: AccountView }) {
  return (
    <Section title="Account" variant="section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={a.active ? 'upf-banner-ok' : 'upf-banner-warn'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {a.active ? <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" /> : <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />}
          </svg>
          {a.title}
        </div>
        {a.sub && <p className="upf-note">{a.sub}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="upf-kvline"><span>Last sign-in</span><span>{a.lastSignIn}</span></div>
          {a.face != null && <div className="upf-kvline"><span>Face check-in</span><span>{a.face}</span></div>}
        </div>
        {a.resetNote && (
          <p className="upf-note">
            Resetting deletes the stored face templates and clears any verification lockout. Face punch-in stops working until they enrol again — from the mobile app, or with Enroll face here.
          </p>
        )}
        {(a.invite || a.faceActions) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {a.invite && <Button size={36} variant={a.invite.primary ? 'primary' : 'secondary'} icon="mail" loading={a.invite.busy} onClick={a.invite.onClick}>{a.invite.label}</Button>}
            {a.faceActions}
          </div>
        )}
      </div>
    </Section>
  )
}

export interface OnboardingView {
  sub: string; note: string
  fields: { l: string; v: string }[]
  assets: { id: string; type: string; model: string; serial: string; on: string }[]
  policies: string[]
  checklists: { title: string; rows: { l: string; s: string; t: 'ok' | 'warn' | 'red' }[] }[]
}

const CHECK_TONE = { ok: 'brand', warn: 'warning', red: 'danger' } as const

export function OnboardingCard({ o }: { o: OnboardingView }) {
  return (
    <Section title="Onboarding record" sub={o.sub} variant="section">
      {o.note ? <p className="upf-note">{o.note}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {o.fields.length > 0 && <KeyValueGrid items={o.fields.map((f) => ({ label: f.l, value: f.v }))} />}
          {o.assets.length > 0 && (
            <div>
              <div className="upf-attn__sub" style={{ marginBottom: 6 }}>Assets issued</div>
              <ListRows label="Assets issued">
                {o.assets.map((a) => <ListRow key={a.id} variant="divided" density="compact" title={`${a.type}${a.model ? ` · ${a.model}` : ''}`} sub={a.serial ? `Serial ${a.serial}` : undefined} end={a.on} />)}
              </ListRows>
            </div>
          )}
          {o.policies.length > 0 && (
            <div>
              <div className="upf-attn__sub" style={{ marginBottom: 6 }}>Policies shared</div>
              <div className="upf-chips">{o.policies.map((p) => <StatusPill key={p} tone="mint">{p}</StatusPill>)}</div>
            </div>
          )}
          {o.checklists.map((c) => (
            <div key={c.title}>
              <div className="upf-attn__sub" style={{ marginBottom: 6 }}>{c.title}</div>
              <ListRows label={c.title}>
                {c.rows.map((r) => <ListRow key={r.l} variant="divided" density="compact" title={r.l} end={<StatusPill tone={CHECK_TONE[r.t]}>{r.s}</StatusPill>} />)}
              </ListRows>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

export function EmploymentCard({ items, onEdit }: { items: { label: string; value: ReactNode }[]; onEdit?: () => void }) {
  return (
    <Section title="Employment" variant="section" actions={onEdit ? <Button size={30} variant="ghost" onClick={onEdit}>Edit</Button> : undefined}>
      <KeyValueGrid items={items} />
    </Section>
  )
}
