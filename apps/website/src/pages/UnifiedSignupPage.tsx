import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Loader2, User, Building, Mail, Lock, Globe, Users,
  Edit2, Check, X as XIcon, AlertCircle, ChevronDown, ChevronUp,
  Receipt, ArrowRight, Sparkles,
} from 'lucide-react'
import { usePricingStore } from '../store/pricingStore'
import { useAuthStore } from '../store/authStore'
import { useModulePlans, effectiveUnit, type ModulePlan } from '../lib/plans'
import { API_BASE_URL, api } from '../lib/api'
import { friendlyServerError } from '../lib/errors'
import { Navbar } from '../components/layout/Navbar'
import { Eyebrow } from '../components/marketing/PageHero'
import { COUNTRIES } from '../data/countries'
import { PhoneField } from '../components/forms/PhoneField'
import { useSubdomainAvailability } from '../lib/subdomainCheck'

// -- constants -------------------------------------------------------------
const DEV_PLATFORM_PORT = (import.meta.env.VITE_PLATFORM_PORT as string | undefined) || '3001'
const TRIAL_DAYS = 7
const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 30 * 60 * 1000   // give up after 30 min of polling

// Google OAuth kickoff — plain full-page navigation to the backend, which
// 302s to accounts.google.com. NOT a fetch: cross-origin redirects cannot be
// followed by XHR. Same URL as LoginPage; the callback lands on
// /workspaces?welcome=1 (success) or /login?error=<code> (failure).
const GOOGLE_OAUTH_START_URL =
  'https://api.unifiedtree.com/api/v1/accounts/auth/google/start'

// -- schema (shared between TRIAL and PAID) --------------------------------
// Password fields are optional on the type but required at submit time when
// the caller is NOT signed in. Enforced at handleSubmit rather than in zod
// because zod .refine can't cheaply read the auth store.
const signupSchema = z.object({
  adminName: z.string().min(2, 'Name is required'),
  companyName: z.string().min(2, 'Company name is required'),
  subdomain: z.string()
    .min(3, 'At least 3 chars')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only'),
  adminEmail: z.string().email('Valid email required'),
  adminMobile: z.string().regex(/^\+\d{7,15}$/, 'Please enter a valid phone number'),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  seats: z.coerce.number().int().min(1, 'At least 1 user'),
  country: z.string().min(1, 'Country is required'),
  // Optional company / tax details — soft-warned only, no format constraint.
  pan: z.string().optional(),
  gstin: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
}).refine(
  (d) => !d.password || d.password.length >= 8,
  { message: 'Password must be at least 8 characters', path: ['password'] },
).refine(
  (d) => !d.password || d.password === d.confirmPassword,
  { message: 'Passwords do not match', path: ['confirmPassword'] },
)

type SignupData = z.infer<typeof signupSchema>

interface SignupResponse {
  pendingSignupId: string
  razorpaySubscriptionId: string
  checkoutShortUrl: string
  mode: 'TRIAL' | 'PAID'
  keyId: string
}

/** Response from POST /v1/public/free-signup — the workspace is already
 *  created; no polling required. */
interface FreeSignupResponse {
  tenantId: string
  subdomain: string
  workspaceUrl: string
  email: string
}

interface StatusResponse {
  status: 'AWAITING_MANDATE' | 'PROVISIONED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
  tenantId?: string
  workspaceUrl?: string
  subdomain: string
  failureReason?: string
}

// -- helpers ---------------------------------------------------------------
function workspaceLoginUrl(subdomain: string, email: string, workspaceUrlFromServer?: string) {
  const host = window.location.hostname.toLowerCase()
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')
  const emailParam = `?email=${encodeURIComponent(email)}`
  if (isLocal) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${subdomain}.localhost:${DEV_PLATFORM_PORT}/login${emailParam}`
  }
  const base = (workspaceUrlFromServer || `https://${subdomain}.unifiedtree.com`).replace(/\/$/, '')
  return `${base}/login${emailParam}`
}

// ============================================================================
//  UnifiedSignupPage
// ============================================================================

