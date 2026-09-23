import { Input } from '@unifiedtree/design-sync-entry'
import { CalendarDays, IndianRupee, Search } from 'lucide-react'

// Placeholder and filled.
export function Basic() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Input placeholder="Search employees" />
      <Input defaultValue="Ananya Iyer" />
    </div>
  )
}

// leftElement / rightElement take an icon and pad the text away from it.
export function WithElements() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Input leftElement={<Search size={16} />} placeholder="Search by name or code" />
      <Input leftElement={<IndianRupee size={16} />} defaultValue="92,500" />
      <Input rightElement={<CalendarDays size={16} />} defaultValue="18 Sep 2026" />
    </div>
  )
}

// invalid, disabled and read-only.
export function States() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Input invalid defaultValue="98765" />
      <Input disabled defaultValue="EMP-0142" />
      <Input readOnly defaultValue="Engineering" />
    </div>
  )
}

// Native input types the forms use.
export function Types() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <Input type="date" defaultValue="2026-09-18" />
      <Input type="number" defaultValue={46250} />
      <Input type="email" defaultValue="ananya.iyer@unifiedtree.in" />
    </div>
  )
}
