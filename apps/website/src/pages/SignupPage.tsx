import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Edit2, User, Building, Mail, Phone, Lock, Globe, Languages, Users, Target, Check, X } from 'lucide-react';
import { usePricingStore } from '../store/pricingStore';
import { modules } from '../data/modules';
import { API_BASE_URL } from '../lib/api';

import { Navbar } from '../components/layout/Navbar';

const DEFAULT_MODULES: string[] = [];
const DEV_PLATFORM_PORT = (import.meta.env.VITE_PLATFORM_PORT as string | undefined) || '3001';

const signupSchema = z.object({
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

type SignupData = z.infer<typeof signupSchema>;

type SignupResult = {
  workspaceUrl?: string;
  subdomain?: string;
};

async function readSignupResponse(res: Response) {
  const body = await res.text();
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body) as SignupResult & { message?: string };
  } catch {
    return { message: body };
  }
}

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

  const selectedModules = usePricingStore((state) => state.selectedModules);
  const toggleModule = usePricingStore((state) => state.toggleModule);
  const actualModules = (selectedModules.length > 0 ? selectedModules : DEFAULT_MODULES).map(m => m === 'hr' ? 'hrms' : m);
  const selectedModuleNames = actualModules.map(id => modules.find(m => m.id === id)?.name).filter(Boolean).join(', ');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      country: 'India',
      language: 'English',
      companySize: '1 - 5 employees',
      primaryInterest: 'Use it in my company',
    }
  });

  const companyName = watch('companyName');
  
  useEffect(() => {
    if (companyName && !isEditingSubdomain) {
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (slug.length >= 3) {
        setValue('subdomain', slug);
      }
    }
  }, [companyName, isEditingSubdomain, setValue]);

  const onSubmit = async (data: SignupData) => {
    setLoading(true);
    setError('');
    try {
      // The backend (platform.module_catalog) currently only supports a subset of these modules.
      // E.g., it supports 'hrms', 'attendance', 'leave', 'payroll', 'crm', 'accounts'.
      // It does not support 'projects', 'inventory', 'procurement', 'purchase', 'sales', 'manufacturing', 'pos', 'reports'.
      // Filter out modules that are not supported to avoid a 400 Bad Request error.
      const supportedModules = new Set(['hrms', 'attendance', 'leave', 'payroll', 'recruitment', 'performance', 'learning', 'expense', 'compliance', 'crm', 'accounts', 'whatsapp', 'billing']);
      const validModules = actualModules.filter(m => supportedModules.has(m));
      
      // Ensure at least 'hrms' is requested if everything else is filtered out
      if (validModules.length === 0) validModules.push('hrms');

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
        requestedModules: validModules,
      };

      const res = await fetch(`${API_BASE_URL}/v1/public/signup-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupPayload)
      });

      const result = await readSignupResponse(res);
      if (!res.ok) {
        throw new Error(result.message || `Failed to create account (${res.status})`);
      }

      // Successful signup, open workspace in new tab
      const loginUrl = workspaceLoginUrl(result, result.subdomain || data.subdomain, data.adminEmail);
      window.open(loginUrl, '_blank', 'noopener,noreferrer');
      
      // Redirect current window to home so the form resets
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col font-body relative">
      <Navbar />
      <div className="flex-1 flex flex-col items-center pt-32 pb-24 px-4 sm:px-6 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute -top-48 -left-48 w-96 h-96 bg-primary-light rounded-full blur-[140px] opacity-60 pointer-events-none" />
      <div className="absolute top-1/2 -right-48 w-96 h-96 bg-accent/10 rounded-full blur-[140px] opacity-40 pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.03] pattern-dots pointer-events-none" />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 text-center relative z-10"
      >
        <h1 className="text-4xl sm:text-5xl font-heading font-extrabold text-text-primary tracking-tight mb-3">
          Create Your <span className="gradient-text">Workspace</span>
        </h1>
        <p className="text-text-secondary font-body font-medium text-base">
          Free instant access. No approval queue or credit card required.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-full max-w-4xl space-y-6"
      >
        {/* Modern Glass Selected Modules Banner */}
        <div className="bg-white/80 backdrop-blur-md border border-border shadow-md rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-center gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center text-primary">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <div className="text-left">
              <span className="font-heading font-bold text-text-primary text-base block">
                {actualModules.length === 0 ? 'No Modules Selected' : `${actualModules.length} Modules Selected`}
              </span>
              {actualModules.length > 0 && (
                <span className="text-xs text-text-secondary font-body font-medium">{selectedModuleNames}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsModulesDrawerOpen(true)}
            className="px-5 py-2.5 rounded-xl bg-bg border border-border hover:border-primary/30 hover:bg-surface font-body font-bold text-xs text-text-primary transition-all duration-300 shadow-sm active:scale-95 flex items-center gap-1.5"
          >
            {actualModules.length === 0 ? 'Select Modules' : 'Change modules selection'}
          </button>
        </div>

        {/* Main Form */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="bg-surface rounded-3xl border border-border shadow-xl hover:shadow-2xl hover:border-primary/10 transition-all duration-500 p-8 sm:p-12 relative z-10"
        >
          {/* Top highlight bar */}
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-accent rounded-t-3xl" />

          {error && (
            <div className="bg-danger/5 border border-danger/20 text-danger p-4 rounded-xl mb-8 text-sm font-body font-semibold flex items-center gap-3 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-danger" />
              {error}
            </div>
          )}

          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Full Name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">First and Last Name</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <User size={18} />
                  </div>
                  <input
                    {...register('adminName')}
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.adminName ? 'border-danger' : 'border-border'
                    }`}
                    placeholder="John Doe"
                  />
                </div>
                {errors.adminName && (
                  <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.adminName.message}
                  </span>
                )}
              </div>

              {/* Company Name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Company Name</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Building size={18} />
                  </div>
                  <input
                    {...register('companyName')}
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.companyName ? 'border-danger' : 'border-border'
                    }`}
                    placeholder="Acme Corp"
                  />
                </div>
                {errors.companyName && (
                  <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.companyName.message}
                  </span>
                )}
              </div>

              {/* Interactive Subdomain Widget */}
              <div className="md:col-span-2 bg-primary/5 border border-primary/10 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Your Workspace Domain</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {!isEditingSubdomain ? (
                      <>
                        <span className="text-text-primary font-heading font-extrabold text-lg select-all bg-primary/10 px-2.5 py-0.5 rounded-lg">
                          {watch('subdomain') || 'yourcompany'}
                        </span>
                        <span className="text-text-secondary font-body font-semibold text-base">.unifiedtree.com</span>
                        <button
                          type="button"
                          onClick={() => setIsEditingSubdomain(true)}
                          className="ml-2 text-primary hover:text-primary-dark hover:scale-110 p-1.5 bg-white border border-border shadow-sm rounded-lg transition-all"
                          title="Edit Subdomain"
                        >
                          <Edit2 size={13} />
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 w-full max-w-xs">
                        <input
                          {...register('subdomain')}
                          autoFocus
                          onBlur={() => setIsEditingSubdomain(false)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              setIsEditingSubdomain(false);
                            }
                          }}
                          className="border border-primary rounded-lg px-2.5 py-1 text-sm text-text-primary font-heading font-bold w-full focus:ring-2 focus:ring-primary/20 bg-white"
                        />
                        <span className="text-text-secondary font-body font-bold">.unifiedtree.com</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-text-secondary font-body max-w-xs text-left leading-relaxed">
                  This custom web address is where your administrators and employees will log in to access your modules.
                </div>
              </div>
              {errors.subdomain && (
                <span className="text-danger text-xs md:col-span-2 flex items-center gap-1 -mt-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                  {errors.subdomain.message}
                </span>
              )}

              {/* Email */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Email Address</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Mail size={18} />
                  </div>
                  <input
                    {...register('adminEmail')}
                    type="email"
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.adminEmail ? 'border-danger' : 'border-border'
                    }`}
                    placeholder="you@company.com"
                  />
                </div>
                {errors.adminEmail && (
                  <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.adminEmail.message}
                  </span>
                )}
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Phone Number</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Phone size={18} />
                  </div>
                  <input
                    {...register('adminMobile')}
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.adminMobile ? 'border-danger' : 'border-border'
                    }`}
                    placeholder="+91 9876543210"
                  />
                </div>
                {errors.adminMobile && (
                  <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.adminMobile.message}
                  </span>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Password</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Lock size={18} />
                  </div>
                  <input
                    {...register('password')}
                    type="password"
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.password ? 'border-danger' : 'border-border'
                    }`}
                    placeholder="Create a password"
                  />
                </div>
                {errors.password && (
                  <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.password.message}
                  </span>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Confirm Password</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Lock size={18} />
                  </div>
                  <input
                    {...register('confirmPassword')}
                    type="password"
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                      errors.confirmPassword ? 'border-danger' : 'border-border'
                    }`}
                    placeholder="Repeat password"
                  />
                </div>
                {errors.confirmPassword && (
                  <span className="text-danger text-xs mt-1.5 font-body flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    {errors.confirmPassword.message}
                  </span>
                )}
              </div>

              {/* Country */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Country</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary pointer-events-none z-10 transition-colors">
                    <Globe size={18} />
                  </div>
                  <select
                    {...register('country')}
                    className="w-full pl-11 pr-10 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer border-border text-text-primary"
                  >
                    <option value="India">India</option>
                    <option value="United States">United States</option>
                    <option value="United Kingdom">United Kingdom</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Language</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary pointer-events-none z-10 transition-colors">
                    <Languages size={18} />
                  </div>
                  <select
                    {...register('language')}
                    className="w-full pl-11 pr-10 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer border-border text-text-primary"
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Company Size */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Company Size</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary pointer-events-none z-10 transition-colors">
                    <Users size={18} />
                  </div>
                  <select
                    {...register('companySize')}
                    className="w-full pl-11 pr-10 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer border-border text-text-primary"
                  >
                    <option value="1 - 5 employees">1 - 5 employees</option>
                    <option value="5 - 20 employees">5 - 20 employees</option>
                    <option value="20 - 50 employees">20 - 50 employees</option>
                    <option value="50+ employees">50+ employees</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Primary Interest */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-primary mb-1.5">Primary Interest</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary pointer-events-none z-10 transition-colors">
                    <Target size={18} />
                  </div>
                  <select
                    {...register('primaryInterest')}
                    className="w-full pl-11 pr-10 py-3 rounded-xl border text-sm font-body bg-bg/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer border-border text-text-primary"
                  >
                    <option value="Use it in my company">Use it in my company</option>
                    <option value="Offer it to my clients">Offer it to my clients</option>
                    <option value="Other">Other</option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

            </div>

            {/* Footer details & Action */}
            <div className="pt-10 border-t border-border mt-8 text-center md:col-span-2">
              <p className="text-xs text-text-secondary font-body mb-6 leading-relaxed">
                By clicking on <strong>Start Now</strong>, you accept our{' '}
                <a href="#" className="text-primary font-semibold hover:underline transition-all">Subscription Agreement</a>{' '}
                and <a href="#" className="text-primary font-semibold hover:underline transition-all">Privacy Policy</a>.
              </p>
              
              <button
                type="submit"
                disabled={loading}
                className="px-16 py-4 bg-primary text-white text-base font-body font-semibold rounded-xl hover:bg-primary-dark transition-all duration-300 disabled:opacity-70 flex items-center justify-center gap-2.5 mx-auto min-w-[240px] shadow-teal hover:shadow-teal-lg active:scale-[0.99] transform btn-shimmer"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Start Now'}
              </button>

              <p className="text-center text-sm text-text-secondary font-body mt-6">
                Already have an account?{' '}
                <Link to="/login" className="text-primary font-semibold hover:text-primary-dark hover:underline transition-colors">
                  Sign In
                </Link>
              </p>
            </div>
          </div>
        </form>
      </motion.div>

      {/* Dynamic Modules Drawer */}
      <AnimatePresence>
        {isModulesDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModulesDrawerOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-border"
            >
              <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-surface">
                <div>
                  <h2 className="text-xl font-heading font-bold text-text-primary">Customize Modules</h2>
                  <p className="text-sm text-text-secondary mt-1">Select the features you need</p>
                </div>
                <button
                  onClick={() => setIsModulesDrawerOpen(false)}
                  className="p-2 rounded-full hover:bg-bg text-text-secondary hover:text-text-primary transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                {modules.map((mod) => {
                  const isSelected = selectedModules.includes(mod.id);
                  return (
                    <div
                      key={mod.id}
                      onClick={() => toggleModule(mod.id)}
                      className={`relative flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/30 hover:bg-surface'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-primary text-white' : 'bg-primary-light text-primary'
                      }`}>
                        <span className="text-sm font-heading font-extrabold">{mod.name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-heading font-bold text-sm text-text-primary truncate pr-2">{mod.name}</h3>
                          <span className="text-xs font-bold text-primary">₹{mod.basePrice}/mo</span>
                        </div>
                        <p className="text-xs text-text-secondary leading-snug">{mod.description}</p>
                      </div>
                      <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-primary border-primary text-white' : 'border-slate-300'
                      }`}>
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-6 border-t border-border bg-surface">
                <button
                  onClick={() => setIsModulesDrawerOpen(false)}
                  className="w-full py-3.5 bg-primary text-white font-body font-bold rounded-xl hover:bg-primary-dark transition-colors shadow-md"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

