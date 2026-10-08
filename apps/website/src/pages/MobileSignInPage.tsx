import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Smartphone } from 'lucide-react'
import { API_BASE_URL } from '../lib/api'
import { firebaseCode, sendCode, type SentCode } from '../lib/firebasePhone'
import { handOverUrl } from '../lib/handOver'

/**
 * "Continue with mobile" from a business's login page (owner, 6 Oct 2026):
 *   /mobile-sign-in?business=<subdomain>[&port=<dev port>]
 *
 * Firebase sends an SMS code only on its authorized domains, so this one step runs here, on the
 * website: the person types their mobile, gets a code, types it; /v1/auth/firebase-verify (the call the
 * mobile app makes) finds them inside THAT business (X-Tenant-Subdomain) and starts their session,
 * which is handed back to <business>.unifiedtree.com the way sign-up hands over a new business (lib/handOver:
 * by its refresh cookie, no token in the address).
 *
 * White label: the page shows only the business's logo and name, no site header or vendor credit.
 * The hand-back address is built from the business name alone (never taken from the link), so a
 * crafted link can't send a session anywhere else.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/
const DEV_PLATFORM_PORT = (import.meta.env.VITE_PLATFORM_PORT as string | undefined) || '3001'

function isLocal() {
  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')
}

/** The business's own address: https://<business>.unifiedtree.com, or <business>.localhost:<port> in dev. */
export function businessAddress(business: string, devPort: string | null): string {
  if (isLocal()) return `http://${business}.localhost:${devPort && /^\d{2,5}$/.test(devPort) ? devPort : DEV_PLATFORM_PORT}`
  return `https://${business}.unifiedtree.com`
}

/** The 10-digit Indian mobile number in what was typed (+91, 0 or spaces allowed), or null. */
export function mobile10(typed: string): string | null {
  let d = typed.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

type Brand = { workspaceName?: string; monogram?: string; logoUrl?: string | null }

function asset(u?: string | null) {
  if (!u) return null
  if (u.startsWith('/v1/')) return `${API_BASE_URL}${u}`
  return /^https?:\/\//.test(u) ? u : null
}

async function post(path: string, business: string, body: unknown): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
  const r = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Subdomain': business },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json: Record<string, unknown> | null = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: r.status, text, json }
}

const SEVERAL = 'This mobile number is on more than one login here, so it can’t say which one is yours. Sign in with your email.'

/** What firebase-verify refused with, in plain words. */
function verifyRefusal(status: number, text: string): string {
  if (text.includes('PHONE_ON_SEVERAL_LOGINS')) return SEVERAL
  if (text.includes('USE_EMAIL_FOR_ADMIN')) return 'Admins sign in with their email and password.'
  if (text.includes('USE_PASSWORD_FOR_TWO_FACTOR')) return 'Your login uses two-factor sign-in. Sign in with your email and password, then enter your code.'
  if (text.includes('PHONE_NOT_REGISTERED')) return 'This mobile number isn’t on any login at this business. Ask your administrator to add it to your profile, or sign in with your email.'
  if (text.includes('ACCOUNT_INACTIVE')) return 'This login is switched off. Ask your administrator.'
  if (text.includes('ACCOUNT_LOCKED')) return 'This login is locked for a while after too many attempts. Try again later.'
  if (status === 429) return 'Too many tries. Wait a few minutes and try again.'
  if (status === 401) return 'That sign-in didn’t go through. Send a new code and try again.'
  return 'We couldn’t sign you in just now. Try again, or sign in with your email and password.'
}

/** Firebase's refusals, in plain words. */
function firebaseRefusal(e: unknown): string {
  switch (firebaseCode(e)) {
    case 'auth/invalid-verification-code': return 'That code isn’t right. Check the SMS and try again.'
    case 'auth/code-expired': return 'That code has expired. Send a new one.'
    case 'auth/too-many-requests': return 'Too many tries from this device. Wait a while and try again.'
    case 'auth/invalid-phone-number': return 'Enter a valid 10-digit mobile number.'
    case 'auth/quota-exceeded': return 'We can’t send codes right now. Sign in with your email and password.'
    case 'auth/network-request-failed': return 'Could not reach the network. Check your connection and try again.'
    default: return 'The code couldn’t be sent or checked. Try again, or sign in with your email and password.'
  }
}

