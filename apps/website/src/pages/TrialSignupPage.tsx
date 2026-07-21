import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Loader2, User, Building, Mail, Phone, Lock, Globe, Languages, Users, Target, Edit2, Sparkles, CheckCircle2 } from 'lucide-react';
import { usePricingStore } from '../store/pricingStore';
import { useModulePlans, type ModulePlan } from '../lib/plans';
import { API_BASE_URL } from '../lib/api';
import { Navbar } from '../components/layout/Navbar';

const DEV_PLATFORM_PORT = (import.meta.env.VITE_PLATFORM_PORT as string | undefined) || '3001';
const TRIAL_DAYS_DEFAULT = 7;

const trialSchema = z.object({
  adminName: z.string().min(2, 'Name is required'),
  companyName: z.string().min(2, 'Company name is required'),
  subdomain: z.string().min(3, 'At least 3 chars').regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only'),
  adminEmail: z.string().email('Valid email required'),
  adminMobile: z.string().min(10, 'Valid phone number required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
  country: z.string().min(1, 'Country is required'),
  language: z.string().min(1, 'Language is required'),
  companySize: z.string().min(1, 'Company size is required'),
  primaryInterest: z.string().min(1, 'Interest is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type TrialData = z.infer<typeof trialSchema>;
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

/**
 * Free-trial signup — same form as SignupPage but:
 *   * no payment step (submits with mode="TRIAL")
 *   * no billing cycle / seats price display
 *   * "no credit card required" trial banner
 * The backend creates a workspace + a TRIAL subscription (7 days, DB-configurable).
 */
export function TrialSignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEditingSubdomain, setIsEditingSubdomain] = useState(false);

  const { data: plans = [] } = useModulePlans();
  const selectedPlanKeys = usePricingStore((s) => s.selectedPlanKeys);

  const availablePlans = plans.filter((p) => p.status === 'AVAILABLE');
  // Default to the one AVAILABLE plan if they arrived without a selection.
  const chosenPlans: ModulePlan[] = (() => {
    const picked = availablePlans.filter((p) => selectedPlanKeys.includes(p.key));
    return picked.length ? picked : availablePlans.slice(0, 1);
  })();
  const chosenPlanNames = chosenPlans.map((p) => p.displayName).join(', ');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<TrialData>({
    resolver: zodResolver(trialSchema),
    defaultValues: {
      country: 'India',
      language: 'English',
      companySize: '1 - 5 employees',
      primaryInterest: 'Use it in my company',
    },
  });

  const companyName = watch('companyName');

  useEffect(() => {
    if (companyName && !isEditingSubdomain) {
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (slug.length >= 3) setValue('subdomain', slug);
    }
  }, [companyName, isEditingSubdomain, setValue]);

  const onSubmit = async (data: TrialData) => {
    setLoading(true);
    setError('');
    try {
      const planKeys = chosenPlans.map((p) => p.key);
      if (!planKeys.length) {
        throw new Error('Please pick at least one available module for your trial.');
      }
      // Backend derives the actual module_catalog keys from the plan keys
      // (requireAvailable + expandModules) — we don't need to send them.
      const res = await fetch(`${API_BASE_URL}/v1/public/signup-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
          requestedModules: planKeys,
          payment: null,
          mode: 'TRIAL',
        }),
      });
      const text = await res.text();
      const result: SignupResult = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(result.message || `Failed to start trial (${res.status})`);
      const loginUrl = workspaceLoginUrl(result, result.subdomain || data.subdomain, data.adminEmail);
      window.open(loginUrl, '_blank', 'noopener,noreferrer');
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Could not start your free trial. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#EBF5DF] flex flex-col font-body relative">
      <Navbar />
      <div className="absolute inset-0 bg-squircle-grid-white pointer-events-none h-[800px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#EBF5DF]/80 to-[#EBF5DF] pointer-events-none h-[800px]" />

      <div className="flex-1 flex flex-col items-center pt-40 pb-24 px-4 sm:px-6 relative z-10">
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-1.5 text-xs font-body font-bold uppercase tracking-wider mb-4">
            <Sparkles size={14} /> {TRIAL_DAYS_DEFAULT}-day free trial · no credit card
          </div>
          <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-[#18280E] tracking-tight mb-3">
            Start Your Free Trial
          </h1>
          <p className="text-[#18280E]/80 font-body font-medium text-base max-w-lg mx-auto">
            Full access for {TRIAL_DAYS_DEFAULT} days. Cancel anytime — we'll never charge you without asking.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="w-full max-w-4xl space-y-6">
          {/* Selected plans banner */}
          <div className="bg-white/80 backdrop-blur-md border border-border shadow-md rounded-2xl p-5 flex justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center text-primary">
                <CheckCircle2 size={20} />
              </div>
              <div className="text-left">
                <span className="font-heading font-bold text-text-primary text-base block">{chosenPlanNames || 'Loading modules…'}</span>
                <span className="text-xs text-text-secondary font-body font-medium">Included in your free trial</span>
              </div>
            </div>
            <Link to="/pricing" className="px-5 py-2.5 rounded-xl bg-bg border border-border hover:border-primary/30 hover:bg-surface font-body font-bold text-xs text-text-primary transition-all shadow-sm">
              Change modules
            </Link>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="bg-surface rounded-3xl border border-border shadow-xl p-8 sm:p-12 relative">
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-accent rounded-t-3xl" />

            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Field label="First and Last Name" icon={<User size={18} />} error={errors.adminName?.message} className="md:col-span-2">
                  <input {...register('adminName')} placeholder="John Doe" className={inputCls(!!errors.adminName)} />
                </Field>
                <Field label="Company Name" icon={<Building size={18} />} error={errors.companyName?.message} className="md:col-span-2">
                  <input {...register('companyName')} placeholder="Acme Corp" className={inputCls(!!errors.companyName)} />
                </Field>

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
                  By continuing you accept our <a href="#" className="text-primary font-semibold">Subscription Agreement</a> and <a href="#" className="text-primary font-semibold">Privacy Policy</a>. You will not be charged during the {TRIAL_DAYS_DEFAULT}-day trial.
                </p>
                {error && (
                  <div className="mb-5 mx-auto max-w-md text-sm text-danger font-body font-semibold flex items-center justify-center gap-2 bg-danger/5 border border-danger/20 rounded-xl px-4 py-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" /> {error}
                  </div>
                )}
                <button type="submit" disabled={loading} className="px-16 py-4 bg-primary text-white text-base font-body font-semibold rounded-xl hover:bg-primary-dark transition-all disabled:opacity-70 flex items-center justify-center gap-2.5 mx-auto min-w-[280px] shadow-teal active:scale-[0.99]">
                  {loading ? <Loader2 size={20} className="animate-spin" /> : `Start My Free Trial`}
                </button>
                <p className="text-center text-sm text-text-secondary font-body mt-6">
                  Already have an account? <Link to="/login" className="text-primary font-semibold hover:underline">Sign In</Link>
                </p>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
}

// ---------- small presentational helpers (kept local to avoid coupling) -----

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
