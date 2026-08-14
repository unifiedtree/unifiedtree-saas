import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, useReducedMotion } from 'framer-motion'
import { Eye, EyeOff, Loader2, Check, Mail, Lock } from 'lucide-react'
import { api } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Navbar } from '../components/layout/Navbar'
import { Eyebrow } from '../components/marketing/PageHero'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  remember: z.boolean().optional(),
})

type FormData = z.infer<typeof schema>

const trustPoints = [
  'Offline-first — works without internet',
  'GST-compliant invoicing & payroll',
  'Bank-grade encryption (AES-256)',
]

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const initialEmail = searchParams.get('email') ?? ''
  const createdWorkspace = searchParams.get('created') === '1'
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  // Forgot-password modal state. Backend POST /v1/auth/forgot-password
  // resolves the workspace from the email and queues a reset email; it
  // always returns 200 (no email-existence leak).
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSending, setForgotSending] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')

  const openForgot = (prefill?: string) => {
    setForgotEmail(prefill ?? initialEmail ?? '')
    setForgotError('')
    setForgotSent(false)
    setForgotOpen(true)
  }
  const closeForgot = () => {
    if (forgotSending) return
    setForgotOpen(false)
  }

  // A11y (teammate's B12, ported through the layout redesign): Escape closes
  // the modal + focus-trap keeps Tab inside the dialog. The overlay handles
  // backdrop clicks via onClick={closeForgot} (children stopPropagation), and
  // the email input carries autoFocus so initial focus lands inside.
  const forgotDialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!forgotOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeForgot()
        return
      }
      if (e.key !== 'Tab') return
      const root = forgotDialogRef.current
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
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Restore focus to the trigger that opened the modal.
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forgotOpen, forgotSending])

  const submitForgot = async () => {
    const email = forgotEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForgotError('Enter a valid email address.')
      return
    }
    setForgotSending(true)
    setForgotError('')
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')}/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // 200 even when email doesn't exist (intentional no-leak). Treat any
      // non-network response as success from the user's perspective.
      if (!res.ok && res.status >= 500) {
        throw new Error(`Server error (${res.status})`)
      }
      setForgotSent(true)
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Could not send the reset email. Please try again.')
    } finally {
      setForgotSending(false)
    }
  }

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: initialEmail,
      remember: false,
    },
  })

  const setAccountAuth = useAuthStore(s => s.setAccountAuth);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const response = await api.post('/v1/accounts/auth/login', {
        email: data.email,
        password: data.password
      })
      setAccountAuth(response.accessToken, response.account, response.workspaces)
      setSuccess(true)
      await new Promise((r) => setTimeout(r, 500))
      navigate('/workspaces')
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="surface-soft min-h-screen lg:h-screen lg:overflow-hidden">
      {/* Full site header — the login page reads as part of the site, not a
          detached auth screen. Navbar mounts WorkspaceBootstrap internally. */}
      <Navbar tone="light" />

      {/* Centred composition: one rounded card floating on the soft ground,
          photo pane left, form pane right. Below lg the photo collapses to a
          short banner above the form and the page scrolls normally. */}
      <main className="flex min-h-screen flex-col px-4 pb-10 pt-24 sm:px-6 lg:h-screen lg:min-h-0 lg:pb-6 lg:pt-24">
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="m-auto w-full max-w-5xl"
        >
          <div className="grid overflow-hidden rounded-3xl border border-border bg-surface shadow-card-hover lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">

            {/* ── Photo pane — the client-supplied sapling photograph ────
                Copy sits over the dark soil at the image's bottom, behind a
                deep-emerald scrim; the bright bokeh top stays text-free. */}
            <div className="relative h-44 sm:h-52 lg:h-auto">
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
                    'linear-gradient(180deg, rgba(3,43,32,0.28) 0%, rgba(3,43,32,0) 30%, rgba(2,26,19,0) 46%, rgba(2,26,19,0.72) 70%, rgba(2,26,19,0.96) 100%)',
                }}
              />
              <span aria-hidden className="grain grain-dark" />
              <div className="absolute inset-x-0 bottom-0 z-10 p-6 lg:p-8">
                <Eyebrow>One platform</Eyebrow>
                <p
                  className="mt-3 max-w-xs font-heading text-[19px] font-bold leading-[1.15] tracking-tight text-white lg:text-[22px]"
                  style={{ fontVariationSettings: "'opsz' 32" }}
                >
                  Every branch of your business, growing from one root.
                </p>
                <ul className="mt-4 hidden space-y-2 lg:block">
                  {trustPoints.map((t) => (
                    <li key={t} className="flex items-center gap-2.5 text-[13px] font-body text-white/85">
                      <Check size={14} className="shrink-0 text-lime" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* ── Form pane ─────────────────────────────────────────────── */}
            <div className="p-6 sm:p-8 lg:px-10 lg:py-9">
              <h2
                className="font-heading text-[25px] font-bold tracking-tight text-text-primary"
                style={{ fontVariationSettings: "'opsz' 32" }}
              >
                Welcome back
              </h2>
              <p className="mb-6 mt-1 font-body text-sm text-text-secondary">Sign in to your UnifiedTree workspace</p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {createdWorkspace && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 p-3 text-sm font-medium text-primary-dark">
                    <Check size={16} className="text-primary" />
                    Workspace created. Sign in to open your workspace switcher.
                  </div>
                )}
                {errorMessage && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" />
                    {errorMessage}
                  </div>
                )}

                {/* Email */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-semibold text-text-primary">
                    Work Email
                  </label>
                  <div className="group relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary transition-colors group-focus-within:text-primary">
                      <Mail size={18} />
                    </div>
                    <input
                      {...register('email')}
                      type="email"
                      placeholder="you@company.com"
                      className={`w-full rounded-xl border bg-bg/50 py-3 pl-11 pr-4 font-body text-sm transition-all focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                        errors.email ? 'border-danger' : 'border-border'
                      }`}
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1.5 flex items-center gap-1 font-body text-xs text-danger">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                      {errors.email.message}
                    </p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-semibold text-text-primary">
                    Password
                  </label>
                  <div className="group relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary transition-colors group-focus-within:text-primary">
                      <Lock size={18} />
                    </div>
                    <input
                      {...register('password')}
                      type={showPass ? 'text' : 'password'}
                      placeholder="Min. 8 characters"
                      className={`w-full rounded-xl border bg-bg/50 py-3 pl-11 pr-12 font-body text-sm transition-all focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                        errors.password ? 'border-danger' : 'border-border'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      aria-pressed={showPass}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-secondary transition-colors hover:bg-bg hover:text-primary"
                    >
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1.5 flex items-center gap-1 font-body text-xs text-danger">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                      {errors.password.message}
                    </p>
                  )}
                </div>

                {/* Remember + forgot */}
                <div className="flex items-center justify-between">
                  <label className="group flex cursor-pointer items-center gap-2">
                    <input
                      {...register('remember')}
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer rounded border-border text-primary accent-primary transition-all focus:ring-2 focus:ring-primary/20 focus:ring-offset-0"
                    />
                    <span className="font-body text-sm text-text-secondary transition-colors group-hover:text-text-primary">Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => openForgot()}
                    className="font-body text-sm font-semibold text-primary transition-colors hover:text-primary-dark hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || success}
                  className="btn-shimmer shadow-teal hover:shadow-teal-lg flex w-full transform items-center justify-center gap-2 rounded-xl bg-primary py-3 font-body text-sm font-semibold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-70"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {success && <Check size={16} />}
                  {loading ? 'Signing in...' : success ? 'Success!' : 'Sign In'}
                </button>
              </form>

              {/* Divider */}
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="font-body text-xs font-medium uppercase tracking-wider text-text-secondary">or continue with</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Google SSO — backend endpoint /v1/accounts/auth/google/start
                  doesn't exist yet (AccountController has no google/oauth route
                  as of 2026-08). Disabled 'Coming soon' state so we don't ship
                  a dead button that silently 404s. (Teammate's B12, ported.) */}
              <button
                type="button"
                disabled
                aria-label="Google sign-in coming soon"
                title="Google sign-in coming soon"
                className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border border-border bg-surface py-3 font-body text-sm font-semibold text-text-secondary opacity-70"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
                <span className="ml-1 rounded-full bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-tertiary">Soon</span>
              </button>

              <p className="mt-5 text-center font-body text-sm text-text-secondary">
                Don't have an account?{' '}
                <Link to="/signup?mode=trial" className="font-semibold text-primary transition-colors hover:text-primary-dark hover:underline">
                  Create free workspace
                </Link>
              </p>
            </div>

          </div>
        </motion.div>
      </main>

      {/* Forgot-password modal */}
      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
          onClick={closeForgot}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-title"
        >
          <div
            ref={forgotDialogRef}
            className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-border p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {forgotSent ? (
              <>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-success/10 mx-auto mb-4">
                  <Check size={22} className="text-success" />
                </div>
                <h2 id="forgot-title" className="text-xl font-heading font-bold text-text-primary text-center mb-2">
                  Check your email
                </h2>
                <p className="text-sm text-text-secondary text-center mb-6">
                  If <span className="font-semibold text-text-primary">{forgotEmail}</span> matches an account, we&rsquo;ve sent a password-reset link. It expires in 1 hour.
                </p>
                <button
                  type="button"
                  onClick={closeForgot}
                  className="w-full py-3 rounded-xl bg-primary text-white font-body font-semibold text-sm hover:bg-primary-dark transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-4">
                  <Mail size={22} className="text-primary" />
                </div>
                <h2 id="forgot-title" className="text-xl font-heading font-bold text-text-primary text-center mb-2">
                  Reset your password
                </h2>
                <p className="text-sm text-text-secondary text-center mb-5">
                  Enter your work email and we&rsquo;ll send you a link to set a new password.
                </p>
                <label className="block text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">
                  Work Email
                </label>
                <div className="relative mb-4">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="email"
                    autoFocus
                    autoComplete="email"
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); if (forgotError) setForgotError('') }}
                    placeholder="you@company.com"
                    disabled={forgotSending}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitForgot() }}
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-surface text-text-primary placeholder:text-text-tertiary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                {forgotError && (
                  <p className="text-danger text-xs mb-3 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger" />
                    {forgotError}
                  </p>
                )}
                <div className="flex gap-3 mt-2">
                  <button
                    type="button"
                    onClick={closeForgot}
                    disabled={forgotSending}
                    className="flex-1 py-3 rounded-xl border border-border text-text-secondary font-body font-semibold text-sm hover:bg-surface-2 transition-colors disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitForgot}
                    disabled={forgotSending || !forgotEmail.trim()}
                    className="flex-1 py-3 rounded-xl bg-primary text-white font-body font-semibold text-sm hover:bg-primary-dark transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                  >
                    {forgotSending && <Loader2 size={14} className="animate-spin" />}
                    {forgotSending ? 'Sending…' : 'Send reset link'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
