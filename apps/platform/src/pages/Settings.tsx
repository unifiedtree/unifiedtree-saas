// Workspace Settings (/settings/:tab) in the Payroll Settings design's settings
// pattern (design/settings/SettingsKit). The settings *navigation* lives in the
// app shell; this page renders the tab named in the URL as section cards with
// the design's "On this page" list. What isn't built yet is shown as "Coming
// soon" rather than as controls that pretend to work (notes on each tab below).
import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Image as ImageIcon, Upload } from 'lucide-react'
import { getAccessToken } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'
import { apiJson, API_BASE_URL } from '@/core/api/client'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { SettingsPage, SettingsSection, SettingsGrid, SettingsValue, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
import { DocumentTypesTab } from './SettingsDocumentTypes'
import { NotificationChoiceSections, useNotificationChoices, type NotificationChoicesState } from './NotificationChoices'

type TabKey = 'profile' | 'branding' | 'security' | 'notifications' | 'billing' | 'integrations' | 'documents' | 'danger'
type Show = (kind: 'ok' | 'error', title: string, msg?: string) => void

const TAB_META: Record<TabKey, { label: string; desc: string }> = {
  profile:       { label: 'Profile',        desc: 'Your account and organization details.' },
  branding:      { label: 'Branding',       desc: 'Your logo and workspace identity.' },
  security:      { label: 'Security',       desc: 'Password, two-factor and active sessions.' },
  notifications: { label: 'Notifications',  desc: 'Which notifications reach you, and how: email, in the app or on your phone.' },
  billing:       { label: 'Billing & Plan', desc: 'Your subscription, plan and invoices.' },
  integrations:  { label: 'Integrations',   desc: 'Connect external tools and services.' },
  documents:     { label: 'Document Types', desc: 'Which documents employees must upload, and the rules for each.' },
  danger:        { label: 'Danger Zone',    desc: 'Irreversible, workspace-wide actions.' },
}
const VALID_TABS = Object.keys(TAB_META) as TabKey[]

/**
 * Integrations roadmap. None of these are built yet. This tab once rendered a
 * "Connect" button that only flipped local state, with Slack, Zapier and
 * Stripe pre-marked "Connected". The list is the real roadmap, so it stays,
 * shown as coming soon with no control that pretends to do something.
 */
const INTEGRATIONS = [
  { key: 'slack', name: 'Slack', desc: 'Send notifications to Slack channels.', icon: 'megaphone' },
  { key: 'github', name: 'GitHub', desc: 'Link commits and pull requests to projects.', icon: 'workflow' },
  { key: 'jira', name: 'Jira', desc: 'Sync issues with Jira boards.', icon: 'clipboard' },
  { key: 'zapier', name: 'Zapier', desc: 'Automate with thousands of apps through Zapier.', icon: 'activity' },
  { key: 'stripe', name: 'Stripe', desc: 'Take payments through Stripe.', icon: 'creditCard' },
  { key: 'salesforce', name: 'Salesforce', desc: 'Sync CRM data with Salesforce.', icon: 'globe' },
]

/** The "On this page" list for each tab (sections are fixed per tab). */
const NAV: Record<TabKey, SettingsNavItem[]> = {
  profile: [{ key: 'account', label: 'Your account', state: 'none' }, { key: 'org', label: 'Organisation', state: 'none' }],
  branding: [{ key: 'logo', label: 'Workspace logo', state: 'none' }],
  security: [{ key: 'password', label: 'Password', state: 'on' }, { key: 'twofa', label: 'Two-factor', state: 'soon' }, { key: 'sessions', label: 'Active sessions', state: 'soon' }],
  notifications: [{ key: 'today', label: 'What reaches you', state: 'none' }, { key: 'email', label: 'Email choices', state: 'on' }, { key: 'inapp', label: 'In-app choices', state: 'on' }, { key: 'push', label: 'Phone push choices', state: 'on' }],
  billing: [{ key: 'plan', label: 'Your plan', state: 'none' }, { key: 'invoices', label: 'Invoices', state: 'soon' }],
  integrations: INTEGRATIONS.map((i) => ({ key: i.key, label: i.name, state: 'soon' as const })),
  documents: [{ key: 'types', label: 'Document types', state: 'none' }],
  danger: [{ key: 'export', label: 'Export all data', state: 'none' }, { key: 'reset', label: 'Reset workspace', state: 'none' }, { key: 'delete', label: 'Delete organisation', state: 'none' }],
}

const ProfileTab: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  return (
    <>
      <SettingsSection id="account" icon="userCheck" title="Your account" summary={[`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(), user?.email].filter(Boolean).join(' · ')}>
        <SettingsGrid min={220}>
          <SettingsValue label="First name" value={user?.firstName || '—'} />
          <SettingsValue label="Last name" value={user?.lastName || '—'} />
          <SettingsValue label="Email address" value={user?.email || '—'} />
          <SettingsValue label="Role" value={user?.role || '—'} />
        </SettingsGrid>
      </SettingsSection>
      {/* Industry isn't stored anywhere on the backend, so it isn't shown. */}
      <SettingsSection id="org" icon="building" title="Organisation" summary={[tenant?.name, tenant?.subdomain].filter(Boolean).join(' · ')}>
        <SettingsGrid min={220}>
          <SettingsValue label="Company name" value={tenant?.name || '—'} />
          <SettingsValue label="Subdomain" value={tenant?.subdomain || '—'} />
          <SettingsValue label="Plan" value={tenant?.planType || '—'} />
        </SettingsGrid>
        {/* No Save: no endpoint updates an account or a workspace profile
            (TenantController exposes no update mapping). A "Saved!" tick over
            a save that didn't happen is worse than no button. */}
        <SettingsNote>These details are read-only for now. To change your name or company details, email <a href="mailto:unifiedtree@gmail.com" style={{ color: '#047857', fontWeight: 600 }}>unifiedtree@gmail.com</a>. Your own display name and phone are on <Link to="/profile" style={{ color: '#047857', fontWeight: 600 }}>your profile</Link>.</SettingsNote>
      </SettingsSection>
    </>
  )
}

/**
 * Human sentences for the HTTP status codes a logo upload / GET can return.
 * Users should never see "HTTP 401". Anything not mapped falls back to a
 * generic "please try again".
 */
function humanErrorFor(status: number, body?: string): { title: string; description: string } {
  const serverMessage = (() => {
    if (!body) return ''
    try { return (JSON.parse(body) as { message?: string }).message ?? '' } catch { return '' }
  })()
  switch (status) {
    case 0: return { title: 'Could not reach the server', description: 'Check your internet connection and try again.' }
    case 401: return { title: 'Your session has expired', description: 'Please sign in again to change the logo.' }
    case 402: return { title: 'Your subscription has ended', description: 'You can view branding, but to change it please renew your subscription from Manage plan.' }
    case 403: return { title: 'You don’t have permission for this', description: 'Only workspace admins can change the logo. Ask your admin to update it.' }
    case 413: return { title: 'That image is too large', description: 'Pick a file 2 MB or smaller.' }
    case 415: return { title: 'That file type isn’t supported', description: serverMessage || 'Upload a PNG, JPEG, GIF, WebP or AVIF image.' }
    case 429: return { title: 'Too many uploads in a row', description: 'Please wait a minute and try again.' }
    default:
      if (status >= 500) return { title: 'Something went wrong on our end', description: 'We’re on it. Please try again in a minute.' }
      return { title: 'Upload failed', description: serverMessage || 'Please try again. If it keeps failing, contact your admin.' }
  }
}

/**
 * Branding: the workspace admin uploads their company logo. It replaces the
 * default logo on the sign-in page (via workspace-status) and in the app
 * header (via tenant.logoUrl). The server allows PNG / JPEG / WebP / GIF /
 * AVIF up to 2 MB, sniffs magic bytes and blocks SVG; `accept` is only a hint.
 */
const BrandingTab: React.FC<{ show: Show }> = ({ show }) => {
  // Never read `token` off the zustand store: it's set once at login and goes
  // stale when the SDK rotates it. getAccessToken() is what apiJson uses.
  const tenant = useAuthStore((s) => s.tenant)
  const refreshTenant = useAuthStore((s) => s.refreshTenant)
  const [logoUrl, setLogoUrl] = useState<string | null>(tenant?.logoUrl ?? null)
  const [uploading, setUploading] = useState(false)
  // GET /branding answering 402/403 disables Upload with the reason.
  const [loadBlocked, setLoadBlocked] = useState<{ status: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setLogoUrl(tenant?.logoUrl ?? null) }, [tenant?.logoUrl])
  // Fresh URL from the server rather than an up-to-an-hour-old store copy.
  useEffect(() => {
    let cancelled = false
    apiJson<{ logoUrl: string | null }>('/v1/workspace/branding')
      .then((res) => { if (!cancelled) setLogoUrl(res.logoUrl ?? null) })
      .catch((err) => {
        if (cancelled) return
        const status = (err as { status?: number })?.status ?? 0
        if (status === 402 || status === 403) setLoadBlocked({ status })
      })
    return () => { cancelled = true }
  }, [])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { const m = humanErrorFor(413); show('error', m.title, m.description); return }
    setUploading(true)
    try {
      // fetch, not apiJson: this travels as multipart/form-data. Token read at
      // request time; credentials so the refresh cookie rides cross-origin.
      const form = new FormData()
      form.append('file', file)
      let resp: Response
      try {
        const bearer = getAccessToken()
        resp = await fetch(`${API_BASE_URL}/v1/workspace/branding/logo`, { method: 'POST', credentials: 'include', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: form })
      } catch { const m = humanErrorFor(0); show('error', m.title, m.description); return }
      if (!resp.ok) { const body = await resp.text().catch(() => ''); const m = humanErrorFor(resp.status, body); show('error', m.title, m.description); return }
      const res = await resp.json() as { logoUrl: string | null }
      setLogoUrl(res.logoUrl ?? null)
      try { await refreshTenant() } catch { /* best-effort: the header swaps on next load */ }
      show('ok', 'Logo updated', 'Other open browsers may need a refresh to show it.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  const blocked = loadBlocked ? humanErrorFor(loadBlocked.status) : null

  return (
    <SettingsSection id="logo" icon="building" title="Workspace logo" summary={logoUrl ? 'Custom logo set · shown on the sign-in page and in the app header' : 'No custom logo yet · the UnifiedTree logo is shown'}>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {blocked && <SettingsNote tone="amber"><strong>{blocked.title}.</strong> {blocked.description}</SettingsNote>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <div style={{ flex: '0 0 auto', width: 96, height: 96, borderRadius: 14, border: '1px dashed #cbd5e1', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {logoUrl
            ? <img src={logoUrl} alt="Current workspace logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 8 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            : <ImageIcon size={28} className="text-slate-400" />}
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 10 }}>
          <span style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>PNG, JPEG, GIF, WebP or AVIF, up to 2 MB. Wide logos work best; the header shows it 28 px tall.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <HrButton onClick={() => inputRef.current?.click()} disabled={uploading || !!loadBlocked}>
              <Upload size={14} className="mr-1.5" />{uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            </HrButton>
            {logoUrl && <HrButton variant="ghost" onClick={() => window.open(logoUrl, '_blank', 'noopener')}>Open image</HrButton>}
          </div>
        </div>
      </div>
      <SettingsNote>The logo’s address is public so browsers can show it on the sign-in page without signing in. Don’t put anything private in it.</SettingsNote>
    </SettingsSection>
  )
}

/**
 * Security. What was here before and why none of it survives: an "Active
 * Sessions" list of two hard-coded devices with a Revoke button that did
 * nothing (no session endpoint exists); a 2FA toggle on local state (no
 * enrolment service exists); and a change-password form whose inputs were
 * never read. Password change now uses the real forgot-password email; 2FA
 * and sessions are shown as coming soon.
 */
const SecurityTab: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const sendReset = async () => {
    if (!user?.email) return
    setSending(true)
    try {
      await apiJson('/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: user.email }) })
    } catch {
      // Deliberately soft: forgot-password never says whether an address exists.
    } finally { setSent(true); setSending(false) }
  }
  return (
    <>
      <SettingsSection id="password" icon="lock" title="Password" summary={`We email a secure reset link to ${user?.email ?? 'your address'}. It expires shortly after it’s sent.`}>
        {sent
          ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1px solid #6ee7b7', background: '#ecfdf5', color: '#047857', fontSize: 13.5, fontWeight: 600 }}><Check size={15} className="shrink-0" />Reset link sent. Check your inbox (and spam folder).</div>
          : <div><HrButton onClick={sendReset} disabled={sending || !user?.email}>{sending ? 'Sending…' : 'Email me a password reset link'}</HrButton></div>}
      </SettingsSection>
      <SettingsSection id="twofa" icon="shield" title="Two-factor authentication" summary="Protect your account with a one-time code from Google Authenticator or a similar app." soon />
      <SettingsSection id="sessions" icon="smartphone" title="Active sessions" summary="See where your account is signed in and sign out other devices." soon />
    </>
  )
}

/**
 * Notifications: the signed-in person's own choices, per event and channel
 * (GET/PUT /v1/me/notification-preferences). Every sender checks them; the
 * always-sent ones (security, access, billing, letters HR sends) are shown
 * locked on. Saved through the page's unsaved-changes bar.
 */
const NotificationsTab: React.FC<{ c: NotificationChoicesState }> = ({ c }) => {
  const user = useAuthStore((s) => s.user)
  return (
    <>
      <SettingsSection id="today" icon="bell" title="What reaches you" summary="Requests waiting for you and decisions on your own requests, in the app and on your phone.">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13.5, color: '#334155', lineHeight: 1.5 }}>
          <li>In the app and on your phone: leave, work-from-home, attendance, shift, expense, advance and document requests waiting for you, and decisions on your own requests</li>
          <li>By email: reminders such as probation ending, plus any event you switch on below</li>
          <li>Always: password reset and invitation emails, billing alerts for admins, and letters HR sends you</li>
        </ul>
        <SettingsNote>Changes apply to the next notification. The same email and push switches are on <Link to="/profile#st-notifications" style={{ color: '#047857', fontWeight: 600 }}>your profile</Link>. The wording comes from the workspace’s notification templates.</SettingsNote>
      </SettingsSection>
      {c.status === 'live' && <NotificationChoiceSections c={c} email={user?.email} masters />}
    </>
  )
}

interface BillingSubDto {
  primaryPlanKey: string | null
  planKeys: string[]
  seats: number
  billingCycle: string | null
  unitPriceInr: number | null
  amountInr: number | null
  status: string
  nextChargeAt: string | null
  graceUntil: string | null
  razorpaySubscriptionId: string | null
  billed: boolean
}

/**
 * Billing, from GET /v1/workspace/plan/current (the same endpoint /plan uses,
 * so the two can't disagree). It replaced a mock of USD tiers and invented
 * invoices. Invoice history needs Razorpay's invoice API, so it's "coming soon".
 */
const BillingTab: React.FC = () => {
  const navigate = useNavigate()
  const [subs, setSubs] = useState<BillingSubDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    apiJson<{ subscriptions: BillingSubDto[] }>('/v1/workspace/plan/current')
      .then((r) => { if (alive) { setSubs(r.subscriptions ?? []); setFailed(false) } })
      .catch(() => { if (alive) { setSubs([]); setFailed(true) } })
    return () => { alive = false }
  }, [])
  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const pill = (s: BillingSubDto) =>
    !s.billed ? { tone: 'warn' as const, text: 'No autopay set up' }
      : s.status === 'ACTIVE' ? { tone: 'ok' as const, text: 'Active' }
        : s.status === 'TRIALING' ? { tone: 'ok' as const, text: '7-day trial' }
          : s.status === 'PAST_DUE' ? { tone: 'warn' as const, text: 'Payment retrying' }
            : s.status === 'HALTED' ? { tone: 'red' as const, text: 'Payment failed' }
              : { tone: 'warn' as const, text: s.status }
  const summary = subs === null ? 'Loading your plan…' : failed ? 'Couldn’t load your plan' : subs.length === 0 ? 'No modules on autopay yet' : `${subs.length} ${subs.length === 1 ? 'subscription' : 'subscriptions'} · modules, seats and billing`
  return (
    <>
      <SettingsSection id="plan" icon="creditCard" title="Your plan" summary={summary}>
        {subs === null ? <div role="status" aria-label="Loading your plan"><SkeletonBlock className="h-20 w-full rounded-xl" /></div>
          : failed ? <SettingsNote tone="amber">We couldn’t load your billing details just now. Open Manage plan to see the latest.</SettingsNote>
            : subs.length === 0 ? <SettingsNote>Pick the modules your team needs and set up autopay. The first 7 days are free.</SettingsNote>
              : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {subs.map((s) => {
                    const p = pill(s), next = fmtDate(s.nextChargeAt)
                    return (
                      <div key={s.razorpaySubscriptionId ?? s.primaryPlanKey} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }}>
                        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 4 }}>
                          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><strong style={{ fontSize: 14 }}>{s.planKeys.join(', ') || s.primaryPlanKey}</strong><HrStatusPill tone={p.tone}>{p.text}</HrStatusPill></span>
                          <span style={{ fontSize: 12.5, color: '#64748b' }}>
                            {s.seats > 0 ? <><span className="tabular-nums">{s.seats}</span> seats</> : <>Seat count not set</>}
                            {s.billed && s.amountInr != null && <> · <span className="tabular-nums">₹{s.amountInr.toLocaleString('en-IN')}</span>/{s.billingCycle === 'ANNUAL' ? 'yr' : 'mo'}</>}
                            {next && <> · next charge {next}</>}
                            {!s.billed && <> · unlocked, but nothing is being charged</>}
                          </span>
                        </div>
                        <HrButton variant="ghost" onClick={() => navigate('/plan')}>{s.billed ? 'Change seats' : 'Set up autopay'}</HrButton>
                      </div>
                    )
                  })}
                </div>
              )}
        <div><HrButton onClick={() => navigate('/plan')}>{subs && subs.length === 0 && !failed ? 'Choose modules' : 'Manage plan'}</HrButton></div>
      </SettingsSection>
      <SettingsSection id="invoices" icon="receipt" title="Invoices" summary="Razorpay emails an invoice to your registered address after every successful charge. Downloading past invoices here is coming soon." soon />
    </>
  )
}

const IntegrationsTab: React.FC = () => (
  <>{INTEGRATIONS.map((i) => <SettingsSection key={i.key} id={i.key} icon={i.icon} title={i.name} summary={i.desc} soon />)}</>
)

const DocumentsTab: React.FC = () => (
  <SettingsSection id="types" icon="fileText" title="Document types" summary="What employees see on their profile. Mark a type Required to make it a mandatory upload; HR verifies each upload.">
    <DocumentTypesTab bare />
  </SettingsSection>
)

/**
 * Danger Zone. These once were three buttons with no handler under copy that
 * promised permanent deletion. Until real, carefully built endpoints exist,
 * each opens an email to our team, which confirms with you before anything
 * is done. Promising nothing beats promising a deletion we don't perform.
 */
const DangerTab: React.FC = () => {
  const tenant = useAuthStore((s) => s.tenant)
  const mail = (what: string) =>
    `mailto:unifiedtree@gmail.com?subject=${encodeURIComponent(`${what} — ${tenant?.subdomain ?? 'workspace'}`)}` +
    `&body=${encodeURIComponent(`Workspace: ${tenant?.subdomain ?? ''}\nOrganisation: ${tenant?.name ?? ''}\n\nPlease ${what.toLowerCase()} for this workspace.\n\nI understand this request will be confirmed with me before anything is actioned.`)}`
  const rows = [
    { id: 'export', icon: 'download', title: 'Export all data', desc: 'Get a full copy of your workspace data. We confirm your identity and send a download link.', cta: 'Request data export', href: mail('Data export request') },
    { id: 'reset', icon: 'archive', title: 'Reset workspace', desc: 'Clear all records but keep the workspace and your account. Useful after trying it out with test data.', cta: 'Request workspace reset', href: mail('Workspace reset request') },
    { id: 'delete', icon: 'trash', title: 'Delete organisation', desc: 'Permanently delete this workspace and everything in it. We confirm in writing before anything is removed.', cta: 'Request deletion', href: mail('Workspace deletion request') },
  ]
  return (
    <>
      {rows.map((r, i) => (
        <SettingsSection key={r.id} id={r.id} icon={r.icon} title={r.title} summary={r.desc}>
          {i === 0 && <SettingsNote>These are handled by our team so nothing irreversible happens by accident. Each button opens an email to us; we confirm with you before doing anything.</SettingsNote>}
          <div>
            <a href={r.href} style={{ display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 16px', borderRadius: 12, border: '1px solid #fca5a5', background: r.id === 'delete' ? '#fee2e2' : '#fef2f2', color: '#b91c1c', fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>{r.cta}</a>
          </div>
        </SettingsSection>
      ))}
    </>
  )
}

/**
 * @param tab  Forces the tab for routes with a LITERAL path (/settings/billing,
 *             /settings/danger). Those have no `:tab` param; without the prop
 *             the page fell back to Profile under a "Billing" header (P0-7).
 */
export const Settings: React.FC<{ tab?: TabKey }> = ({ tab: tabProp }) => {
  const { tab } = useParams<{ tab?: string }>()
  const resolved = tabProp ?? tab
  const active: TabKey = VALID_TABS.includes(resolved as TabKey) ? (resolved as TabKey) : 'profile'
  const meta = TAB_META[active]
  const { toast, show, dismiss } = useSettingsToast()
  // Notifications is the one tab with a draft; it drives the unsaved-changes bar.
  const isNotif = active === 'notifications'
  const notif = useNotificationChoices(isNotif)
  const saveNotif = async () => {
    try { await notif.save(); show('ok', 'Notification choices saved', 'They apply to the next notification.') } catch (e) { show('error', 'Couldn’t save your choices', (e as Error)?.message) }
  }
  const nav = isNotif && notif.draft
    ? NAV.notifications.map((n) => (n.key === 'email' ? { ...n, state: notif.draft!.emailEnabled ? 'on' as const : 'off' as const }
      : n.key === 'push' ? { ...n, state: notif.draft!.pushEnabled ? 'on' as const : 'off' as const } : n))
    : NAV[active]
  const body: Record<TabKey, React.ReactNode> = {
    profile: <ProfileTab />,
    branding: <BrandingTab show={show} />,
    security: <SecurityTab />,
    notifications: <NotificationsTab c={notif} />,
    billing: <BillingTab />,
    integrations: <IntegrationsTab />,
    documents: <DocumentsTab />,
    danger: <DangerTab />,
  }
  return (
    <DesignFrame>
      <SettingsPage key={active} crumb="Workspace Settings" title={meta.label} subtitle={meta.desc} nav={nav} access="edit"
        status={isNotif ? notif.status : 'live'} onRetry={isNotif ? notif.refetch : undefined} entity={isNotif ? 'your notification choices' : 'settings'}
        dirty={isNotif && notif.dirty} changeCount={isNotif ? notif.changeCount : 0} errorCount={0} saving={isNotif && notif.saving}
        onSave={isNotif ? () => { void saveNotif() } : () => {}} onDiscard={isNotif ? notif.discard : () => {}} toast={toast} onDismissToast={dismiss}>
        {body[active]}
      </SettingsPage>
    </DesignFrame>
  )
}
