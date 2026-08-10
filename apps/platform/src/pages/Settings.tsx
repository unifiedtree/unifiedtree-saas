import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Zap, Crown, Star, Sparkles, Image as ImageIcon, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import { useAuthStore } from '@/core/auth/authStore'
import { apiJson, API_BASE_URL } from '@/core/api/client'
import { HrPageHeader, HrButton, HrStatusPill } from '@/shared/components/hr'

type TabKey = 'profile' | 'branding' | 'security' | 'notifications' | 'billing' | 'integrations' | 'danger'

// The settings *navigation* now lives in the app shell (workspace-scoped);
// this page just renders the section named in the URL (/settings/:tab).
const TAB_META: Record<TabKey, { label: string; desc: string }> = {
  profile:       { label: 'Profile',        desc: 'Your account and organization details.' },
  branding:      { label: 'Branding',       desc: 'Your logo and workspace identity.' },
  security:      { label: 'Security',       desc: 'Password, two-factor and active sessions.' },
  notifications: { label: 'Notifications',  desc: 'Email and in-app notification preferences.' },
  billing:       { label: 'Billing & Plan', desc: 'Your subscription, plan and invoices.' },
  integrations:  { label: 'Integrations',   desc: 'Connect external tools and services.' },
  danger:        { label: 'Danger Zone',    desc: 'Irreversible, workspace-wide actions.' },
}
const VALID_TABS = Object.keys(TAB_META) as TabKey[]

const Toggle: React.FC<{ enabled: boolean; onChange: (v: boolean) => void }> = ({ enabled, onChange }) => (
  <button
    onClick={() => onChange(!enabled)}
    className={clsx(
      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
      enabled ? 'bg-[#059669]' : 'bg-bg-base border border-border-default'
    )}
  >
    <span className={clsx('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', enabled ? 'translate-x-5' : 'translate-x-1')} />
  </button>
)

const ProfileTab: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  const [saved, setSaved] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-text-primary font-semibold mb-4">Personal Information</h3>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-[#059669] to-[#047857] rounded-2xl flex items-center justify-center text-white text-xl font-bold">
            {user?.firstName[0]}{user?.lastName[0]}
          </div>
          <div>
            <p className="text-text-primary font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-text-secondary text-sm">{user?.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'First Name', value: user?.firstName ?? '' },
            { label: 'Last Name', value: user?.lastName ?? '' },
            { label: 'Email Address', value: user?.email ?? '' },
            { label: 'Role', value: user?.role ?? '' },
          ].map(({ label, value }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-text-tertiary mb-1.5">{label}</label>
              <input
                value={value}
                readOnly
                className="w-full bg-[#F8FAFC] border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm cursor-default"
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-text-primary font-semibold mb-4">Organization</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Company Name', value: tenant?.name ?? '' },
            { label: 'Industry', value: tenant?.industry ?? '' },
            { label: 'Subdomain', value: tenant?.subdomain ?? '' },
            { label: 'Plan', value: tenant?.planType ?? '' },
          ].map(({ label, value }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-text-tertiary mb-1.5">{label}</label>
              <input
                value={value}
                readOnly
                className="w-full bg-[#F8FAFC] border border-border-default rounded-xl px-4 py-2.5 text-text-primary text-sm cursor-default"
              />
            </div>
          ))}
        </div>
      </div>
      {/* No Save button. Every field above is read-only because no endpoint
          exists to update an account or a workspace profile — TenantController
          can create companies but exposes no update mapping. This previously
          rendered editable-looking inputs (defaultValue, no onChange, so edits
          were never even read) above a button that flashed a green "Saved!"
          tick and persisted nothing. A confirmed save that did not happen is
          worse than no button: an admin correcting their company's legal name
          would believe it was fixed. */}
      <p className="text-xs text-text-tertiary">
        These details are read-only for now. To change your name or company details,
        contact <a href="mailto:unifiedtree@gmail.com" className="text-[#047857] underline">unifiedtree@gmail.com</a>.
      </p>
    </div>
  )
}

/** Small "not built yet" row, matching the Integrations treatment. */
const SoonRow: React.FC<{ title: string; desc: string }> = ({ title, desc }) => (
  <div className="flex items-center justify-between p-4 bg-white border border-border-default rounded-xl max-w-md opacity-75">
    <div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="text-xs text-text-secondary mt-0.5">{desc}</p>
    </div>
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ECFDF5] px-3 py-1 text-[11px] font-semibold text-[#047857]">
      <Sparkles size={11} /> Launching soon
    </span>
  </div>
)