export function MobileSignInPage() {
  const [params] = useSearchParams()
  const raw = (params.get('business') || '').trim().toLowerCase()
  const business = SLUG_RE.test(raw) ? raw : ''
  const home = business ? businessAddress(business, params.get('port')) : ''
  // Firebase test numbers only, and only in development (see firebasePhone.load).
  const testing = import.meta.env.DEV && params.get('testing') === '1'

  const [brand, setBrand] = useState<Brand | null>(null)
  const [missing, setMissing] = useState(!business)
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const sent = useRef<SentCode | null>(null)
  const captcha = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!business) return
    fetch(`${API_BASE_URL}/v1/public/workspace-branding?subdomain=${encodeURIComponent(business)}`)
      .then((r) => (r.status === 404 ? null : r.ok ? r.json() : {}))
      .then((b: Brand | null) => { if (b === null) setMissing(true); else setBrand(b) })
      .catch(() => setBrand({}))
  }, [business])

  useEffect(() => {
    document.title = brand?.workspaceName ? `Sign in · ${brand.workspaceName}` : 'Sign in'
  }, [brand])

  useEffect(() => {
    if (wait <= 0) return
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(t)
  }, [wait])

  const send = async () => {
    const m = mobile10(phone)
    if (!m) { setError('Enter your 10-digit mobile number.'); return }
    setBusy(true); setError('')
    try {
      // Is the number a login here? Asked first so no SMS is paid for a number that can't sign in.
      const check = await post('/v1/auth/phone/check', business, { mobile: m })
      if (check.status === 429) { setError('Too many tries. Wait a few minutes and try again.'); return }
      if (check.status !== 200) { setError('We couldn’t check that number just now. Try again.'); return }
      if (check.json?.reason === 'PHONE_ON_SEVERAL_LOGINS') { setError(SEVERAL); return }
      if (check.json?.registered !== true) {
        setError('This mobile number isn’t on any login at this business. Ask your administrator to add it to your profile, or sign in with your email.')
        return
      }
      sent.current = await sendCode(m, captcha.current!, testing)
      setStep('code'); setCode(''); setWait(30)
    } catch (e) {
      setError(firebaseCode(e) ? firebaseRefusal(e) : 'Mobile sign-in couldn’t load. Check your connection, or sign in with your email and password.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from the SMS.'); return }
    if (!sent.current) { setStep('phone'); return }
    setBusy(true); setError('')
    let idToken: string
    try {
      idToken = await sent.current.confirm(code)
    } catch (e) {
      setError(firebaseRefusal(e)); setBusy(false); return
    }
    try {
      const r = await post('/v1/auth/firebase-verify', business, { idToken })
      const token = typeof r.json?.accessToken === 'string' ? r.json.accessToken : ''
      if (r.status !== 200 || !token) { setError(verifyRefusal(r.status, r.text)); setBusy(false); return }
      window.location.replace(handOverUrl(home, token))
    } catch {
      setError('Could not reach the server. Check your connection and try again.'); setBusy(false)
    }
  }

  const name = brand?.workspaceName || ''
  const logo = asset(brand?.logoUrl)
  const input = 'w-full rounded-xl border border-border bg-bg/50 px-4 py-3 font-body text-[15px] transition-all focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20'

  return (
    <div className="surface-soft flex min-h-screen items-center justify-center px-4 py-10">
      <main className="w-full max-w-[420px] rounded-3xl border border-border bg-surface p-7 shadow-card-hover sm:p-9">
        {missing ? (
          <div className="space-y-3 text-center">
            <h1 className="font-display text-xl font-bold text-text-primary">This sign-in link isn’t complete</h1>
            <p className="font-body text-sm text-text-secondary">Open your business’s own sign-in page and choose “Continue with mobile” there.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              {logo ? (
                <img src={logo} alt={name} className="h-11 max-w-[160px] object-contain" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white" aria-hidden>
                  {brand?.monogram || name.slice(0, 1).toUpperCase() || '·'}
                </span>
              )}
              {!logo && name && <span className="font-display text-lg font-bold text-text-primary">{name}</span>}
            </div>

            <h1 className="font-display text-[22px] font-bold text-text-primary">Sign in with your mobile</h1>
            <p className="mt-1 font-body text-sm text-text-secondary">
              {step === 'phone'
                ? 'Use the mobile number on your profile. We’ll send you a one-time code by SMS.'
                : `Enter the 6-digit code sent to +91 ${mobile10(phone)}.`}
            </p>

            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => { e.preventDefault(); void (step === 'phone' ? send() : confirm()) }}
              noValidate
            >
              {step === 'phone' ? (
                <label className="block">
                  <span className="mb-1.5 block font-body text-[13px] font-semibold text-text-primary">Mobile number</span>
                  <div className="flex gap-2">
                    <span className="flex items-center rounded-xl border border-border bg-bg/60 px-3 font-body text-[15px] text-text-secondary">+91</span>
                    <input
                      className={input} type="tel" inputMode="numeric" autoComplete="tel-national" autoFocus
                      placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number"
                    />
                  </div>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block font-body text-[13px] font-semibold text-text-primary">One-time code</span>
                  <input
                    className={`${input} tracking-[0.4em]`} type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
                    placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="One-time code"
                  />
                </label>
              )}

              {error && (
                <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 font-body text-sm font-medium text-red-600">{error}</p>
              )}

              <button
                type="submit" disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-body text-sm font-semibold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-70"
              >
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Smartphone size={16} aria-hidden />}
                {step === 'phone' ? (busy ? 'Sending code…' : 'Send code') : (busy ? 'Signing in…' : 'Verify and sign in')}
              </button>

              {step === 'code' && (
                <div className="flex items-center justify-between font-body text-[13px]">
                  <button type="button" className="font-semibold text-text-secondary hover:text-primary" onClick={() => { setStep('phone'); setError('') }}>
                    Change number
                  </button>
                  <button type="button" disabled={wait > 0 || busy} className="font-semibold text-primary disabled:text-text-secondary" onClick={() => { void send() }}>
                    {wait > 0 ? `Send again in ${wait}s` : 'Send the code again'}
                  </button>
                </div>
              )}
            </form>

            {/* Firebase's invisible reCAPTCHA renders here. */}
            <div ref={captcha} />

            <a href={`${home}/login`} className="mt-7 inline-flex items-center gap-1.5 font-body text-[13px] font-semibold text-text-secondary hover:text-primary">
              <ArrowLeft size={14} aria-hidden /> Sign in with email instead
            </a>
          </>
        )}
      </main>
    </div>
  )
}
