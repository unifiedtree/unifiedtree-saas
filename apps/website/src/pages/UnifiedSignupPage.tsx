import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, User, Building, Mail, Lock, Globe, Languages, Users, Target,
  Edit2, Sparkles, Check, X as XIcon, AlertCircle, ChevronDown, ChevronUp,
  Receipt, ArrowRight,
} from 'lucide-react'
import { usePricingStore } from '../store/pricingStore'
import { useAuthStore } from '../store/authStore'
import { useModulePlans, effectiveUnit, type ModulePlan } from '../lib/plans'
import { API_BASE_URL } from '../lib/api'
import { friendlyServerError } from '../lib/errors'
import { Navbar } from '../components/layout/Navbar'
import { COUNTRIES } from '../data/countries'
import { PhoneField } from '../components/forms/PhoneField'
import { useSubdomainAvailability } from '../lib/subdomainCheck'

// -- constants -------------------------------------------------------------
const DEV_PLATFORM_PORT = (import.meta.env.VITE_PLATFORM_PORT as string | undefined) || '3001'
const TRIAL_DAYS = 7
const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 30 * 60 * 1000   // give up after 30 min of polling

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
  language: z.string().min(1, 'Language is required'),
  primaryInterest: z.string().min(1, 'Interest is required'),
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

  const modeParam = (searchParams.get('mode') || 'paid').toLowerCase()
  const initialMode: 'trial' | 'paid' = modeParam === 'trial' ? 'trial' : 'paid'
  const [mode, setMode] = useState<'trial' | 'paid'>(initialMode)

  const accountToken   = useAuthStore((s) => s.accountToken)
  const account        = useAuthStore((s) => s.account)
  const workspaces     = useAuthStore((s) => s.workspaces)
  const loadWorkspaces = useAuthStore((s) => s.loadWorkspaces)

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
      language: 'English',
      primaryInterest: 'Use it in my company',
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

  const onSubmit = async (data: SignupData) => {
    setError('')
    setLoading(true)
    try {
      const planKeys = chosenPlans.map((p) => p.key)
      if (planKeys.length === 0) {
        throw new Error('Please pick at least one module for your workspace.')
      }
      // Require password only when NOT signed in.
      if (!accountToken && (!data.password || data.password.length < 8)) {
        throw new Error('Password is required (min 8 characters).')
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
        language:       data.language,
        primaryInterest: data.primaryInterest,
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
          const url = workspaceLoginUrl(s.subdomain, email, s.workspaceUrl)
          window.open(url, '_blank', 'noopener,noreferrer')
          navigate('/')
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
  const inputCls = (err: boolean) =>
    `w-full pl-11 pr-4 py-3 text-sm font-body text-text-primary placeholder:text-text-tertiary bg-white outline-none rounded-xl border transition-all ${
      err ? 'border-danger ring-2 ring-danger/10' : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/10'
    }`

  const [showTaxDetails, setShowTaxDetails] = useState(false)

  const trialSubline = useMemo(() => {
    if (mode !== 'trial') return null
    if (chargeTotal === 0) {
      return `Free for ${TRIAL_DAYS} days. Autopay activates after — you can cancel anytime.`
    }
    const cycleLabel = billingCycle === 'annual' ? 'year' : 'month'
    const amount = billingCycle === 'annual' ? perUserAnnual * seats * 12 : perUser * seats
    return `You won't be charged today. Autopay of ₹${amount.toLocaleString('en-IN')}/${cycleLabel} starts after your ${TRIAL_DAYS}-day trial.`
  }, [mode, billingCycle, chargeTotal, perUser, perUserAnnual, seats])

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      {/* Hero band */}
      <section className="pt-32 pb-8 hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-[0.1em] text-white/70 bg-white/[0.08] border border-white/10 mb-4">
              {mode === 'trial' ? <><Sparkles size={12} /> 7-day free trial</> : <><Receipt size={12} /> Paid workspace</>}
            </span>
            <h1 className="font-heading font-extrabold text-white mb-3"
                style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {mode === 'trial' ? 'Start your free trial' : 'Create your workspace'}
            </h1>
            <p className="text-base text-white/75 font-body max-w-xl mx-auto">
              {mode === 'trial'
                ? 'Set up your workspace instantly. Autopay activates after 7 days — no charge today.'
                : 'Pick your modules, choose your team size, and pay securely to activate instantly.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Waiting-for-mandate overlay */}
      <AnimatePresence>
        {waitingForMandate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <div className="premium-card p-10 max-w-md w-full text-center">
              <div className="w-14 h-14 rounded-full bg-primary-light mx-auto mb-5 flex items-center justify-center">
                <Loader2 size={26} className="text-primary animate-spin" />
              </div>
              <h2 className="font-heading font-bold text-text-primary text-xl mb-2">
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
                  onClick={() => { setWaitingForMandate(false); setPendingSignupId(null) }}
                  className="text-xs text-text-tertiary hover:text-text-secondary py-2"
                >
                  Cancel and edit my details
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <section className="py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8">

            <form onSubmit={handleSubmit(onSubmit)} className="premium-card p-8 space-y-5">
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Basic identity */}
              <Field label="First and Last Name" icon={<User size={18} />} error={errors.adminName?.message}>
                <input {...register('adminName')} placeholder="John Doe" className={inputCls(!!errors.adminName)} />
              </Field>

              <Field label="Company Name" icon={<Building size={18} />} error={errors.companyName?.message}>
                <input {...register('companyName')} placeholder="Acme Corp" className={inputCls(!!errors.companyName)} />
              </Field>

              {/* Subdomain */}
              <div>
                <label className="text-sm font-body font-semibold text-text-primary mb-1.5 block">
                  Your workspace domain
                </label>
                <div className="p-4 bg-bg rounded-xl border border-border">
                  <div className="flex items-center gap-1">
                    {isEditingSubdomain ? (
                      <input
                        {...register('subdomain')}
                        onBlur={() => { subdomainTouched.current = true; setIsEditingSubdomain(false) }}
                        autoFocus
                        className="flex-1 text-lg font-heading font-bold bg-white border border-primary rounded-lg px-3 py-1 outline-none"
                      />
                    ) : (
                      <button type="button"
                              onClick={() => setIsEditingSubdomain(true)}
                              className="flex-1 text-left flex items-center gap-2">
                        <span className="text-lg font-heading font-bold text-primary bg-primary-light/60 px-3 py-1 rounded-lg">
                          {subdomainValue || 'yourcompany'}
                        </span>
                        <span className="text-text-secondary font-body font-semibold">.unifiedtree.com</span>
                        <Edit2 size={14} className="text-text-tertiary" />
                      </button>
                    )}
                  </div>
                  {availability.state === 'taken' && (
                    <p className="text-xs text-danger mt-2 flex items-center gap-1"><XIcon size={12} /> {availability.reason}</p>
                  )}
                  {availability.state === 'available' && (
                    <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1"><Check size={12} /> Available</p>
                  )}
                </div>
                {errors.subdomain && <span className="text-danger text-xs mt-1 block">{errors.subdomain.message}</span>}
              </div>

              {/* Email + Phone */}
              <div className="grid md:grid-cols-2 gap-5">
                <Field label="Email Address" icon={<Mail size={18} />} error={errors.adminEmail?.message}>
                  <input
                    {...register('adminEmail')}
                    type="email"
                    placeholder="you@company.com"
                    disabled={!!accountToken}
                    className={`${inputCls(!!errors.adminEmail)} ${accountToken ? 'bg-slate-50 cursor-not-allowed text-text-secondary' : ''}`}
                  />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-body font-semibold text-text-primary">Phone Number</label>
                  <PhoneField
                    value={watch('adminMobile') || ''}
                    onChange={(v) => setValue('adminMobile', v, { shouldValidate: true, shouldDirty: true })}
                    error={errors.adminMobile?.message}
                  />
                  {errors.adminMobile && <span className="text-danger text-xs">{errors.adminMobile.message}</span>}
                </div>
              </div>

              {/* Password (hidden when signed in) */}
              {!accountToken && (
                <div className="grid md:grid-cols-2 gap-5">
                  <Field label="Password" icon={<Lock size={18} />} error={errors.password?.message}>
                    <input {...register('password')} type="password" placeholder="Create a password" className={inputCls(!!errors.password)} />
                  </Field>
                  <Field label="Confirm Password" icon={<Lock size={18} />} error={errors.confirmPassword?.message}>
                    <input {...register('confirmPassword')} type="password" placeholder="Repeat password" className={inputCls(!!errors.confirmPassword)} />
                  </Field>
                </div>
              )}

              {/* Seats + Country */}
              <div className="grid md:grid-cols-2 gap-5">
                <Field label="Number of Users" icon={<Users size={18} />} error={errors.seats?.message}>
                  <input {...register('seats', { valueAsNumber: true })} type="number" min={1} className={inputCls(!!errors.seats)} />
                </Field>
                <Field label="Country" icon={<Globe size={18} />} error={errors.country?.message}>
                  <select {...register('country')} className={inputCls(!!errors.country)}>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              {/* Language + Interest */}
              <div className="grid md:grid-cols-2 gap-5">
                <Field label="Language" icon={<Languages size={18} />} error={errors.language?.message}>
                  <select {...register('language')} className={inputCls(!!errors.language)}>
                    <option>English</option><option>Hindi</option><option>Tamil</option><option>Telugu</option>
                  </select>
                </Field>
                <Field label="Primary Interest" icon={<Target size={18} />} error={errors.primaryInterest?.message}>
                  <select {...register('primaryInterest')} className={inputCls(!!errors.primaryInterest)}>
                    <option>Use it in my company</option>
                    <option>Evaluate for a client</option>
                    <option>Just exploring</option>
                  </select>
                </Field>
              </div>

              {/* Optional company / tax details */}
              <div className="border-t border-border pt-4">
                <button type="button" onClick={() => setShowTaxDetails((v) => !v)}
                        className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors">
                  {showTaxDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  Add tax / billing details (optional)
                </button>
                {showTaxDetails && (
                  <div className="grid md:grid-cols-2 gap-4 mt-4">
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

              <div className="border-t border-border pt-5">
                <p className="text-xs text-text-tertiary text-center mb-4">
                  By continuing you accept our <a href="/terms" className="font-semibold underline">Subscription Agreement</a> and{' '}
                  <a href="/privacy" className="font-semibold underline">Privacy Policy</a>.
                  {mode === 'trial'
                    ? ' You won\'t be charged during the 7-day trial.'
                    : ' Autopay activates today with immediate first charge.'}
                </p>
                <button
                  type="submit"
                  disabled={loading || availability.state === 'taken'}
                  className="w-full rounded-xl bg-primary text-white font-body font-bold py-4 hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-colors flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {mode === 'trial'
                    ? (loading ? 'Setting up mandate…' : 'Pay ₹0 & Start 7-day Free Trial')
                    : (loading ? 'Opening Razorpay…' : `Pay ₹${chargeTotal.toLocaleString('en-IN')}/${billingCycle === 'annual' ? 'yr' : 'mo'} & Create Workspace`)}
                  {!loading && <ArrowRight size={16} />}
                </button>
                {trialSubline && (
                  <p className="text-xs text-text-secondary text-center mt-3">{trialSubline}</p>
                )}
                <p className="text-center text-sm text-text-secondary mt-4">
                  {accountToken
                    ? <>Adding a workspace to your account? <Link to="/workspaces" className="font-semibold text-primary">See your workspaces</Link></>
                    : <>Already have an account? <Link to="/login" className="font-semibold text-primary">Sign in</Link></>}
                </p>
              </div>
            </form>

            {/* Right sidebar */}
            <aside className="space-y-5">
              <div className="premium-card p-6 sticky top-24">
                <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                  Your plan
                </p>
                <h3 className="font-heading font-bold text-primary text-lg mb-4">
                  {chosenPlanNames || 'No modules selected'}
                </h3>

                {/* Cycle toggle (used for both trial and paid: sets the recurring cadence) */}
                <div className="inline-flex bg-bg rounded-lg p-1 mb-4 w-full">
                  <button type="button" onClick={() => setBillingCycle('monthly')}
                          className={`flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${billingCycle === 'monthly' ? 'bg-primary text-white' : 'text-text-secondary'}`}>
                    Monthly
                  </button>
                  <button type="button" onClick={() => setBillingCycle('annual')}
                          className={`flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${billingCycle === 'annual' ? 'bg-primary text-white' : 'text-text-secondary'}`}>
                    Annual <span className="text-lime-400">save</span>
                  </button>
                </div>

                <div className="space-y-2 text-sm mb-4">
                  <Row k="Per user / month" v={`₹${cycleUnit}`} />
                  <Row k="Users" v={String(seats)} />
                  {mode === 'trial' ? (
                    <>
                      <div className="border-t border-border pt-2 mt-2" />
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary text-xs">Today</span>
                        <span className="font-heading font-bold text-emerald-600 text-2xl">₹0</span>
                      </div>
                      <p className="text-[11px] text-text-tertiary leading-snug">
                        Autopay of ₹{(billingCycle === 'annual' ? perUserAnnual * seats * 12 : perUser * seats).toLocaleString('en-IN')} / {billingCycle === 'annual' ? 'yr' : 'mo'} begins after your {TRIAL_DAYS}-day trial.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="border-t border-border pt-2 mt-2" />
                      <div className="flex items-center justify-between">
                        <span className="text-text-secondary">Total {billingCycle === 'annual' ? 'per year' : 'per month'}</span>
                        <span className="font-heading font-bold text-primary text-2xl">
                          ₹{chargeTotal.toLocaleString('en-IN')}<span className="text-sm text-text-secondary">/{billingCycle === 'annual' ? 'yr' : 'mo'}</span>
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <Link to="/pricing" className="block text-center rounded-xl border border-border py-2.5 text-sm font-body font-semibold text-text-secondary hover:border-primary hover:text-primary">
                  Change modules
                </Link>
                <p className="text-[11px] text-text-tertiary text-center mt-3">Secured by Razorpay.</p>
              </div>
            </aside>

          </div>
        </div>
      </section>
    </div>
  )
}

// -- small helpers -----------------------------------------------------------
function Field({ label, icon, error, children }: { label: string; icon?: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-body font-semibold text-text-primary mb-1.5 block">{label}</label>
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">{icon}</div>}
        {children}
      </div>
      {error && <span className="text-danger text-xs mt-1 block">{error}</span>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{k}</span>
      <span className="font-body font-semibold text-text-primary">{v}</span>
    </div>
  )
}