/**
 * Security.
 *
 * What was here before, and why none of it survives:
 *
 *  - An "Active Sessions" list hardcoding two rows — "Chrome on Windows,
 *    Hyderabad" and "Safari on iPhone, Mumbai, 2 days ago" — shown identically
 *    to every admin regardless of who they are or what they logged in from.
 *    That is a fabricated security signal: an admin could conclude they had
 *    been breached, or (worse) that they had not been because the list looked
 *    clean. The "Revoke" button beside it had no onClick, so anyone trying to
 *    kill a hostile session was clicking a decoration. No session-listing or
 *    revoke endpoint exists anywhere in the backend.
 *
 *  - A 2FA toggle wired to local useState. It went green, persisted nothing,
 *    and reset on reload. No secret is provisioned and login never challenges.
 *    (auth.user_credentials.is_mfa_enabled exists and AuthService checks it,
 *    but the enrolment service it defers to was never built.) Claiming an
 *    account is protected by TOTP when it is not is the most consequential
 *    lie a settings page can tell.
 *
 *  - A change-password form whose three inputs had no value/onChange/ref, over
 *    a button with no handler. The typed password was never read. Someone
 *    rotating a compromised credential would discard the old one believing it
 *    was dead.
 *
 * Password change now routes to the real, working /v1/auth/forgot-password
 * flow. Sessions and 2FA are labelled honestly until the endpoints exist.
 */

/**
 * Branding — the workspace admin uploads their company logo. It replaces the
 * default UnifiedTree logo on the login page (before sign-in via
 * workspace-status) and in the app shell header (after sign-in via the
 * tenant.logoUrl on the auth store).
 *
 * Server enforces: PNG / JPEG / WebP only, magic-byte sniffed, 2 MB max,
 * SVG deliberately blocked (XSS vector). The <input> accept attribute is a
 * UX hint; the real gate is the server.
 */
/**
 * Human sentences for the HTTP status codes an upload / GET can return.
 * Users should never see "HTTP 401" — that leaks implementation and helps
 * no one troubleshoot. Anything not mapped here falls back to a generic
 * "please try again" so we never surface a raw error to the customer.
 *
 * The map is a function (not a static object) so the copy can vary by
 * server-supplied body — e.g. a 415 that also carries an allowed-types
 * message from the backend gets threaded through.
 */
function humanErrorFor(status: number, body?: string): { title: string; description: string } {
  const serverMessage = (() => {
    if (!body) return ''
    try { return (JSON.parse(body) as { message?: string }).message ?? '' } catch { return '' }
  })()
  switch (status) {
    case 0: // fetch network error / offline
      return {
        title: 'Could not reach the server',
        description: 'Check your internet connection and try again.',
      }
    case 401:
      return {
        title: 'Your session has expired',
        description: 'Please sign in again to change the logo.',
      }
    case 402:
      return {
        title: 'Your subscription has ended',
        description: "You can view branding, but to change it please renew your subscription from Manage Plan.",
      }
    case 403:
      return {
        title: "You don't have permission for this",
        description: 'Only workspace admins can change the logo. Ask your admin to update it.',
      }
    case 413:
      return {
        title: 'That image is too large',
        description: 'Pick a file 2 MB or smaller.',
      }
    case 415:
      return {
        title: "That file type isn't supported",
        description: serverMessage || 'Upload a PNG, JPEG, GIF, WebP or AVIF image.',
      }
    case 429:
      return {
        title: 'Too many uploads in a row',
        description: 'Please wait a minute and try again.',
      }
    default:
      if (status >= 500) {
        return {
          title: 'Something went wrong on our end',
          description: "We're on it. Please try again in a minute.",
        }
      }
      return {
        title: 'Upload failed',
        description: serverMessage || 'Please try again — if it keeps failing, contact your admin.',
      }
  }
}

