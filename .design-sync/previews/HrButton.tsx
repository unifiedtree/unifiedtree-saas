import { HrButton } from '@unifiedtree/design-sync-entry'
import { Banknote, Building2, Check, ChevronRight, Download, Plus, Trash2, Upload, X } from 'lucide-react'

// The three variants at the default (md) size: brand primary, bordered
// ghost, and the destructive danger fill.
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <HrButton>Add Employee</HrButton>
      <HrButton variant="ghost">Org Setup</HrButton>
      <HrButton variant="danger">Delete department</HrButton>
    </div>
  )
}

// sm (h-8, 12px text) is the table-row / inline size; md (h-10, 14px text)
// is the toolbar size.
export function Sizes() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <HrButton size="sm"><Check size={14} /> Approve</HrButton>
        <HrButton size="sm" variant="ghost"><X size={14} /> Reject</HrButton>
        <HrButton size="sm" variant="ghost">View <ChevronRight size={14} /></HrButton>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <HrButton><Banknote size={15} /> Record disbursement</HrButton>
        <HrButton variant="ghost"><Download size={15} /> Export CSV</HrButton>
      </div>
    </div>
  )
}

// Toolbar composition from the Workforce Directory header: two ghost
// actions and one primary, each with a 15px lucide icon.
export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <HrButton variant="ghost"><Building2 size={15} /> Org Setup</HrButton>
      <HrButton variant="ghost"><Upload size={15} /> Import</HrButton>
      <HrButton><Plus size={15} /> Add Employee</HrButton>
    </div>
  )
}

// disabled drops opacity to 50% and removes pointer events; while a
// mutation is pending the app also swaps the label to "Saving…".
export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <HrButton disabled>Saving…</HrButton>
      <HrButton variant="ghost" disabled>Cancel</HrButton>
      <HrButton variant="danger" disabled><Trash2 size={15} /> Delete</HrButton>
    </div>
  )
}
