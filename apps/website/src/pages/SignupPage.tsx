import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Edit2, User, Building, Mail, Phone, Lock, Globe, Languages, Users, Target, Check, X, Lock as LockIcon } from 'lucide-react';
import { usePricingStore } from '../store/pricingStore';
import { useModulePlans, computeMonthlyTotal, type ModulePlan } from '../lib/plans';
import { createPaymentOrder, openCheckout, type RazorpaySuccess } from '../lib/razorpay';
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
  companySize: z.string().min(1, 'Company size is required'),
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
  const [isModulesDrawerOpen, setIsModulesDrawerOpen] = useState(false);

  const { data: plans = [] } = useModulePlans();
  const selectedPlanKeys = usePricingStore((s) => s.selectedPlanKeys);
  const togglePlan = usePricingStore((s) => s.togglePlan);
  const storeSeats = usePricingStore((s) => s.seats);

  const availablePlans = plans.filter((p) => p.status === 'AVAILABLE');
  // Plans the visitor picked that are actually purchasable; default to the one
  // available plan (HR & Employees) if they arrived without a selection.
  const purchasableSelected: ModulePlan[] = (() => {
    const picked = availablePlans.filter((p) => selectedPlanKeys.includes(p.key));
    if (picked.length) return picked;
    return availablePlans.slice(0, 1);
  })();
  const selectedPlanNames = purchasableSelected.map((p) => p.displayName).join(', ');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      seats: storeSeats,
      country: 'India',
      language: 'English',
      companySize: '1 - 5 employees',
      primaryInterest: 'Use it in my company',
    },
  });

  const companyName = watch('companyName');
  const seats = Number(watch('seats')) || 1;
  const monthlyTotal = computeMonthlyTotal(plans, purchasableSelected.map((p) => p.key), seats);
  // Per-user rate of the selected plans (was hardcoded to ₹40) — comes from the DB.
  const perUser = purchasableSelected.reduce((sum, p) => sum + p.priceInr, 0);
  const basePrice = availablePlans[0]?.priceInr ?? perUser;

  useEffect(() => {
    if (companyName && !isEditingSubdomain) {
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (slug.length >= 3) setValue('subdomain', slug);
    }
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
      industry: data.companySize,
      country: data.country,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currency: 'INR',
      companySize: data.companySize,
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
        subdomain: data.subdomain,
        email: data.adminEmail,
      });

      // 2. Open Razorpay Checkout. Workspace is created only AFTER a verified
      //    payment (in the success handler).
      await openCheckout({
        order,
        name: 'UnifiedTree',
        description: `${data.companyName} - ${data.seats} user(s)`,
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

  const priceLabel = monthlyTotal > 0
    ? `Pay ₹${monthlyTotal.toLocaleString('en-IN')}/mo & Create Workspace`
    : 'Create Workspace';

  return (
    <div className="min-h-screen bg-bg flex flex-col font-body relative">
      <Navbar />
      <div className="flex-1 flex flex-col items-center pt-32 pb-24 px-4 sm:px-6 relative overflow-hidden">
        <div className="absolute -top-48 -left-48 w-96 h-96 bg-primary-light rounded-full blur-[140px] opacity-60 pointer-events-none" />
        <div className="absolute top-1/2 -right-48 w-96 h-96 bg-accent/10 rounded-full blur-[140px] opacity-40 pointer-events-none" />

        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-10 text-center relative z-10">
          <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-text-primary tracking-tight mb-3">
            Create Your <span className="gradient-text">Workspace</span>
          </h1>
          <p className="text-text-secondary font-body font-medium text-base">
            Pick your modules, choose your team size, and pay securely to activate instantly.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="w-full max-w-4xl space-y-6">
          {/* Selected plan + live price banner */}
          <div className="bg-white/80 backdrop-blur-md border border-border shadow-md rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-center gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center text-primary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <div className="text-left">
                <span className="font-heading font-bold text-text-primary text-base block">{selectedPlanNames || 'No modules selected'}</span>
                <span className="text-xs text-text-secondary font-body font-medium">
                  {monthlyTotal > 0 ? `₹${monthlyTotal.toLocaleString('en-IN')}/mo · ${seats} user(s) · ₹${perUser}/user` : 'Select an available module'}
                </span>
              </div>
            </div>
            <button type="button" onClick={() => setIsModulesDrawerOpen(true)} className="px-5 py-2.5 rounded-xl bg-bg border border-border hover:border-primary/30 hover:bg-surface font-body font-bold text-xs text-text-primary transition-all shadow-sm active:scale-95">
              Change modules
            </button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="bg-surface rounded-3xl border border-border shadow-xl p-8 sm:p-12 relative z-10">
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-accent rounded-t-3xl" />
            {error && (
              <div className="bg-danger/5 border border-danger/20 text-danger p-4 rounded-xl mb-8 text-sm font-body font-semibold flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-danger" />{error}
              </div>
            )}

            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Field label="First and Last Name" icon={<User size={18} />} error={errors.adminName?.message} className="md:col-span-2">
                  <input {...register('adminName')} placeholder="John Doe" className={inputCls(!!errors.adminName)} />
                </Field>

                <Field label="Company Name" icon={<Building size={18} />} error={errors.companyName?.message} className="md:col-span-2">
                  <input {...register('companyName')} placeholder="Acme Corp" className={inputCls(!!errors.companyName)} />
                </Field>

                {/* Subdomain */}
                <div className="md:col-span-2 bg-primary/5 border border-primary/10 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Your Workspace Domain</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {!isEditingSubdomain ? (
                        <>
                          <span className="text-text-primary font-heading font-extrabold text-lg bg-primary/10 px-2.5 py-0.5 rounded-lg">{watch('subdomain') || 'yourcompany'}</span>
                          <span className="text-text-secondary font-body font-semibold text-base">.unifiedtree.com</span>
                          <button type="button" onClick={() => setIsEditingSubdomain(true)} className="ml-2 text-primary p-1.5 bg-white border border-border shadow-sm rounded-lg"><Edit2 size={13} /></button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 w-full max-w-xs">
                          <input {...register('subdomain')} autoFocus onBlur={() => setIsEditingSubdomain(false)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setIsEditingSubdomain(false); } }} className="border border-primary rounded-lg px-2.5 py-1 text-sm text-text-primary font-heading font-bold w-full bg-white" />
                          <span className="text-text-secondary font-body font-bold">.unifiedtree.com</span>
                        </div>
                      )}
                    </div>
                  </div>
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
                    <option>India</option><option>United States</option><option>United Kingdom</option>
                  </select>
                </Field>

                <Field label="Language" icon={<Languages size={18} />}>
                  <select {...register('language')} className={selectCls}><option>English</option><option>Hindi</option></select>
                </Field>

                <Field label="Company Size" icon={<Users size={18} />}>
                  <select {...register('companySize')} className={selectCls}>
                    <option>1 - 5 employees</option><option>5 - 20 employees</option><option>20 - 50 employees</option><option>50+ employees</option>
                  </select>
                </Field>

                <Field label="Primary Interest" icon={<Target size={18} />}>
                  <select {...register('primaryInterest')} className={selectCls}>
                    <option>Use it in my company</option><option>Offer it to my clients</option><option>Other</option>
                  </select>
                </Field>
              </div>

              <div className="pt-10 border-t border-border mt-8 text-center">
                <p className="text-xs text-text-secondary font-body mb-6">
                  By continuing you accept our <a href="#" className="text-primary font-semibold">Subscription Agreement</a> and <a href="#" className="text-primary font-semibold">Privacy Policy</a>. Payments are processed securely by Razorpay.
                </p>
                <button type="submit" disabled={loading} className="px-16 py-4 bg-primary text-white text-base font-body font-semibold rounded-xl hover:bg-primary-dark transition-all disabled:opacity-70 flex items-center justify-center gap-2.5 mx-auto min-w-[280px] shadow-teal active:scale-[0.99]">
                  {loading ? <Loader2 size={20} className="animate-spin" /> : priceLabel}
                </button>
                <p className="text-center text-sm text-text-secondary font-body mt-6">
                  Already have an account? <Link to="/login" className="text-primary font-semibold hover:underline">Sign In</Link>
                </p>
              </div>
            </div>
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
