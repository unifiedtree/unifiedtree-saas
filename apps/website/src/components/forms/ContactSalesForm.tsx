import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, inputCls } from './DemoRequestForm'

const schema = z.object({
  name:      z.string().min(2, 'Enter your full name'),
  workEmail: z.string().email('Enter a valid work email'),
  company:   z.string().min(2, 'Enter your company name'),
  employees: z.enum(['1-10', '11-50', '51-200', '201-500', '500+'], {
    required_error: 'Pick employee count',
  }),
  timeline:  z.enum(['immediate', '1-3-months', '3-6-months', 'exploring'], {
    required_error: 'Pick a timeline',
  }),
  message:   z.string().min(10, 'Tell us a little about your needs').max(1000, 'Under 1000 characters please'),
})
type FormValues = z.infer<typeof schema>

/**
 * Contact-sales form. Submission is MOCKED. Same TODO(backend) applies as
 * DemoRequestForm — no lead is captured server-side yet.
 */
export function ContactSalesForm() {
  const [submitted, setSubmitted] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (_values: FormValues) => {
    await new Promise((r) => setTimeout(r, 700))
    setSubmitted(true)
  }

  if (submitted) return <ThanksState />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field label="Full name" error={errors.name?.message}>
        <input {...register('name')} className={inputCls} placeholder="Jane Doe" />
      </Field>

      <Field label="Work email" error={errors.workEmail?.message}>
        <input {...register('workEmail')} type="email" className={inputCls} placeholder="jane@company.com" />
      </Field>

      <Field label="Company" error={errors.company?.message}>
        <input {...register('company')} className={inputCls} placeholder="Company Pvt Ltd" />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Number of employees" error={errors.employees?.message}>
          <select {...register('employees')} className={inputCls} defaultValue="">
            <option value="" disabled>Select</option>
            <option value="1-10">1 – 10</option>
            <option value="11-50">11 – 50</option>
            <option value="51-200">51 – 200</option>
            <option value="201-500">201 – 500</option>
            <option value="500+">500+</option>
          </select>
        </Field>

        <Field label="Timeline" error={errors.timeline?.message}>
          <select {...register('timeline')} className={inputCls} defaultValue="">
            <option value="" disabled>Select</option>
            <option value="immediate">Ready to buy now</option>
            <option value="1-3-months">1 – 3 months</option>
            <option value="3-6-months">3 – 6 months</option>
            <option value="exploring">Just exploring</option>
          </select>
        </Field>
      </div>

      <Field label="How can we help?" error={errors.message?.message}>
        <textarea {...register('message')} rows={4} className={inputCls} placeholder="Tell us about your team, current tools, must-have modules..." />
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={isSubmitting} className="mt-2 font-semibold">
        {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : 'Contact sales'}
      </Button>

      <p className="text-center text-xs text-text-tertiary">
        Our sales team responds within one working day.
      </p>
    </form>
  )
}

function ThanksState() {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
        <CheckCircle2 size={28} />
      </div>
      <h3 className="mb-2 font-heading text-xl font-bold text-text-primary">Thanks — we'll be in touch</h3>
      <p className="mx-auto max-w-md text-sm text-text-secondary">
        We received your enquiry. Our sales team will get back to you within one working day.
      </p>
    </div>
  )
}