const BrandingTab: React.FC = () => {
  const token       = useAuthStore((s) => s.token)
  const tenant      = useAuthStore((s) => s.tenant)
  const refreshTenant = useAuthStore((s) => s.refreshTenant)

  const [logoUrl, setLogoUrl] = useState<string | null>(tenant?.logoUrl ?? null)
  const [uploading, setUploading] = useState(false)
  // If GET /branding responds 402 (cancelled tenant) we disable the upload
  // button + explain — otherwise the user clicks it and hits a second error.
  const [loadBlocked, setLoadBlocked] = useState<{ status: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync from the auth store when it refreshes (e.g. right after a hydrate).
  useEffect(() => { setLogoUrl(tenant?.logoUrl ?? null) }, [tenant?.logoUrl])

  // On first load, pull the fresh URL from the server rather than trusting
  // stale store state — the tenant object cache can be an hour old.
  useEffect(() => {
    let cancelled = false
    apiJson<{ logoUrl: string | null }>('/v1/workspace/branding')
      .then((res) => { if (!cancelled) setLogoUrl(res.logoUrl ?? null) })
      .catch((err) => {
        if (cancelled) return
        // apiJson throws an object with a numeric `status` — surface the
        // block reason so the button can be disabled with a helpful pointer.
        const status = (err as { status?: number })?.status ?? 0
        if (status === 402 || status === 403) setLoadBlocked({ status })
      })
    return () => { cancelled = true }
  }, [])

  const chooseFile = () => inputRef.current?.click()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      const msg = humanErrorFor(413)
      toast.error(msg.title, { description: msg.description })
      return
    }
    setUploading(true)
    try {
      // Use fetch directly — apiJson stringifies bodies as JSON and this must
      // travel as multipart/form-data.
      const form = new FormData()
      form.append('file', file)
      let resp: Response
      try {
        resp = await fetch(`${API_BASE_URL}/v1/workspace/branding/logo`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        })
      } catch {
        const msg = humanErrorFor(0)
        toast.error(msg.title, { description: msg.description })
        return
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        const msg = humanErrorFor(resp.status, body)
        toast.error(msg.title, { description: msg.description })
        return
      }
      const res = await resp.json() as { logoUrl: string | null }
      setLogoUrl(res.logoUrl ?? null)
      // Refresh the store so the shell header logo swaps immediately.
      try { await refreshTenant() } catch { /* best-effort */ }
      toast.success('Logo updated', { description: 'You may need to hard-refresh other browsers to see the change.' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Workspace logo</h3>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Shown on the sign-in page and in the top-left of the app. PNG, JPEG, GIF, WebP or AVIF,
          up to 2 MB. Wide-format logos work best — the header renders at 28 px tall.
        </p>
      </div>

      {loadBlocked && (() => {
        const msg = humanErrorFor(loadBlocked.status)
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <div className="font-semibold text-amber-900">{msg.title}</div>
            <div className="mt-1 text-amber-800">{msg.description}</div>
          </div>
        )
      })()}

      <div className="flex items-center gap-6 rounded-xl border border-border-default bg-white p-6">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-default bg-bg-subtle">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Current workspace logo"
              className="max-h-full max-w-full object-contain p-2"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <ImageIcon size={28} className="text-slate-400" />
          )}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {logoUrl ? 'Custom logo set' : 'No custom logo yet'}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {logoUrl
              ? 'This logo replaces the UnifiedTree default on the login page and in the header.'
              : 'Until you upload one, the default UnifiedTree logo is shown to your team.'}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <HrButton onClick={chooseFile} disabled={uploading || !!loadBlocked}>
              <Upload size={14} className="mr-1.5" />
              {uploading ? 'Uploading…' : (logoUrl ? 'Replace logo' : 'Upload logo')}
            </HrButton>
            {logoUrl && (
              <button
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                onClick={() => window.open(logoUrl, '_blank', 'noopener')}
              >
                Open image
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        Uploaded to Cloudflare R2. Nothing sensitive here — the URL is public so browsers can
        display it without a token.
      </p>
    </div>
  )
}

const SecurityTab: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const sendReset = async () => {
    if (!user?.email) return
    setSending(true); setError('')
    try {
      await apiJson('/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: user.email }),
      })
      setSent(true)
    } catch {
      // Deliberately soft: forgot-password is intentionally non-committal
      // about whether an address exists, so we do not surface a hard failure
      // that could be read as account enumeration.
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-text-primary font-semibold mb-1">Password</h3>
        <p className="text-text-secondary text-sm mb-4">
          We'll email a secure reset link to <span className="font-medium text-text-primary">{user?.email}</span>.
          The link expires shortly after it is sent.
        </p>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl border border-[#6EE7B7] bg-[#ECFDF5] p-4 max-w-md text-sm text-[#047857]">
            <Check size={15} className="shrink-0" />
            Reset link sent. Check your inbox (and spam folder).
          </div>
        ) : (
          <div className="max-w-md">
            <HrButton onClick={sendReset} disabled={sending || !user?.email}>
              {sending ? 'Sending…' : 'Email me a password reset link'}
            </HrButton>
            {error && <p className="mt-2 text-xs text-[#B91C1C]">{error}</p>}
          </div>
        )}
      </div>

      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Two-Factor Authentication</h3>
        <SoonRow title="Authenticator App"
                 desc="Protect your account with a one-time code from Google Authenticator or similar." />
      </div>

      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Active Sessions</h3>
        <SoonRow title="Device & session management"
                 desc="See where your account is signed in and sign out other devices." />
      </div>
    </div>
  )
}

