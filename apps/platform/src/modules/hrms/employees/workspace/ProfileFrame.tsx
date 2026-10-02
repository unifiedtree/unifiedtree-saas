// The profile page frame (prototype PgProfile): the banner, the left profile card
// (avatar, name, status, role line, the field rows, the actions) and the right card
// with the in-card underline tabs. Used by the HR view of an employee
// (/hrms/employees/:id) and by My profile (/profile). It only lays out what it is
// given: every value comes from the page, from the API.
//
// The tabs are a real ARIA tablist (role=tab + aria-selected, arrow keys move), as
// today's tabs are; the design draws plain buttons.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Avatar, StatusPill, type StatusTone } from '@/design/kit/display'
import banner from './profile-banner.png'
import './profile.css'

const ICONS = {
  code: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  pin: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cal: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
} as const
export type ProfileIcon = keyof typeof ICONS

export function ProfileGlyph({ icon, size = 15 }: { icon: ProfileIcon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[icon]} />
    </svg>
  )
}

export interface ProfileField {
  key: string
  label: string
  icon: ProfileIcon
  /** Read-only value; "—" when empty. */
  value?: ReactNode
  /** A green tick after the value (the sign-in email of an activated account). */
  verified?: boolean
  verifiedLabel?: string
  /** Makes the row an input the person can change (My profile: only what they may edit today). */
  edit?: { value: string; onChange: (v: string) => void; placeholder?: string; error?: string; maxLength?: number; inputMode?: 'text' | 'tel' }
}

export interface ProfileTab { key: string; label: string; badge?: number }

export interface ProfileFrameProps {
  /** "← Workforce directory" (HR view only). */
  back?: { label: string; onClick: () => void }
  avatar: { name: string; src?: string | null; checkedIn?: boolean; overlay?: ReactNode }
  name: string
  status?: { label: string; tone: StatusTone } | null
  roleLine: string
  email?: string
  fields: ProfileField[]
  /** Under the fields: the HR actions, or My profile's Update button. */
  footer?: ReactNode
  tabs: ProfileTab[]
  active: string
  onTab: (key: string) => void
  /** "Employee profile" / "My profile": the page's accessible name. */
  screenLabel: string
  children: ReactNode
}

export function ProfileFrame({ back, avatar, name, status, roleLine, email, fields, footer, tabs, active, onTab, screenLabel, children }: ProfileFrameProps) {
  const uid = useId()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const stripRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })
  // When the tabs don't fit, the strip scrolls sideways: keep the open tab in view and fade the
  // edge that has more tabs behind it.
  const measure = () => {
    const el = stripRef.current
    if (!el) return
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
  }
  useEffect(() => {
    const el = stripRef.current, tab = tabRefs.current[active]
    if (el && tab) {
      const l = tab.offsetLeft - el.offsetLeft, r = l + tab.offsetWidth
      if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 24)
      else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 24
    }
    measure()
  }, [active, tabs.length])
  useEffect(() => {
    const el = stripRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabs.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to < 0) return
    e.preventDefault()
    const k = tabs[to].key
    onTab(k)
    tabRefs.current[k]?.focus()
  }
  return (
    <div className="upf" data-screen-label={screenLabel} aria-label={screenLabel} role="region">
      <div className="upf-banner" aria-hidden="true" style={{ backgroundImage: `url(${banner})` }}><span className="upf-banner__fade" /></div>
      <div className="upf-body">
        <aside className="upf-card upf-left" aria-label="Profile">
          {back && (
            <button type="button" className="upf-back" onClick={back.onClick}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
              {back.label}
            </button>
          )}
          <div className="upf-who">
            <span className="upf-av">
              <Avatar name={avatar.name} src={avatar.src} size={76} tone="solid" ring="brand" weight={500}
                status={avatar.checkedIn ? 'in' : null} statusLabel={avatar.checkedIn ? 'Checked in' : undefined} />
              {avatar.overlay}
            </span>
            <div className="upf-who__text">
              <div className="upf-who__row">
                <h1 className="upf-name">{name}</h1>
                {status && <StatusPill tone={status.tone} size="md" dot>{status.label}</StatusPill>}
              </div>
              {roleLine && <div className="upf-role">{roleLine}</div>}
              {email && <div className="upf-email" title={email}>{email}</div>}
            </div>
          </div>
          <div className="upf-rule" />
          <div className="upf-fields">
            {fields.map((f) => <FieldRow key={f.key} f={f} />)}
          </div>
          {footer}
        </aside>
        <section className="upf-card upf-right" aria-label="Details">
          <div className="upf-tabs-wrap" data-more-left={more.left || undefined} data-more-right={more.right || undefined}>
          <div ref={stripRef} role="tablist" aria-label="Profile sections" className="upf-tabs" onScroll={measure}>
            {tabs.map((t, i) => {
              const on = t.key === active
              return (
                <button key={t.key} ref={(el) => { tabRefs.current[t.key] = el }} type="button" role="tab" id={`${uid}-tab-${t.key}`}
                  aria-selected={on} aria-controls={`${uid}-panel`} tabIndex={on ? 0 : -1}
                  className="upf-tab" data-on={on || undefined} onClick={() => onTab(t.key)} onKeyDown={(e) => onKey(e, i)}>
                  {t.label}{t.badge ? <span className="upf-tab__badge">{t.badge}</span> : null}
                </button>
              )
            })}
          </div>
          </div>
          <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${active}`} className="upf-panel">{children}</div>
        </section>
      </div>
    </div>
  )
}

function FieldRow({ f }: { f: ProfileField }) {
  const id = useId()
  const v = f.value == null || f.value === '' ? '—' : f.value
  return (
    <div className="upf-field">
      <label className="upf-field__k" htmlFor={f.edit ? id : undefined}>{f.edit ? f.label : <span>{f.label}</span>}</label>
      <span className="upf-field__box" data-edit={f.edit ? '' : undefined} data-invalid={f.edit?.error ? '' : undefined}>
        <span className="upf-field__ic"><ProfileGlyph icon={f.icon} /></span>
        {f.edit ? (
          <input id={id} type="text" className="upf-field__input" value={f.edit.value} placeholder={f.edit.placeholder}
            maxLength={f.edit.maxLength} inputMode={f.edit.inputMode === 'tel' ? 'tel' : undefined}
            aria-invalid={f.edit.error ? true : undefined} aria-describedby={f.edit.error ? `${id}-err` : undefined}
            onChange={(e) => f.edit!.onChange(e.target.value)} />
        ) : (
          <span className="upf-field__v" title={typeof v === 'string' ? v : undefined}>{v}</span>
        )}
        {f.verified && (
          <svg className="upf-field__ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={f.verifiedLabel || 'Verified'}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" />
          </svg>
        )}
      </span>
      {f.edit?.error && <span id={`${id}-err`} role="alert" className="upf-field__err">{f.edit.error}</span>}
    </div>
  )
}
