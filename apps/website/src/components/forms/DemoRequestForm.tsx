import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { API_BASE_URL } from '../../lib/api'

const schema = z.object({
  name:      z.string().min(2, 'Enter your full name'),
  workEmail: z.string().email('Enter a valid work email'),
  company:   z.string().min(2, 'Enter your company name'),
  size:      z.enum(['1-10', '11-50', '51-200', '201-500', '500+'], {
    required_error: 'Pick your company size',
  }),
  preferred: z.string().optional(),
  notes:     z.string().max(500, 'Under 500 characters please').optional(),
})
type FormValues = z.infer<typeof schema>

/**
 * Demo-request form. Wired 2026-08-13 to POST /v1/public/lead-request so
 * marketing leads are captured server-side and emailed to unifiedtree@gmail.com.
 * See LeadRequestController on the backend.
 */
export function DemoRequestForm() {
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/v1/public/lead-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'demo', ...values }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSubmitted(true)
    } catch (err) {
      // Never lose the lead silently — surface the failure so the visitor can retry.
      setSubmitError("Sorry — we couldn't send that. Please try again or email us at unifiedtree@gmail.com.")
    }
  }

  if (submitted) return <ThanksState kind="demo" />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field label="Full name" error={errors.name?.message}>
        <input {...register('name')} className={inputCls} placeholder="Your full name" />
      </Field>

      <Field label="Work email" error={errors.workEmail?.message}>
        <input {...register('workEmail')} type="email" className={inputCls} placeholder="you@company.com" />
      </Field>

      <Field label="Company" error={errors.company?.message}>
        <input {...register('company')} className={inputCls} placeholder="Company Pvt Ltd" />
      </Field>

      <Field label="Company size" error={errors.size?.message}>
        <select {...register('size')} className={inputCls} defaultValue="">
          <option value="" disabled>Select company size</option>
          <option value="1-10">1 – 10 employees</option>
          <option value="11-50">11 – 50 employees</option>
          <option value="51-200">51 – 200 employees</option>
          <option value="201-500">201 – 500 employees</option>
          <option value="500+">500+ employees</option>
        </select>
      </Field>

      <Field label="Preferred date / time (optional)">
        <input {...register('preferred')} className={inputCls} placeholder="e.g. Weekday afternoons IST" />
      </Field>

      <Field label="Anything specific you want to see? (optional)" error={errors.notes?.message}>
        <textarea {...register('notes')} rows={3} className={inputCls} placeholder="Focus areas, modules, use case..." />
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={isSubmitting} className="mt-2 font-semibold">
        {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : 'Request demo'}
      </Button>

      {submitError ? (
        <p className="text-center text-xs text-danger">{submitError}</p>
      ) : (
        <p className="text-center text-xs text-text-tertiary">
          We'll reach out within one working day.
        </p>
      )}
    </form>
  )
}

function ThanksState({ kind }: { kind: 'demo' | 'sales' }) {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
        <CheckCircle2 size={28} />
      </div>
      <h3 className="mb-2 font-heading text-xl font-bold text-text-primary">Thanks — we'll be in touch</h3>
      <p className="mx-auto max-w-md text-sm text-text-secondary">
        {kind === 'demo'
          ? "We received your demo request. Our team will reach out within one working day to schedule a walkthrough."
          : "We received your enquiry. Our sales team will get back to you within one working day."}
      </p>
    </div>
  )
}

// Local Field + input class helpers — kept co-located so both form files stay
// self-contained (no cross-file dep churn if we ever move them apart).
export function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-text-primary">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