/**
 * Notification preferences.
 *
 * Previously nine invented defaults in a useState, with NO save control
 * anywhere in the component — toggling and navigating away discarded
 * everything. The defaults were not even uniformly on: "Payroll processed" and
 * "Invoice overdue" rendered OFF, which reads as a deliberate choice someone
 * made. An admin asking "why didn't I get emailed about that?" would come
 * here, see the toggle off, and be actively misled about the cause.
 *
 * No preferences endpoint exists (NotificationsController serves the in-app
 * inbox; settings.notification_templates is a tenant-wide HR template
 * catalogue, not per-user prefs). So the rows are shown as the roadmap they
 * are, with no controls that pretend to persist.
 *
 * What DOES currently reach an admin, unconditionally: leave/WFH/correction
 * approvals, shift-change requests, welcome emails, and autopay-failure
 * notices. That is stated plainly so nobody assumes silence means disabled.
 */
const NotificationsTab: React.FC = () => {
  const emailRows = [
    { label: 'New employee joined', desc: 'When a new user is added to the workspace' },
    { label: 'Leave request submitted', desc: 'When an employee submits a leave request' },
    { label: 'Payroll processed', desc: 'Monthly payroll completion notification' },
    { label: 'Deal status changed', desc: 'CRM deal stage updates' },
    { label: 'Critical tickets opened', desc: 'High & critical priority helpdesk tickets' },
    { label: 'Invoice overdue', desc: 'When invoices pass their due date' },
  ]
  const pushRows = [
    { label: 'All notifications', desc: 'Receive all in-app notifications' },
    { label: 'Critical alerts only', desc: 'Security & system critical alerts' },
    { label: 'Mentions & assignments', desc: 'When you are tagged or assigned' },
  ]

  const Row: React.FC<{ label: string; desc: string }> = ({ label, desc }) => (
    <div className="flex items-center justify-between p-3.5 bg-white border border-border-default rounded-xl opacity-75">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-secondary mt-0.5">{desc}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ECFDF5] px-3 py-1 text-[11px] font-semibold text-[#047857]">
        <Sparkles size={11} /> Launching soon
      </span>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border-default bg-[#F8FAFC] p-4">
        <p className="text-sm text-text-primary font-medium">Per-person notification controls are on the way</p>
        <p className="mt-1 text-xs text-text-secondary">
          Until then, admins and approvers receive the notifications the workspace needs to
          function — leave, WFH and attendance-correction requests, shift changes, new-member
          welcomes, and any autopay payment failure — by email and in the app.
        </p>
      </div>
      <div>
        <h3 className="text-text-primary font-semibold mb-1">Email Notifications</h3>
        <p className="text-text-secondary text-sm mb-4">Choose which events trigger email alerts</p>
        <div className="space-y-3">
          {emailRows.map((r) => <Row key={r.label} {...r} />)}
        </div>
      </div>
      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-4">Push Notifications</h3>
        <div className="space-y-3">
          {pushRows.map((r) => <Row key={r.label} {...r} />)}
        </div>
      </div>
    </div>
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
 * Real billing state for this workspace.
 *
 * Replaces a hardcoded mock that showed three USD tiers ($29 / $79 / $199),
 * a "PROFESSIONAL" badge and three invented invoices (INV-00089 and friends).
 * None of it existed: pricing is per-module in rupees from
 * platform.module_plans (HR is ₹39/user/month), there are no such tiers, and
 * no invoice with those numbers was ever issued. A customer reading that page
 * was being shown fabricated financial records.
 *
 * Everything here now comes from GET /v1/workspace/plan/current, the same
 * endpoint /plan uses, so the two screens cannot disagree. Billing history is
 * deliberately absent rather than faked — real invoices need Razorpay's
 * invoice API, which is not wired yet.
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

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  const pill = (s: BillingSubDto) =>
    !s.billed                 ? { tone: 'warn' as const, text: 'No autopay set up' } :
    s.status === 'ACTIVE'     ? { tone: 'ok'   as const, text: 'Active' } :
    s.status === 'TRIALING'   ? { tone: 'ok'   as const, text: '7-day trial' } :
    s.status === 'PAST_DUE'   ? { tone: 'warn' as const, text: 'Payment retrying' } :
    s.status === 'HALTED'     ? { tone: 'red'  as const, text: 'Payment failed' } :
                                { tone: 'warn' as const, text: s.status }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-text-primary font-semibold mb-1">Your plan</h3>
            <p className="text-text-secondary text-sm">Modules, seats and billing for this workspace.</p>
          </div>
          <button onClick={() => navigate('/plan')}
                  className="px-4 py-2 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm font-medium">
            Manage plan
          </button>
        </div>

        {subs === null ? (
          <div className="h-24 animate-pulse rounded-2xl border border-border-default bg-white" />
        ) : failed ? (
          <div className="rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-5 text-sm text-[#B91C1C]">
            We couldn't load your billing details just now. Open Manage plan to see the latest.
          </div>
        ) : subs.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-white p-6 text-center">
            <p className="text-sm font-medium text-text-primary">No modules on autopay yet</p>
            <p className="mt-1 text-xs text-text-secondary">
              Pick the modules your team needs and set up autopay — the first 7 days are free.
            </p>
            <button onClick={() => navigate('/plan')}
                    className="mt-4 px-4 py-2 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm font-medium">
              Choose modules
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {subs.map((s) => {
              const p = pill(s)
              const next = fmtDate(s.nextChargeAt)
              return (
                <div key={s.razorpaySubscriptionId ?? s.primaryPlanKey}
                     className="flex flex-wrap items-center justify-between gap-3 p-5 bg-white border border-border-default rounded-2xl">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">
                        {s.planKeys.join(', ') || s.primaryPlanKey}
                      </p>
                      <HrStatusPill tone={p.tone}>{p.text}</HrStatusPill>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      {s.seats > 0
                        ? <><span className="tabular-nums">{s.seats}</span> seats</>
                        : <>Seat count not set</>}
                      {s.billed && s.amountInr != null && (
                        <> · <span className="tabular-nums">₹{s.amountInr.toLocaleString('en-IN')}</span>
                          /{s.billingCycle === 'ANNUAL' ? 'yr' : 'mo'}</>
                      )}
                      {next && <> · next charge {next}</>}
                      {!s.billed && <> · unlocked, but nothing is being charged</>}
                    </p>
                  </div>
                  <button onClick={() => navigate('/plan')}
                          className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-text-secondary hover:text-text-primary hover:border-[#6EE7B7]">
                    {s.billed ? 'Change seats' : 'Set up autopay'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border-default pt-6">
        <h3 className="text-text-primary font-semibold mb-2">Invoices</h3>
        <p className="text-text-secondary text-sm">
          Razorpay emails an invoice to your registered address after every successful
          charge. Downloadable invoice history is coming to this page soon.
        </p>
      </div>
    </div>
  )
}

/**
 * Integrations roadmap.
 *
 * None of these are built yet. This tab previously rendered a working-looking
 * "Connect" button whose only effect was flipping a local useState — and it
 * shipped with Slack, Zapier and Stripe pre-marked "Connected", so an admin
 * would reasonably believe their workspace was wired to services it has never
 * spoken to. The list is kept (it is the real roadmap) but presented honestly
 * as launching soon, with no control that pretends to do something.
 */
const IntegrationsTab: React.FC = () => {
  const integrations = [
    { key: 'slack', name: 'Slack', desc: 'Send notifications to Slack channels', logo: '🔔' },
    { key: 'github', name: 'GitHub', desc: 'Link commits and PRs to projects', logo: '🐙' },
    { key: 'jira', name: 'Jira', desc: 'Sync issues with Jira boards', logo: '📋' },
    { key: 'zapier', name: 'Zapier', desc: 'Automate with 5000+ apps via Zapier', logo: '⚡' },
    { key: 'stripe', name: 'Stripe', desc: 'Process payments via Stripe', logo: '💳' },
    { key: 'salesforce', name: 'Salesforce', desc: 'Sync CRM data with Salesforce', logo: '☁️' },
  ]

  return (
    <div className="space-y-3">
      <p className="text-text-secondary text-sm mb-4">
        Connect external tools and services to extend UnifiedTree functionality.
        These integrations are on the roadmap and will light up here as they ship.
      </p>
      {integrations.map(({ key, name, desc, logo }) => (
        <div key={key} className="flex items-center justify-between p-4 bg-white border border-border-default rounded-xl opacity-75">
          <div className="flex items-center gap-4">
            <span className="text-2xl grayscale">{logo}</span>
            <div>
              <p className="text-sm font-medium text-text-primary">{name}</p>
              <p className="text-xs text-text-secondary">{desc}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-3 py-1 text-[11px] font-semibold text-[#047857]">
            <Sparkles size={11} /> Launching soon
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Danger Zone.
 *
 * Previously three buttons — Request Data Export, Reset Workspace and Delete
 * Organization — with no onClick, no confirmation, and no endpoints behind
 * any of them. They were pure decoration under copy that promised
 * "Permanently delete your organization and all associated data. This action
 * is irreversible."
 *
 * That is not merely a dead button. An offboarding customer clicks Delete,
 * believes their data is destroyed, closes the tab, and may tell their own
 * customers or a regulator that it was deleted — while every row is still
 * there. The export button carried the same problem in the other direction:
 * an unfulfillable data-portability promise under DPDP/GDPR.
 *
 * Until real endpoints exist (they are genuinely destructive and deserve
 * their own careful build — see DeleteRoleConfirm in Roles.tsx for the
 * confirmation pattern to follow), these route to a human. Promising nothing
 * beats promising deletion we do not perform.
 */
const DangerTab: React.FC = () => {
  const tenant = useAuthStore((s) => s.tenant)
  const subject = (what: string) =>
    `mailto:unifiedtree@gmail.com?subject=${encodeURIComponent(
      `${what} — ${tenant?.subdomain ?? 'workspace'}`)}` +
    `&body=${encodeURIComponent(
      `Workspace: ${tenant?.subdomain ?? ''}\nOrganisation: ${tenant?.name ?? ''}\n\n` +
      `Please ${what.toLowerCase()} for this workspace.\n\n` +
      `I understand this request will be confirmed with me before anything is actioned.`)}`

  const rows = [
    {
      title: 'Export all data',
      desc: 'Get a full copy of your workspace data. We will confirm your identity and send a download link.',
      cta: 'Request data export',
      href: subject('Data export request'),
    },
    {
      title: 'Reset workspace',
      desc: 'Clear all records but keep the workspace and your account — useful after trialling with test data.',
      cta: 'Request workspace reset',
      href: subject('Workspace reset request'),
    },
    {
      title: 'Delete organisation',
      desc: 'Permanently delete this workspace and everything in it. We will confirm in writing before anything is removed.',
      cta: 'Request deletion',
      href: subject('Workspace deletion request'),
      strong: true,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-default bg-[#F8FAFC] p-4">
        <p className="text-xs text-text-secondary">
          These actions are handled by our team so nothing irreversible happens by accident.
          Email us and we'll confirm with you before doing anything. Self-service controls are
          coming to this page.
        </p>
      </div>
      {rows.map((r) => (
        <div key={r.title}
             className={clsx('p-4 rounded-xl border',
               r.strong ? 'bg-[#FEE2E2] border-[#FCA5A5]' : 'bg-[#FEF2F2] border-[#FECACA]')}>
          <h3 className="text-[#B91C1C] font-semibold text-sm mb-1">{r.title}</h3>
          <p className="text-text-secondary text-xs mb-3">{r.desc}</p>
          <a href={r.href}
             className="inline-block px-4 py-2 border border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEE2E2] rounded-xl text-sm font-medium transition-colors">
            {r.cta}
          </a>
        </div>
      ))}
    </div>
  )
}

export const Settings: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>()
  const active: TabKey = VALID_TABS.includes(tab as TabKey) ? (tab as TabKey) : 'profile'
  const meta = TAB_META[active]

  const tabContent: Record<TabKey, React.ReactNode> = {
    profile: <ProfileTab />,
    branding: <BrandingTab />,
    security: <SecurityTab />,
    notifications: <NotificationsTab />,
    billing: <BillingTab />,
    integrations: <IntegrationsTab />,
    danger: <DangerTab />,
  }

  return (
    <div className="animate-fade-in mx-auto max-w-4xl p-6 sm:p-8">
      <HrPageHeader crumb="Workspace Settings" title={meta.label} subtitle={meta.desc} />
      <div className="rounded-2xl border border-border-default bg-white p-6">
        {tabContent[active]}
      </div>
    </div>
  )
}