export function UnifiedSignupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const modeParam = (searchParams.get('mode') || 'paid').toLowerCase()
  const initialMode: 'trial' | 'paid' = modeParam === 'trial' ? 'trial' : 'paid'
  const [mode, setMode] = useState<'trial' | 'paid'>(initialMode)

  const accountToken   = useAuthStore((s) => s.accountToken)
  const account        = useAuthStore((s) => s.account)
  const workspaces     = useAuthStore((s) => s.workspaces)
  const loadWorkspaces = useAuthStore((s) => s.loadWorkspaces)
  const setAccountAuth = useAuthStore((s) => s.setAccountAuth)

  // Ensure workspaces are loaded when we hit this page (so we can force the
  // mode correctly for signed-in visitors).
  useEffect(() => {
    if (accountToken && workspaces.length === 0) {
      loadWorkspaces().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountToken])

  // Global rule: signed-in visitor with ≥1 workspace is NEVER on trial.
  // Force mode=paid regardless of URL.
  useEffect(() => {
    if (accountToken && workspaces.length >= 1 && mode === 'trial') {
      setMode('paid')
    }
  }, [accountToken, workspaces.length, mode])

  // -- pricing store ------------------------------------------------------
  const selectedPlanKeys = usePricingStore((s) => s.selectedPlanKeys)
  const storeSeats       = usePricingStore((s) => s.seats)
  const billingCycle     = usePricingStore((s) => s.billingCycle)
  const setBillingCycle  = usePricingStore((s) => s.setBillingCycle)

  const { data: allPlans = [] } = useModulePlans()
  const plans = useMemo(() => allPlans.filter((p) => p.status !== 'RETIRED'), [allPlans])
  const availablePlans = useMemo(() => plans.filter((p) => p.status === 'AVAILABLE'), [plans])
  const chosenPlans: ModulePlan[] = useMemo(() => {
    const picked = availablePlans.filter((p) => selectedPlanKeys.includes(p.key))
    // In TRIAL we allow "no card required" defaults; but the backend refuses
    // an empty planKeys list, so fall back to the first AVAILABLE plan to
    // keep the form submittable even if a visitor lands here without picking.
    return picked.length ? picked : availablePlans.slice(0, 1)
  }, [availablePlans, selectedPlanKeys])
  const chosenPlanNames = chosenPlans.map((p) => p.displayName).join(', ')

  // -- form ----------------------------------------------------------------
  const {
    register, handleSubmit, watch, setValue, formState: { errors },
  } = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      seats: storeSeats,
      country: 'India',
      adminEmail: account?.email || '',
    },
  })

  // Auto-fill email when the account loads after mount.
  useEffect(() => {
    if (account?.email) setValue('adminEmail', account.email)
  }, [account?.email, setValue])

  const companyName    = watch('companyName')
  const subdomainValue = watch('subdomain')
  const availability   = useSubdomainAvailability(subdomainValue)
  const seats          = Number(watch('seats')) || 1

  // Auto-derive subdomain from company name until the user takes over.
  const subdomainTouched = useRef(false)
  const [isEditingSubdomain, setIsEditingSubdomain] = useState(false)
  useEffect(() => {
    if (subdomainTouched.current || isEditingSubdomain) return
    if (!companyName) return
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (slug.length >= 3) setValue('subdomain', slug)
  }, [companyName, isEditingSubdomain, setValue])

  // -- price summary (paid only) ------------------------------------------
  const perUser       = chosenPlans.reduce((sum, p) => sum + p.priceInr, 0)
  const perUserAnnual = chosenPlans.reduce((sum, p) => sum + effectiveUnit(p, 'annual'), 0)
  const cycleUnit     = billingCycle === 'annual' ? perUserAnnual : perUser
  const chargeTotal   = billingCycle === 'annual' ? perUserAnnual * seats * 12 : cycleUnit * seats

  // -- submit -------------------------------------------------------------
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingSignupId, setPendingSignupId] = useState<string | null>(null)
  const [waitingForMandate, setWaitingForMandate] = useState(false)
  const [checkoutTab, setCheckoutTab] = useState<Window | null>(null)
  // B4 anti-enumeration guard (teammate's, ported through the layout
  // redesign): when the backend returns HTTP 200 with a null tenantId
  // (free-signup) or a null pendingSignupId (subscription-signup TRIAL), we
  // render the same "check your inbox" screen a fresh signup would show so an
  // attacker cannot distinguish "email already claimed with a different
  // password" from a real new signup by the client-side outcome either.
  const [checkInboxSuccess, setCheckInboxSuccess] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')

  // Cancel a previously-created pending signup on the backend. Used both by
  // the "Cancel and edit my details" overlay button and BEFORE every new
  // submit when we have a leftover pendingSignupId — otherwise the old
  // Razorpay subscription sits around, its UPI mandate registration blocks
  // the new one ("Autopay already exists" on GPay), and its pending row
  // holds the subdomain reservation ("That workspace URL is already being
  // claimed" on the next submit).
  const cancelPending = async (id: string): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/v1/public/subscription-signup/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingSignupId: id }),
      })
      // Ignore response — endpoint is idempotent and we're best-effort here.
    } catch { /* network blip is fine; 24h expiry sweep is the safety net */ }
  }

  const onSubmit = async (data: SignupData) => {
    setError('')
    setLoading(true)
    try {
      // Require password only when NOT signed in.
      if (!accountToken && (!data.password || data.password.length < 8)) {
        throw new Error('Password is required (min 8 characters).')
      }

      // ------------------------------------------------------------------
      // TRIAL = "Create Free Workspace" flow
      // ------------------------------------------------------------------
      // Synchronous POST to /v1/public/free-signup — no Razorpay round-trip,
      // no mandate, no polling. Workspace is created with ZERO active
      // modules; the admin unlocks + pays inside the workspace on the
      // /plan page. Multiple free workspaces per account allowed.
      if (mode === 'trial') {
        const body = {
          companyName: data.companyName,
          subdomain:   data.subdomain,
          adminName:   data.adminName,
          adminEmail:  data.adminEmail,
          adminMobile: data.adminMobile,
          password:    accountToken ? undefined : data.password,
          country:     data.country,
          timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,
          currency:    'INR',
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (accountToken) headers['Authorization'] = `Bearer ${accountToken}`

        const res = await fetch(`${API_BASE_URL}/v1/public/free-signup`, {
          method: 'POST', headers, body: JSON.stringify(body),
        })
        const text = await res.text()
        const parsed: FreeSignupResponse | { message?: string } = text ? JSON.parse(text) : {}
        if (!res.ok) {
          throw new Error((parsed as { message?: string }).message || `Signup failed (${res.status})`)
        }
        const r = parsed as FreeSignupResponse

        // B4 anti-enumeration guard (see backend SaasService
        // .resolveOrCreateAccountIdSafe): when the email already claims an
        // account with a different password, the backend returns HTTP 200
        // with tenantId/subdomain/workspaceUrl all null so an attacker cannot
        // distinguish "wrong password / claimed email" from a fresh signup by
        // status code. Mirror that indistinguishability client-side — do NOT
        // attempt the auto-login below (it would 401 and strand the visitor
        // on an empty /workspaces a successful signup never lands on).
        if (!r.tenantId || !r.subdomain || !r.workspaceUrl) {
          setSubmittedEmail(data.adminEmail)
          setCheckInboxSuccess(true)
          return
        }

        // Auto-login on the account we just created (or the pre-existing
        // one when signed in) so the visitor lands on /workspaces with a
        // session already established. Then navigate them to their new
        // workspace tile — they click Launch to enter.
        try {
          if (!accountToken && data.password) {
            const resp = await api.post('/v1/accounts/auth/login', {
              email: data.adminEmail, password: data.password,
            })
            setAccountAuth(resp.accessToken, resp.account, resp.workspaces)
          } else if (accountToken) {
            await loadWorkspaces().catch(() => {})
          }
        } catch { /* rare — the account was just created; user can login manually */ }

        // Open the new workspace directly (client asked: "redirects to
        // their company.unifiedtree.com"). The null case is handled by the
        // anti-enumeration guard above, so no fallback branch remains here.
        const loginUrl = workspaceLoginUrl(r.subdomain, r.email || data.adminEmail, r.workspaceUrl)
        window.location.href = loginUrl
        return
      }

      // ------------------------------------------------------------------
      // PAID = autopay Razorpay Subscription flow (unchanged)
      // ------------------------------------------------------------------
      // If we're re-submitting after the user changed their mind on the
      // waiting overlay (or edited any field), cancel the previous attempt
      // BEFORE creating a new subscription. Prevents subdomain-reservation
      // 409s and UPI-side "Autopay already exists" errors.
      if (pendingSignupId) {
        await cancelPending(pendingSignupId)
        setPendingSignupId(null)
      }

      const planKeys = chosenPlans.map((p) => p.key)
      if (planKeys.length === 0) {
        throw new Error('Please pick at least one module for your workspace.')
      }

      const body = {
        mode: mode.toUpperCase(),
        companyName:    data.companyName,
        subdomain:      data.subdomain,
        adminName:      data.adminName,
        adminEmail:     data.adminEmail,
        adminMobile:    data.adminMobile,
        password:       accountToken ? undefined : data.password,
        country:        data.country,
        timezone:       Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency:       'INR',
        planKeys,
        seats,
        billingCycle,        // 'monthly' | 'annual' (backend normalises to yearly)
        pan:          data.pan          || undefined,
        gstin:        data.gstin        || undefined,
        addressLine1: data.addressLine1 || undefined,
        addressLine2: data.addressLine2 || undefined,
        city:         data.city         || undefined,
        state:        data.state        || undefined,
        postalCode:   data.postalCode   || undefined,
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (accountToken) headers['Authorization'] = `Bearer ${accountToken}`

      const res = await fetch(`${API_BASE_URL}/v1/public/subscription-signup`, {
        method: 'POST', headers, body: JSON.stringify(body),
      })
      const text = await res.text()
      const parsed: SignupResponse | { message?: string } = text ? JSON.parse(text) : {}
      if (!res.ok) {
        throw new Error((parsed as { message?: string }).message || `Signup failed (${res.status})`)
      }
      const r = parsed as SignupResponse

      // B4 anti-enumeration guard for TRIAL mode: the backend returns
      // pendingSignupId=null + checkoutShortUrl=null when the anon caller
      // attempts a trial for an email that already claims an account. We
      // must not open `window.open(undefined)` or wire the polling machinery
      // — that would leak the branch (no Razorpay tab pops up vs. one does).
      // Mirror the same "check your inbox" surface the free-signup path uses.
      if (!r.pendingSignupId || !r.checkoutShortUrl) {
        setSubmittedEmail(data.adminEmail)
        setCheckInboxSuccess(true)
        return
      }

      // Open Razorpay checkout in a NEW tab and keep the visitor on our
      // page so we can poll for mandate completion and redirect them into
      // the workspace as soon as it's provisioned.
      const tab = window.open(r.checkoutShortUrl, '_blank', 'noopener,noreferrer')
      setCheckoutTab(tab)
      setPendingSignupId(r.pendingSignupId)
      setWaitingForMandate(true)
    } catch (err) {
      setError(friendlyServerError((err as Error)?.message))
    } finally {
      setLoading(false)
    }
  }

  // -- polling for provisioning -------------------------------------------
  const pollDeadline = useRef<number>(0)
  useEffect(() => {
    if (!pendingSignupId || !waitingForMandate) return
    pollDeadline.current = Date.now() + POLL_MAX_MS
    const email = watch('adminEmail')
    const iv = setInterval(async () => {
      if (Date.now() > pollDeadline.current) {
        clearInterval(iv)
        setError('We couldn’t confirm your mandate approval. If you completed it in Razorpay, please refresh this page.')
        setWaitingForMandate(false)
        return
      }
      try {
        const res = await fetch(
          `${API_BASE_URL}/v1/public/subscription-signup/status?pendingSignupId=${pendingSignupId}`,
        )
        if (!res.ok) return
        const s: StatusResponse = await res.json()
        if (s.status === 'PROVISIONED' && s.tenantId) {
          clearInterval(iv)
          // Auto-login on the account we just created with the password the
          // user typed at signup, then land them on /workspaces where the
          // new workspace tile is visible immediately. Previous behaviour
          // dumped them back on the marketing home with no signal that
          // signup had succeeded — reads as "nothing happened".
          //
          // Signed-in signup path (accountToken already set) skips the
          // login POST: they were authenticated before submit, and
          // loadWorkspaces() below refreshes the list so the new tile
          // appears without them having to re-login.
          const password = watch('password')
          try {
            if (!accountToken && password) {
              const resp = await api.post('/v1/accounts/auth/login', {
                email, password,
              })
              setAccountAuth(resp.accessToken, resp.account, resp.workspaces)
            } else if (accountToken) {
              // Refresh workspaces so the newly-created one shows up on /workspaces.
              await loadWorkspaces().catch(() => {})
            }
          } catch (loginErr) {
            // Login failed for some reason (rare — the account was just
            // created). Fall back to opening the workspace's own login
            // page so the user can proceed manually.
            const url = workspaceLoginUrl(s.subdomain, email, s.workspaceUrl)
            window.open(url, '_blank', 'noopener,noreferrer')
            navigate('/login?next=/workspaces')
            return
          }
          setWaitingForMandate(false)
          navigate('/workspaces')
          return
          // NOTE: intentionally NOT opening the workspace subdomain in a new
          // tab here — /workspaces has a "Launch workspace" action per tile
          // that JIT-mints a workspace token, which is the safer entry point.
        } else if (s.status === 'FAILED' || s.status === 'EXPIRED' || s.status === 'CANCELLED') {
          clearInterval(iv)
          setWaitingForMandate(false)
          setError(s.failureReason || `Signup ${s.status.toLowerCase()}. Please try again.`)
        }
      } catch {
        // network blip — keep polling
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSignupId, waitingForMandate])

  // -- render ---------------------------------------------------------------
  // Field chrome is one step tighter than the marketing default: the whole
  // card has to clear a 900px viewport with the site header on top. This is
  // sizing only — field names, validation and the submit payload are unchanged.
  const inputCls = (err: boolean) =>
    `w-full pl-9 pr-3 py-2.5 text-sm font-body text-text-primary placeholder:text-text-tertiary bg-white outline-none rounded-xl border transition-all ${
      err ? 'border-danger ring-2 ring-danger/10' : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/10'
    }`

  const [showTaxDetails, setShowTaxDetails] = useState(false)

  // -- mandate-overlay a11y (teammate's B12, ported): Escape closes, backdrop
  // click closes, focus stays trapped inside. Cancelling from Escape/backdrop
  // tears down the pending signup the same way the visible "Cancel and edit
  // my details" button does (release the subdomain reservation + kill the
  // Razorpay subscription) so the next submit doesn't collide.
  const mandateDialogRef = useRef<HTMLDivElement | null>(null)
  const cancelMandateOverlay = async () => {
    const id = pendingSignupId
    setWaitingForMandate(false)
    setPendingSignupId(null)
    if (id) await cancelPending(id)
  }
  useEffect(() => {
    if (!waitingForMandate) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void cancelMandateOverlay()
        return
      }
      if (e.key !== 'Tab') return
      const root = mandateDialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    // Move initial focus into the dialog so the trap has something to hold.
    const first = mandateDialogRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForMandate])

  // B4 anti-enumeration success screen — see setCheckInboxSuccess call sites.
  // Rendered BEFORE any other page state so that a claimed-email response
  // looks identical to a real signup: no /workspaces navigation, no Razorpay
  // popup, no login flash, just a generic "check your inbox" surface. Do not
  // add any branch here that depends on whether the workspace was actually
  // created — that would re-open the leak.
  if (checkInboxSuccess) {
    return (
      <div className="min-h-screen bg-bg">
        <Navbar />
        <section className="pt-32 pb-24 max-w-2xl mx-auto px-4 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-6">
            <Sparkles size={22} className="text-primary" />
          </div>
          <h1 className="font-heading font-extrabold text-text-primary mb-3"
              style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', letterSpacing: '-0.02em' }}>
            Check your inbox
          </h1>
          <p className="text-base text-text-secondary max-w-md mx-auto mb-8">
            We&rsquo;ve sent a next-steps email to <strong>{submittedEmail}</strong>. Open
            it to finish setting up your workspace. If you don&rsquo;t see it in a few
            minutes, check your spam folder.
          </p>
          <button
            onClick={() => { setCheckInboxSuccess(false); setSubmittedEmail('') }}
            className="text-sm text-primary hover:underline"
          >
            Use a different email
          </button>
        </section>
      </div>
    )
  }

  // Value proposition for the dark panel — copy only.
  const panelPoints = mode === 'trial'
    ? [
        'Your workspace is live in seconds — no card, no sales call.',
        `Pick your modules and start the ${TRIAL_DAYS}-day trial from inside.`,
        'HR, attendance, payroll, accounting, inventory and CRM on one core.',
      ]
    : [
        'Autopay is authorised once and your modules activate immediately.',
        'Add or drop modules any time — billing follows the change.',
        'HR, attendance, payroll, accounting, inventory and CRM on one core.',
      ]

  return (
    <div className="surface-soft min-h-screen lg:h-screen lg:overflow-hidden">
      {/* The right half of this page is white at scroll-top, so the header's
          floating white-on-dark variant would be invisible. Force the solid bar. */}
      <Navbar tone="light" />

      {/* Waiting-for-mandate overlay */}
      <AnimatePresence>
        {waitingForMandate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
            onClick={() => { void cancelMandateOverlay() }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mandate-title"
          >
            <div
              ref={mandateDialogRef}
              className="premium-card p-10 max-w-md w-full text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-full bg-primary-light mx-auto mb-5 flex items-center justify-center">
                <Loader2 size={26} className="text-primary animate-spin" />
              </div>
              <h2 id="mandate-title" className="font-heading font-bold text-text-primary text-xl mb-2">
                Waiting for mandate approval…
              </h2>
              <p className="text-text-secondary text-sm mb-6">
                We opened Razorpay in a new tab. Complete the autopay authorisation
                there and we'll take you into your workspace automatically.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => checkoutTab?.focus()}
                  className="rounded-xl bg-primary text-white font-body font-semibold py-3 hover:bg-primary-dark"
                >
                  I'm on the Razorpay tab → focus it
                </button>
                <button
                  onClick={async () => {
                    // Tell the backend to cancel the Razorpay subscription
                    // and release the subdomain reservation BEFORE we close
                    // the overlay — otherwise the next submit collides.
                    const id = pendingSignupId
                    setWaitingForMandate(false)
                    setPendingSignupId(null)
                    if (id) await cancelPending(id)
                  }}
                  className="text-xs font-semibold text-text-primary hover:text-primary underline underline-offset-2 py-2"
                >
                  Cancel and edit my details
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Centred-card signup — the same composition as /login.

        One rounded-3xl card floats on the surface-soft ground with breathing
        room on all four sides: sapling photo pane left, form pane right, both
        inside the card. On lg+ the card takes a definite height (viewport
        minus header and margins, capped) so when the optional tax panel is
        opened the FORM PANE scrolls internally — the page itself never
        scrolls. Below lg the photo collapses to a short banner above the
        form (exactly like login) and the page scrolls normally.
      */}
      <main className="flex min-h-screen flex-col px-4 pb-10 pt-20 sm:px-6 lg:h-screen lg:min-h-0 lg:pb-6 lg:pt-24">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="m-auto w-full max-w-6xl"
        >
          <div className="grid overflow-hidden rounded-3xl border border-border bg-surface shadow-card-hover lg:h-[min(50rem,calc(100vh-7.5rem))] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">

            {/* ── Photo pane — the client-supplied sapling photograph ────
                Copy sits over the dark soil at the image's bottom, behind a
                deep-emerald scrim; the bright bokeh top stays text-free.
                Below lg the pane collapses to a short banner above the form. */}
            <div className="relative h-28 sm:h-44 lg:h-auto">
              <img
                src="/assets/signup.jpg"
                alt="A young sapling growing from dark soil"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(3,43,32,0.30) 0%, rgba(3,43,32,0.04) 24%, rgba(2,26,19,0.22) 42%, rgba(2,26,19,0.82) 60%, rgba(2,26,19,0.97) 100%)',
                }}
              />
              <span aria-hidden className="grain grain-dark" />
              <div className="absolute inset-x-0 bottom-0 z-10 p-6 lg:p-8">
                <Eyebrow>{mode === 'trial' ? 'Free workspace' : 'Paid workspace'}</Eyebrow>

                {/* opsz tracks the rendered size — Bricolage is an optical-size
                    variable font and .font-heading otherwise pins it at 96. */}
                <h1
                  className="mt-3 max-w-xs font-heading text-[19px] font-bold leading-[1.15] tracking-tight text-white lg:text-[22px]"
                  style={{ fontVariationSettings: "'opsz' 32" }}
                >
                  {mode === 'trial'
                    ? <>Start free.<br />Grow into the rest.</>
                    : <>One workspace.<br />Every module you activate.</>}
                </h1>

                <ul className="mt-4 hidden space-y-2 lg:block">
                  {panelPoints.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-[13px] font-body leading-snug text-white/85">
                      <Check size={14} className="mt-0.5 flex-shrink-0 text-lime" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>

                {/* PAID only, lg only — below lg the same summary renders
                    inside the form pane, where the cycle toggle stays
                    reachable. See the note on <PlanSummary />. */}
                {mode === 'paid' && (
                  <div className="mt-4 hidden lg:block">
                    <PlanSummary
                      tone="dark" planNames={chosenPlanNames} total={chargeTotal}
                      unit={cycleUnit} seats={seats} cycle={billingCycle} onCycle={setBillingCycle}
                    />
                  </div>
                )}

                <p className="mt-4 hidden text-[12px] leading-snug text-white/55 lg:block">
                  {mode === 'trial'
                    ? 'Free workspace, no card required. Add paid modules and set up autopay inside your workspace when you\'re ready.'
                    : 'Payments and autopay mandates are handled by Razorpay. We never see your card.'}
                </p>
              </div>
            </div>

            {/* ── Form pane ─────────────────────────────────────────────── */}
            <div className="flex min-w-0 lg:overflow-y-auto">
              {/* `m-auto` rather than justify/items-center: a centred flex child
                  inside an overflow container clips its own top when it grows. */}
              <div className="m-auto w-full p-5 sm:p-8 lg:px-9 lg:py-6">

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div>
                <h2
                  className="font-heading text-[21px] font-bold leading-tight tracking-tight text-text-primary sm:text-[23px]"
                  style={{ fontVariationSettings: "'opsz' 24" }}
                >
                  {mode === 'trial' ? 'Create your free workspace' : 'Create your workspace'}
                </h2>
                {/* Hidden from lg up: the dark panel already carries this
                    message there, and the card needs the vertical room. */}
                <p className="mt-1 text-[12.5px] leading-snug text-text-secondary lg:hidden">
                  {mode === 'trial'
                    ? 'Instant setup, no card required.'
                    : 'Choose your team size and pay securely to activate instantly.'}
                </p>
              </div>

              {/* Google SSO — only makes sense when the visitor is not already
                  signed in. When they are, the account layer above already
                  handled auth and this form is only creating a fresh workspace
                  under that account, so the Google button would be a dead-end. */}
              {!accountToken && (
                <>
                  <button
                    type="button"
                    onClick={() => window.location.assign(GOOGLE_OAUTH_START_URL)}
                    aria-label="Continue with Google"
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white py-2.5 font-body text-sm font-semibold text-text-primary transition-colors hover:bg-bg/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10.5px] font-body font-semibold uppercase tracking-wider text-text-tertiary">or sign up with email</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-danger/10 border border-danger/20 text-[13px] text-danger">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Plan summary — PAID only, and only below lg: from lg up the
                  same summary sits on the dark panel where there is room for
                  it. See the note on <PlanSummary />. */}
              {mode === 'paid' && (
                <div className="lg:hidden">
                  <PlanSummary
                    tone="light" planNames={chosenPlanNames} total={chargeTotal}
                    unit={cycleUnit} seats={seats} cycle={billingCycle} onCycle={setBillingCycle}
                  />
                </div>
              )}

              {/* Basic identity — paired on desktop, stacked below lg */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Field label="First and Last Name" required icon={<User size={15} />} error={errors.adminName?.message}>
                  <input {...register('adminName')} placeholder="Your full name" className={inputCls(!!errors.adminName)} />
                </Field>

                <Field label="Company Name" required icon={<Building size={15} />} error={errors.companyName?.message}>
                  <input {...register('companyName')} placeholder="Your company name" className={inputCls(!!errors.companyName)} />
                </Field>
              </div>

              {/* Email + Phone */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Field label="Email Address" required icon={<Mail size={15} />} error={errors.adminEmail?.message}>
                  <input
                    {...register('adminEmail')}
                    type="email"
                    placeholder="you@company.com"
                    disabled={!!accountToken}
                    className={`${inputCls(!!errors.adminEmail)} ${accountToken ? 'bg-slate-50 cursor-not-allowed text-text-secondary' : ''}`}
                  />
                </Field>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] font-body font-semibold leading-4 text-text-primary">Phone Number</label>
                  {/* PhoneField is shared with other forms, so its own padding
                      is nudged from here rather than edited at the source —
                      this keeps it the same height as the inputs beside it. */}
                  <PhoneField
                    className="[&_button]:!py-2.5 [&_input]:!py-2.5"
                    value={watch('adminMobile') || ''}
                    onChange={(v) => setValue('adminMobile', v, { shouldValidate: true, shouldDirty: true })}
                    error={errors.adminMobile?.message}
                  />
                  {errors.adminMobile && <span className="text-danger text-[11px]">{errors.adminMobile.message}</span>}
                </div>
              </div>

              {/* Subdomain — full width */}
              <div>
                <label className="text-[12px] font-body font-semibold leading-4 text-text-primary mb-1 block">
                  Your workspace domain
                </label>
                <div className="px-3 py-2 bg-bg rounded-xl border border-border">
                  <div className="flex items-center gap-1">
                    {isEditingSubdomain ? (
                      <input
                        {...register('subdomain')}
                        onBlur={() => { subdomainTouched.current = true; setIsEditingSubdomain(false) }}
                        autoFocus
                        className="flex-1 min-w-0 text-[15px] font-heading font-bold bg-white border border-primary rounded-lg px-2.5 py-1 outline-none"
                      />
                    ) : (
                      <button type="button"
                              onClick={() => setIsEditingSubdomain(true)}
                              className="flex-1 min-w-0 text-left flex items-center gap-2">
                        <span className="truncate text-[15px] font-heading font-bold text-primary bg-primary-light/60 px-2.5 py-1 rounded-lg">
                          {subdomainValue || 'yourcompany'}
                        </span>
                        <span className="text-[13px] text-text-secondary font-body font-semibold">.unifiedtree.com</span>
                        <Edit2 size={13} className="flex-shrink-0 text-text-tertiary" />
                      </button>
                    )}
                  </div>
                  {availability.state === 'taken' && (
                    <p className="text-[11px] text-danger mt-1 flex items-center gap-1"><XIcon size={11} /> {availability.reason}</p>
                  )}
                  {availability.state === 'available' && (
                    <p className="text-[11px] text-primary mt-1 flex items-center gap-1 font-semibold"><Check size={11} /> Available</p>
                  )}
                </div>
                {errors.subdomain && <span className="text-danger text-[11px] mt-1 block">{errors.subdomain.message}</span>}
              </div>

              {/* Password (hidden when signed in) */}
              {!accountToken && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Field label="Password" required icon={<Lock size={15} />} error={errors.password?.message}>
                    <input {...register('password')} type="password" placeholder="Create a password" className={inputCls(!!errors.password)} />
                  </Field>
                  <Field label="Confirm Password" required icon={<Lock size={15} />} error={errors.confirmPassword?.message}>
                    <input {...register('confirmPassword')} type="password" placeholder="Repeat password" className={inputCls(!!errors.confirmPassword)} />
                  </Field>
                </div>
              )}

              {/* Seats (PAID only — TRIAL picks seats per-module inside the workspace) + Country */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {mode !== 'trial' && (
                  <Field label="Number of Users" required icon={<Users size={15} />} error={errors.seats?.message}>
                    <input {...register('seats', { valueAsNumber: true })} type="number" min={1} className={inputCls(!!errors.seats)} />
                  </Field>
                )}
                <Field label="Country" required icon={<Globe size={15} />} error={errors.country?.message}>
                  <select {...register('country')} className={inputCls(!!errors.country)}>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              {/* Optional company / tax details */}
              <div>
                <button type="button" onClick={() => setShowTaxDetails((v) => !v)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${showTaxDetails ? 'border-primary/30 bg-primary-light' : 'border-primary/15 bg-primary-light/60 hover:border-primary/30 hover:bg-primary-light'}`}>
                  <Receipt size={14} className="flex-shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-primary">
                    Add tax / billing details
                    <span className="hidden font-normal text-text-secondary sm:inline"> — PAN, GSTIN &amp; billing address</span>
                  </span>
                  <span className="flex-shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">Optional</span>
                  {showTaxDetails ? <ChevronUp size={14} className="text-primary" /> : <ChevronDown size={14} className="text-primary" />}
                </button>
                {showTaxDetails && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
                    <Field label="PAN"><input {...register('pan')} placeholder="ABCDE1234F" className={inputCls(false)} /></Field>
                    <Field label="GSTIN"><input {...register('gstin')} placeholder="29ABCDE1234F1Z5" className={inputCls(false)} /></Field>
                    <Field label="Address Line 1"><input {...register('addressLine1')} className={inputCls(false)} /></Field>
                    <Field label="Address Line 2"><input {...register('addressLine2')} className={inputCls(false)} /></Field>
                    <Field label="City"><input {...register('city')} className={inputCls(false)} /></Field>
                    <Field label="State"><input {...register('state')} className={inputCls(false)} /></Field>
                    <Field label="Postal Code"><input {...register('postalCode')} className={inputCls(false)} /></Field>
                  </div>
                )}
              </div>

              {/* Submit. The legal note sits BELOW the button so the button
                  itself stays as high up the card as possible. */}
              <div className="border-t border-border pt-3">
                <button
                  type="submit"
                  disabled={loading || availability.state === 'taken'}
                  className="w-full rounded-xl bg-primary text-white font-body font-bold py-3 hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-colors flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {mode === 'trial'
                    ? (loading ? 'Creating your workspace…' : 'Create Free Workspace')
                    : (loading ? 'Opening Razorpay…' : `Pay ₹${chargeTotal.toLocaleString('en-IN')}/${billingCycle === 'annual' ? 'yr' : 'mo'} & Create Workspace`)}
                  {!loading && <ArrowRight size={16} />}
                </button>
                <p className="text-[11px] leading-snug text-text-tertiary text-center mt-2">
                  By continuing you accept our <a href="/terms" className="font-semibold underline">Subscription Agreement</a> and{' '}
                  <a href="/privacy" className="font-semibold underline">Privacy Policy</a>.
                  {mode === 'trial'
                    ? ` No card required — your ${TRIAL_DAYS}-day trial starts when you unlock modules inside the workspace.`
                    : ' Autopay activates today with immediate first charge. Secured by Razorpay.'}
                </p>
                <p className="text-center text-[12.5px] text-text-secondary mt-2">
                  {accountToken
                    ? <>Adding a workspace to your account? <Link to="/workspaces" className="font-semibold text-primary">See your workspaces</Link></>
                    : <>Already have an account? <Link to="/login" className="font-semibold text-primary">Sign in</Link></>}
                </p>
              </div>
            </form>

              </div>
            </div>

          </div>
        </motion.div>
      </main>
    </div>
  )
}

// -- small helpers -----------------------------------------------------------

/**
 * Compact plan + billing-cycle summary (PAID only).
 *
 * Rendered TWICE and gated by CSS so exactly one copy is ever visible: on the
 * dark panel from lg up, inside the card below lg. It has to exist at every
 * breakpoint because the Monthly/Annual toggle writes `billingCycle`, which is
 * part of the submit payload — the old desktop-only sidebar left phone users
 * unable to switch cycle at all.
 */
function PlanSummary({
  tone, planNames, total, unit, seats, cycle, onCycle,
}: {
  tone: 'light' | 'dark'
  planNames: string
  total: number
  unit: number
  seats: number
  cycle: 'monthly' | 'annual'
  onCycle: (c: 'monthly' | 'annual') => void
}) {
  const dark = tone === 'dark'
  const active = dark ? 'bg-lime text-primary-darker' : 'bg-primary text-white'
  const idle   = dark ? 'text-white/70 hover:text-white' : 'text-text-secondary'

  return (
    <div className={dark
      ? 'rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3'
      : 'rounded-xl border border-primary/20 bg-primary-light/70 px-3 py-2.5'}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[10px] font-body font-bold uppercase tracking-wider ${dark ? 'text-lime/70' : 'text-primary-dark/70'}`}>
            Your plan
          </p>
          <p className={`truncate text-[13px] font-semibold ${dark ? 'text-white' : 'text-text-primary'}`}>
            {planNames || 'No modules selected'}
          </p>
        </div>
        <p className={`flex-shrink-0 font-heading text-lg font-bold leading-none ${dark ? 'text-lime' : 'text-primary'}`}>
          ₹{total.toLocaleString('en-IN')}
          <span className={`text-[11px] font-normal ${dark ? 'text-white/60' : 'text-text-secondary'}`}>
            /{cycle === 'annual' ? 'yr' : 'mo'}
          </span>
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className={`inline-flex rounded-lg p-0.5 ${dark ? 'bg-black/25' : 'bg-white'}`}>
          <button type="button" onClick={() => onCycle('monthly')}
                  className={`rounded px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${cycle === 'monthly' ? active : idle}`}>
            Monthly
          </button>
          <button type="button" onClick={() => onCycle('annual')}
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${cycle === 'annual' ? active : idle}`}>
            Annual
            <span className={`rounded-full px-1 py-px text-[9px] font-bold ${
              cycle === 'annual'
                ? (dark ? 'bg-primary-darker text-lime' : 'bg-lime text-primary')
                : (dark ? 'bg-lime/20 text-lime' : 'bg-lime/30 text-primary-dark')
            }`}>−10%</span>
          </button>
        </div>
        <span className={`text-[11.5px] ${dark ? 'text-white/55' : 'text-text-tertiary'}`}>
          ₹{unit}/user · {seats} {seats === 1 ? 'user' : 'users'}
        </span>
        <Link to="/pricing"
              className={`ml-auto flex-shrink-0 text-[11.5px] font-semibold ${dark ? 'text-lime hover:text-white' : 'text-primary hover:text-primary-dark'}`}>
          Change
        </Link>
      </div>
    </div>
  )
}

// A11y (teammate's B12, ported into the compact one-screen styling): every
// Field generates a stable useId + wires it as htmlFor on the label and
// id/aria-invalid/aria-describedby on the input child via React.cloneElement,
// so screen readers announce the label + error together. `required` visibly
// marks the field with a red asterisk AND an sr-only "required" span (screen
// readers don't read `*` reliably).
function Field({
  label, icon, error, required, children,
}: {
  label: string
  icon?: React.ReactNode
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  const reactId = useId()
  const fieldId = `f-${reactId}`
  const errorId = `${fieldId}-err`
  const isValidElement = (n: React.ReactNode): n is React.ReactElement<Record<string, unknown>> =>
    !!n && typeof n === 'object' && 'props' in (n as object)
  const enhanced = isValidElement(children)
    ? React.cloneElement(children, {
        id: fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
        required: required || (children.props.required as boolean | undefined),
      })
    : children
  return (
    <div>
      <label htmlFor={fieldId} className="text-[12px] font-body font-semibold leading-4 text-text-primary mb-1 block">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-danger ml-0.5">*</span>
            <span className="sr-only"> required</span>
          </>
        )}
      </label>
      <div className="relative">
        {icon && <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary">{icon}</div>}
        {enhanced}
      </div>
      {error && <span id={errorId} className="text-danger text-[11px] mt-1 block">{error}</span>}
    </div>
  )
}
