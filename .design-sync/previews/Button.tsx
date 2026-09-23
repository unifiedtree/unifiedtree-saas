import { Button } from '@unifiedtree/design-sync-entry'
import { ArrowRight, Download, Pencil, Plus, Send } from 'lucide-react'

// Every variant, labelled with the action it is used for.
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary">Run payroll</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="outline">Export</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete run</Button>
      <Button variant="danger-ghost">Remove</Button>
      <Button variant="link">View payslip</Button>
    </div>
  )
}

// Text sizes xs to lg, then the two square icon sizes.
export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Edit</Button>
      <Button size="sm">Add employee</Button>
      <Button size="md">Approve</Button>
      <Button size="lg">Run payroll</Button>
      <Button size="icon" aria-label="Add"><Plus /></Button>
      <Button size="icon-sm" variant="secondary" aria-label="Edit"><Pencil /></Button>
    </div>
  )
}

// leftIcon / rightIcon, as the workspace section headers use them.
export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" leftIcon={<Plus size={14} />}>Add employee</Button>
      <Button size="sm" variant="secondary" leftIcon={<Download size={14} />}>Export CSV</Button>
      <Button size="sm" variant="outline" leftIcon={<Send size={14} />}>Send letter</Button>
      <Button size="sm" rightIcon={<ArrowRight size={14} />}>Next step</Button>
    </div>
  )
}

// loading swaps the left icon for a spinner and disables; disabled dims.
export function States() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button loading>Saving</Button>
      <Button disabled>Approve</Button>
      <Button variant="secondary" loading>Exporting</Button>
      <Button variant="outline" disabled>Send letter</Button>
      <Button variant="danger" loading>Deleting</Button>
    </div>
  )
}

// The form footer the employee workspace renders: full-width submit.
export function FormSubmit() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Button type="submit" className="w-full">Save changes</Button>
      <Button type="submit" className="w-full" loading>Save changes</Button>
      <Button type="submit" className="w-full" disabled>Save changes</Button>
    </div>
  )
}
