import { Field, Input } from '@unifiedtree/design-sync-entry'
import { Mail } from 'lucide-react'

// The employee form group (EmployeeForm shape): label, required mark, hint.
export function EmployeeForm() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Field label="Employee code" required hint="Auto-generated if left blank">
        <Input placeholder="e.g. EMP-1024" defaultValue="EMP-0142" />
      </Field>
      <Field label="Work email" required>
        <Input type="email" leftElement={<Mail size={16} />} defaultValue="ananya.iyer@unifiedtree.in" />
      </Field>
      <Field label="Date of joining" required>
        <Input type="date" defaultValue="2024-03-12" />
      </Field>
    </div>
  )
}

// hint under the input.
export function WithHint() {
  return (
    <div className="w-full max-w-sm">
      <Field label="PAN" hint="10 characters, as printed on the PAN card">
        <Input defaultValue="ABCDE1234F" className="uppercase" />
      </Field>
    </div>
  )
}

// error replaces the hint and marks the input invalid.
export function WithError() {
  return (
    <div className="w-full max-w-sm">
      <Field label="Phone" required hint="Used for OTP login" error="Enter a 10-digit mobile number">
        <Input type="tel" defaultValue="98765" />
      </Field>
    </div>
  )
}

// A locked value: disabled input with an explanatory hint.
export function Disabled() {
  return (
    <div className="w-full max-w-sm">
      <Field label="Employee code" hint="Assigned by HR and cannot be changed">
        <Input defaultValue="EMP-0142" disabled />
      </Field>
    </div>
  )
}
