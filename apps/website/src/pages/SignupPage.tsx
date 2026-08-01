import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Edit2, User, Building, Mail, Phone, Lock, Globe, Languages, Users, Target, Check, X, Lock as LockIcon, AlertCircle } from 'lucide-react';
import { usePricingStore } from '../store/pricingStore';
import { useModulePlans, computeMonthlyTotal, effectiveUnit, type ModulePlan } from '../lib/plans';
import { createPaymentOrder, openCheckout, type RazorpaySuccess } from '../lib/razorpay';
import { COUNTRIES } from '../data/countries';
import { useSubdomainAvailability } from '../lib/subdomainCheck';
import { API_BASE_URL } from '../lib/api';

import { Navbar } from '../components/layout/Navbar';

const DEV_PLATFORM_PORT = (import.meta.env.VITE_PLATFORM_PORT as string | undefined) || '3001';

const signupSchema = z.object({
  adminName: z.string().min(2, 'Name is required'),
  companyName: z.string().min(2, 'Company name is required'),
  subdomain: z.string().min(3, 'At least 3 chars').regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only'),
  adminEmail: z.string().email('Valid email required'),
  adminMobile: z.string().min(10, 'Valid phone number required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
  seats: z.coerce.number().int().min(1, 'At least 1 user'),
  country: z.string().min(1, 'Country is required'),
  language: z.string().min(1, 'Language is required'),
  primaryInterest: z.string().min(1, 'Interest is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type SignupData = z.infer<typeof signupSchema>;

type SignupResult = { workspaceUrl?: string; subdomain?: string; message?: string };

function workspaceLoginUrl(result: SignupResult, subdomain: string, email: string) {
  const host = window.location.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  const emailParam = `?email=${encodeURIComponent(email)}`;
  if (isLocal) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${subdomain}.localhost:${DEV_PLATFORM_PORT}/login${emailParam}`;
  }
  const workspaceUrl = (result.workspaceUrl || `https://${subdomain}.unifiedtree.com`).replace(/\/$/, '');
  return `${workspaceUrl}/login${emailParam}`;
}

export function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEditingSubdomain, setIsEditingSubdomain] = useState(false);
  // Once the user has edited the subdomain, never overwrite it from
  // companyName again (fixes the "domain reverts on blur" bug).
  const subdomainTouched = useRef(false);
  const [isModulesDrawerOpen, setIsModulesDrawerOpen] = useState(false);

  const { data: allPlans = [] } = useModulePlans();
  // Hide RETIRED so a stale Zustand entry from before a merge/rename doesn't
  // surface a phantom module in the checkout summary that the backend will
  // reject at requireAvailable().
  const plans = allPlans.filter((p) => p.status !== 'RETIRED');
  const selectedPlanKeys = usePricingStore((s) => s.selectedPlanKeys);
  const togglePlan = usePricingStore((s) => s.togglePlan);
  const storeSeats = usePricingStore((s) => s.seats);
  const billingCycle = usePricingStore((s) => s.billingCycle);
  const setBillingCycle = usePricingStore((s) => s.setBillingCycle);

  const availablePlans = plans.filter((p) => p.status === 'AVAILABLE');
  // Plans the visitor picked that are actually purchasable. If they arrived
  // without any selection, we send an EMPTY list; the backend rejects that
  // with a clear "select at least one plan" error rather than us secretly
  // picking a plan for them.
  const purchasableSelected: ModulePlan[] = availablePlans.filter((p) => selectedPlanKeys.includes(p.key));
  const selectedPlanNames = purchasableSelected.map((p) => p.displayName).join(', ');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      seats: storeSeats,
      country: 'India',
      language: 'English',
      primaryInterest: 'Use it in my company',
    },
  });

  const companyName = watch('companyName');
  const subdomainValue = watch('subdomain');
  const availability = useSubdomainAvailability(subdomainValue);
  const seats = Number(watch('seats')) || 1;
  const monthlyTotal = computeMonthlyTotal(plans, purchasableSelected.map((p) => p.key), seats);
  // Per-user rate of the selected plans (was hardcoded to ₹40) — comes from the DB.
  const perUser = purchasableSelected.reduce((sum, p) => sum + p.priceInr, 0);
  const basePrice = availablePlans[0]?.priceInr ?? perUser;
  // Cycle-aware amounts. Annual applies each plan's DB-driven discount, x12.
  const perUserAnnual = purchasableSelected.reduce((sum, p) => sum + effectiveUnit(p, 'annual'), 0);
  const cycleUnit = billingCycle === 'annual' ? perUserAnnual : perUser;
  const chargeTotal = billingCycle === 'annual' ? perUserAnnual * seats * 12 : monthlyTotal;

  useEffect(() => {
    // Auto-derive subdomain only until the user takes over. After they've
    // manually edited (or clicked the edit pencil) we never overwrite.
    if (subdomainTouched.current || isEditingSubdomain) return;
    if (!companyName) return;
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slug.length >= 3) setValue('subdomain', slug);
  }, [companyName, isEditingSubdomain, setValue]);

  // Submit the signup with proof of payment. Returns on success (opens the
  // workspace login) or throws with a friendly message.
  async function submitSignup(data: SignupData, modulesForSignup: string[], payment: RazorpaySuccess | null) {
    const signupPayload = {
      adminName: data.adminName,
      companyName: data.companyName,
      subdomain: data.subdomain,
      adminEmail: data.adminEmail,
      adminMobile: data.adminMobile,
      password: data.password,
      industry: null,
      country: data.country,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currency: 'INR',
      // Company Size field removed from UI; backend still accepts null.
      companySize: null,
      primaryInterest: data.primaryInterest,
      requestedModules: modulesForSignup,
      payment: payment
        ? {
            razorpayOrderId: payment.razorpay_order_id,
            razorpayPaymentId: payment.razorpay_payment_id,
            razorpaySignature: payment.razorpay_signature,
          }
        : null,
    };
    const res = await fetch(`${API_BASE_URL}/v1/public/signup-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupPayload),
    });
    const text = await res.text();
    const result: SignupResult = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(result.message || `Failed to create workspace (${res.status})`);
    const loginUrl = workspaceLoginUrl(result, result.subdomain || data.subdomain, data.adminEmail);
    window.open(loginUrl, '_blank', 'noopener,noreferrer');
    window.location.href = '/';
  }

  const onSubmit = async (data: SignupData) => {
    setLoading(true);
    setError('');
    try {
      const planKeys = purchasableSelected.map((p) => p.key);
      const modulesForSignup = [...new Set(purchasableSelected.flatMap((p) => p.includedModules))];
      if (!planKeys.length) {
        throw new Error('Select at least one available module to continue.');
      }

      // 1. Create the Razorpay order. The backend computes the amount from the
      //    DB (per-user price * seats) — the browser never dictates the price.
      const order = await createPaymentOrder({
        planKeys,
        seats: data.seats,
        billingCycle,
        subdomain: data.subdomain,
        email: data.adminEmail,
      });

      // 2. Open Razorpay Checkout. Workspace is created only AFTER a verified
      //    payment (in the success handler).
      await openCheckout({
        order,
        name: 'UnifiedTree',
        description: `${data.companyName} - ${data.seats} user(s) - ${billingCycle}`,
        prefill: { name: data.adminName, email: data.adminEmail, contact: data.adminMobile },
        onDismiss: () => {
          setError('Payment was cancelled. Your workspace was not created.');
          setLoading(false);
        },
        onSuccess: async (r) => {
          try {
            await submitSignup(data, modulesForSignup, r);
          } catch (e: any) {
            setError(e.message || 'Payment succeeded but workspace creation failed. Please contact support.');
            setLoading(false);
          }
        },
      });
    } catch (err: any) {
      // If the gateway is not configured (503), fall back to a free signup so
      // local/dev environments keep working.
      if (err?.message && /not configured|503/i.test(err.message)) {
        try {
          const modulesForSignup = [...new Set(purchasableSelected.flatMap((p) => p.includedModules))];
          await submitSignup(data, modulesForSignup.length ? modulesForSignup : ['hrms'], null);
          return;
        } catch (e2: any) {
          setError(e2.message);
        }
      } else {
        setError(err.message);
      }
      setLoading(false);
    }
  };

  const priceLabel = chargeTotal > 0
    ? `Pay ₹${chargeTotal.toLocaleString('en-IN')}/${billingCycle === 'annual' ? 'yr' : 'mo'} & Create Workspace`
    : 'Create Workspace';

  return (
    <div className="min-h-screen bg-[#EBF5DF] flex flex-col font-body relative">
      <Navbar />

      {/* Background pattern matching Hero Section */}
      <div className="absolute inset-0 bg-squircle-grid-white pointer-events-none h-[800px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#EBF5DF]/80 to-[#EBF5DF] pointer-events-none h-[800px]" />

      <div className="flex-1 flex flex-col items-center pt-40 pb-24 px-4 sm:px-6 relative z-10">
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-10 text-center relative z-10">
          <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-[#18280E] tracking-tight mb-3">
            Create Your Workspace
          </h1>
          <p className="text-[#18280E]/80 font-body font-medium text-base max-w-lg mx-auto">
            Pick your modules, choose your team size, and pay securely to activate instantly.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="w-full max-w-5xl">
          {/* Checkout layout: fields on the left, sticky order summary on the right.
              The <form> wraps BOTH columns so the submit button (in the summary) works. */}
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
            {/* ── LEFT: form fields ─────────────────────────────────────────── */}
            <div className="rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8">
              {error && (
                <div className="mb-6 flex items-center gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm font-semibold text-danger">
                  <span className="h-2 w-2 rounded-full bg-danger" />{error}
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="First and Last Name" icon={<User size={18} />} error={errors.adminName?.message} className="md:col-span-2">
                  <input {...register('adminName')} placeholder="John Doe" className={inputCls(!!errors.adminName)} />
                </Field>

                <Field label="Company Name" icon={<Building size={18} />} error={errors.companyName?.message} className="md:col-span-2">
                  <input {...register('companyName')} placeholder="Acme Corp" className={inputCls(!!errors.companyName)} />
                </Field>

                {/* Subdomain — live availability check against the backend */}
                <div className="md:col-span-2 bg-primary/5 border border-primary/10 rounded-2xl p-5 flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Your Workspace Domain</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!isEditingSubdomain ? (
                          <>
                            <span className="text-text-primary font-heading font-extrabold text-lg bg-primary/10 px-2.5 py-0.5 rounded-lg">{subdomainValue || 'yourcompany'}</span>
                            <span className="text-text-secondary font-body font-semibold text-base">.unifiedtree.com</span>
                            <button type="button" onClick={() => { subdomainTouched.current = true; setIsEditingSubdomain(true); }} className="ml-2 text-primary p-1.5 bg-white border border-border shadow-sm rounded-lg"><Edit2 size={13} /></button>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 w-full max-w-xs">
                            <input
                              {...register('subdomain', { onChange: () => { subdomainTouched.current = true; } })}
                              autoFocus
                              onBlur={() => setIsEditingSubdomain(false)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setIsEditingSubdomain(false); } }}
                              className="border border-primary rounded-lg px-2.5 py-1 text-sm text-text-primary font-heading font-bold w-full bg-white"
                            />
                            <span className="text-text-secondary font-body font-bold">.unifiedtree.com</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <SubdomainStatusBadge state={availability.state} />
                  </div>
                  {(availability.reason && availability.state !== 'available' && availability.state !== 'idle') && (
                    <p className="text-xs font-body text-text-secondary">{availability.reason}</p>
                  )}
                </div>
                {errors.subdomain && <span className="text-danger text-xs md:col-span-2 -mt-2">{errors.subdomain.message}</span>}

                <Field label="Email Address" icon={<Mail size={18} />} error={errors.adminEmail?.message}>
                  <input {...register('adminEmail')} type="email" placeholder="you@company.com" className={inputCls(!!errors.adminEmail)} />
                </Field>

                <Field label="Phone Number" icon={<Phone size={18} />} error={errors.adminMobile?.message}>
                  <input {...register('adminMobile')} placeholder="+91 9876543210" className={inputCls(!!errors.adminMobile)} />
                </Field>

                <Field label="Password" icon={<Lock size={18} />} error={errors.password?.message}>
                  <input {...register('password')} type="password" placeholder="Create a password" className={inputCls(!!errors.password)} />
                </Field>

                <Field label="Confirm Password" icon={<Lock size={18} />} error={errors.confirmPassword?.message}>
                  <input {...register('confirmPassword')} type="password" placeholder="Repeat password" className={inputCls(!!errors.confirmPassword)} />
                </Field>

                {/* Number of users (seats) — drives the per-seat price */}
                <Field label="Number of Users" icon={<Users size={18} />} error={errors.seats?.message}>
                  <input {...register('seats')} type="number" min={1} placeholder="10" className={inputCls(!!errors.seats)} />
                </Field>

                <Field label="Country" icon={<Globe size={18} />}>
                  <select {...register('country')} className={selectCls}>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>

                <Field label="Language" icon={<Languages size={18} />}>
                  <select {...register('language')} className={selectCls}><option>English</option><option>Hindi</option></select>
                </Field>

                <Field label="Primary Interest" icon={<Target size={18} />}>
                  <select {...register('primaryInterest')} className={selectCls}>
                    <option>Use it in my company</option><option>Offer it to my clients</option><option>Other</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* ── RIGHT: sticky order summary + pay ─────────────────────────── */}
            <aside className="lg:sticky lg:top-24">
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
                <div className="bg-primary px-5 py-4 text-white">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-100/80">Your plan</p>
                  <p className="mt-0.5 truncate font-bold text-lime">{selectedPlanNames || 'No modules selected'}</p>
                </div>

                <div className="space-y-4 p-5">
                  {/* Monthly / Annual — annual applies the DB-driven discount */}
                  <div className="flex rounded-xl border border-border bg-bg p-0.5">
                    {(['monthly', 'annual'] as const).map((c) => (
                      <button key={c} type="button" onClick={() => setBillingCycle(c)}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-bold capitalize transition-all ${billingCycle === c ? 'bg-primary text-lime shadow-sm' : 'text-text-secondary hover:text-primary'}`}>
                        {c}{c === 'annual' && <span className="ml-1 text-[9px] text-emerald-500">save</span>}
                      </button>
                    ))}
                  </div>

                  {/* Price breakdown */}
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-text-secondary"><span>Per user / mo</span><span className="font-semibold text-text-primary">₹{cycleUnit.toLocaleString('en-IN')}</span></div>
                    <div className="flex justify-between text-text-secondary"><span>Users</span><span className="font-semibold text-text-primary">{seats}</span></div>
                    <div className="mt-2 flex items-end justify-between border-t border-border pt-3">
                      <span className="text-text-secondary">Total</span>
                      <span className="text-xl font-bold text-text-primary">₹{chargeTotal.toLocaleString('en-IN')}<span className="text-xs font-normal text-text-secondary">/{billingCycle === 'annual' ? 'yr' : 'mo'}</span></span>
                    </div>
                  </div>

                  <button type="button" onClick={() => setIsModulesDrawerOpen(true)} className="w-full rounded-xl border border-border bg-bg py-2.5 text-xs font-bold text-text-primary transition-all hover:border-primary/30 hover:bg-surface active:scale-[0.98]">
                    Change modules
                  </button>

                  <button type="submit" disabled={loading} className="btn-shimmer flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-lime shadow-sm transition-all active:scale-[0.99] disabled:opacity-70">
                    {loading ? <Loader2 size={18} className="animate-spin" /> : priceLabel}
                  </button>

                  <p className="text-center text-[11px] leading-relaxed text-text-tertiary">
                    By continuing you accept our <a href="#" className="font-semibold text-primary">Subscription Agreement</a> &amp; <a href="#" className="font-semibold text-primary">Privacy Policy</a>. Secured by Razorpay.
                  </p>
                  <p className="text-center text-xs text-text-secondary">
                    Already have an account? <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
                  </p>
                </div>
              </div>
            </aside>
          </form>
        </motion.div>

        {/* Modules drawer — shows all 9 plans; launching-soon ones are locked */}
        <AnimatePresence>
          {isModulesDrawerOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModulesDrawerOpen(false)} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-border">
                <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-surface">
                  <div>
                    <h2 className="text-xl font-heading font-bold text-text-primary">Customize Modules</h2>
                    <p className="text-sm text-text-secondary mt-1">₹{basePrice} per user / month · more modules coming soon</p>
                  </div>
                  <button onClick={() => setIsModulesDrawerOpen(false)} className="p-2 rounded-full hover:bg-bg text-text-secondary"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  {plans.map((plan) => {
                    const available = plan.status === 'AVAILABLE';
                    const isSelected = available && purchasableSelected.some((p) => p.key === plan.key);
                    return (
                      <div
                        key={plan.key}
                        onClick={() => available && togglePlan(plan.key)}
                        className={`relative flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
                          !available ? 'border-border bg-bg/50 opacity-70 cursor-not-allowed'
                            : isSelected ? 'border-primary bg-primary/5 cursor-pointer'
                            : 'border-border hover:border-primary/30 hover:bg-surface cursor-pointer'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-primary-light text-primary'}`}>
                          <span className="text-sm font-heading font-extrabold">{plan.displayName.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <h3 className="font-heading font-bold text-sm text-text-primary truncate">{plan.displayName}</h3>
                            {available ? (
                              <span className="text-xs font-bold text-primary whitespace-nowrap">₹{plan.priceInr}/user/mo</span>
                            ) : (
                              <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1"><LockIcon size={9} /> Launching soon</span>
                            )}
                          </div>
                          {plan.tagline && <p className="text-[11px] text-primary font-semibold mb-0.5">{plan.tagline}</p>}
                          <p className="text-xs text-text-secondary leading-snug">{plan.description}</p>
                        </div>
                        {available && (
                          <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border flex items-center justify-center ${isSelected ? 'bg-primary border-primary text-white' : 'border-slate-300'}`}>
                            {isSelected && <Check size={12} strokeWidth={3} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="p-6 border-t border-border bg-surface">
                  <button onClick={() => setIsModulesDrawerOpen(false)} className="w-full py-3.5 bg-primary text-white font-body font-bold rounded-xl hover:bg-primary-dark shadow-md">Done</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// -- small presentational helpers -------------------------------------------

function SubdomainStatusBadge({ state }: { state: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error' }) {
  if (state === 'idle') return null;
  const map = {
    checking:  { icon: <Loader2 size={14} className="animate-spin" />, text: 'Checking…',       cls: 'bg-slate-100 text-slate-600' },
    available: { icon: <Check size={14} />,                            text: 'Available',       cls: 'bg-emerald-100 text-emerald-700' },
    taken:     { icon: <X size={14} />,                                text: 'Already taken',   cls: 'bg-red-100 text-red-700' },
    invalid:   { icon: <AlertCircle size={14} />,                      text: 'Invalid',         cls: 'bg-amber-100 text-amber-700' },
    error:     { icon: <AlertCircle size={14} />,                      text: 'Could not check', cls: 'bg-slate-100 text-slate-600' },
  }[state];
  return <span className={`inline-flex items-center gap-1.5 text-[11px] font-body font-semibold px-2.5 py-1 rounded-full ${map.cls}`}>{map.icon}{map.text}</span>;
}

function Field({ label, icon, error, className, children }: { label: string; icon: React.ReactNode; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">{label}</label>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary pointer-events-none z-10 transition-colors">{icon}</div>
        {children}
      </div>
      {error && <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-danger" />{error}</span>}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return `w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${hasError ? 'border-danger' : 'border-border'}`;
}

const selectCls = 'w-full pl-11 pr-10 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer border-border text-text-primary';
