// The More panel (UtMore.dc.html): 320px, full height, square edges, opening right of the rail over a
// blurred backdrop (a sibling element, never a filter on the panel). A profile card, My space, the
// modules that didn't fit the rail (by rail group), Settings (Preferences, Help & support), the
// Light/Dark switch and Sign out. The header's gear and profile menu live here now.
// The same content (MoreContent) sits under the rail in the phone drawer.
import { useId, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@/design/kit/display'
import { useEscape, useFocusTrap, useLayer } from '@/design/kit/overlayCore'
import { useTheme } from '@/design/theme'
import { apiJson } from '@/core/api/client'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { useWorkspaceBranding } from '@/core/tenant/workspaceBranding'
import { ShellIcon } from './shellIcons'

export interface MoreRow {
  key: string
  label: string
  icon: string
  /** A page: a real link (open in a new tab works); a plain click calls onClick. */
  href?: string
  onClick: () => void
  /** The module the page on screen belongs to. */
  active?: boolean
}

export interface MoreSection { key: string; label: string; rows: MoreRow[] }

export interface MoreContentProps {
  sections: MoreSection[]
  /** The person's role, shown when their employee record has no job title. */
  roleLabel: string | null
  onProfile: () => void
  onSignOut: () => void
  /** The card's "View my profile" link. */
  profileHref: string
}

/** The fields of GET /v1/employees/me the card reads (the same query key as My profile). */
interface MyEmployee { jobTitle?: string | null }

function inApp(e: MouseEvent, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go()
}

function ProfileCard({ roleLabel, onProfile, profileHref }: Pick<MoreContentProps, 'roleLabel' | 'onProfile' | 'profileHref'>) {
  // Both requests only run while More is open, and share their cache with My profile.
  const user = useCurrentUser()
  const employee = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: () => apiJson<MyEmployee>('/v1/employees/me'),
    enabled: !!user.data?.employeeId,
    staleTime: 60_000,
  })
  const { fullName, initials } = useDisplayName()
  const { workspaceName } = useWorkspaceBranding()
  const title = employee.data?.jobTitle?.trim() || roleLabel
  const company = workspaceName || user.data?.companyName || null
  return (
    <div className="ut-more__card">
      <a href={profileHref} className="ut-more__who" onClick={(e) => inApp(e, onProfile)}>
        <Avatar name={fullName} initials={initials} src={user.data?.avatarUrl} size={54} tone="solid" status="online" statusLabel="Online" ring="surface" />
        <span className="ut-more__whotext">
          <span className="ut-more__name">{fullName}</span>
          {title && <span className="ut-more__role">{title}</span>}
          {company && <span className="ut-more__company">{company}</span>}
        </span>
        <ShellIcon name="chevronRight" size={18} strokeWidth={2} />
      </a>
      <a href={profileHref} className="ut-more__view" onClick={(e) => inApp(e, onProfile)}>
        <ShellIcon name="user" size={17} />
        <span>View my profile</span>
        <ShellIcon name="chevronRight" size={16} strokeWidth={2} />
      </a>
    </div>
  )
}

/** Light / Dark (a radio group: one tab stop, arrows switch). */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const options = [{ v: 'light' as const, label: 'Light', icon: 'sun' }, { v: 'dark' as const, label: 'Dark', icon: 'moon' }]
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    requestAnimationFrame(() => (e.currentTarget.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus())
  }
  return (
    <div role="radiogroup" aria-label="Theme" className="ut-theme" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={theme === o.v} tabIndex={theme === o.v ? 0 : -1} data-value={o.v}
          className="ut-theme__opt" data-on={theme === o.v ? '' : undefined} onClick={() => setTheme(o.v)}>
          <ShellIcon name={o.icon} size={16} strokeWidth={2} />{o.label}
        </button>
      ))}
    </div>
  )
}

export function MoreSections({ sections }: { sections: MoreSection[] }) {
  return (
    <div className="ut-more__sections">
      {sections.map((g, i) => (
        <div key={g.key} role="group" aria-label={g.label} className="ut-more__sec">
          {i > 0 && <div className="ut-more__rule" aria-hidden="true" />}
          <div className="ut-more__seclabel" aria-hidden="true">{g.label}</div>
          {g.rows.map((r) => {
            const inner = (
              <>
                <ShellIcon name={r.icon} size={20} strokeWidth={1.8} />
                <span className="ut-more__rowlabel">{r.label}</span>
                <ShellIcon name="chevronRight" size={16} strokeWidth={2} className="ut-more__rowchev" />
              </>
            )
            return r.href ? (
              <a key={r.key} href={r.href} className="ut-more__row" data-active={r.active ? '' : undefined} aria-current={r.active ? 'page' : undefined}
                onClick={(e) => inApp(e, r.onClick)}>{inner}</a>
            ) : (
              <button key={r.key} type="button" className="ut-more__row" onClick={r.onClick}>{inner}</button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Profile card, sections and the footer; shared by the More panel and the phone drawer. */
export function MoreContent({ sections, roleLabel, onProfile, onSignOut, profileHref }: MoreContentProps) {
  return (
    <>
      <div className="ut-more__body">
        <ProfileCard roleLabel={roleLabel} onProfile={onProfile} profileHref={profileHref} />
        <MoreSections sections={sections} />
      </div>
      <div className="ut-more__foot">
        <ThemeSwitch />
        <button type="button" className="ut-more__signout" onClick={onSignOut}>
          <ShellIcon name="logOut" size={18} strokeWidth={2} />Sign out
        </button>
      </div>
    </>
  )
}

export interface MorePanelProps extends MoreContentProps {
  onClose: () => void
}

/** Mount it only while More is open. */
export function MorePanel({ onClose, ...content }: MorePanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const isTop = useLayer(true)
  useEscape(true, isTop, onClose)
  useFocusTrap(ref, true, isTop, 'container')
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="ut-more">
      <div className="ut-more__head">
        <div className="ut-more__headtext">
          <h2 id={titleId} className="ut-more__title">More</h2>
          <p className="ut-more__sub">Quick access &amp; settings</p>
        </div>
        <button type="button" className="ut-more__close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <ShellIcon name="x" size={20} strokeWidth={2} />
        </button>
      </div>
      <MoreContent {...content} />
    </div>
  )
}
