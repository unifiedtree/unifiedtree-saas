import { HrAvatar } from '@unifiedtree/design-sync-entry'

// The employee cell as every HR table renders it: two-letter initials on
// a brand tile, the name, and the employee code or department beneath.
export function WithSubline() {
  return (
    <div className="space-y-4">
      <HrAvatar name="Priya Raghavan" sub="EMP-0142" />
      <HrAvatar name="Arjun Mehta" sub="EMP-0087 · Sales" seed={1} />
      <HrAvatar name="Sneha Kulkarni" sub="Finance" seed={2} />
    </div>
  )
}

// Name only — the sub line is omitted, so the tile and name centre together.
export function NameOnly() {
  return (
    <div className="space-y-4">
      <HrAvatar name="Rohan Das" />
      <HrAvatar name="Fatima Sheikh" seed={3} />
    </div>
  )
}

// The four seed colours; screens pass the row index so adjacent rows differ.
export function SeedColours() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <HrAvatar name="Priya Raghavan" sub="Engineering" seed={0} />
        <p className="mt-2 text-xs text-gray-500">seed 0</p>
      </div>
      <div>
        <HrAvatar name="Arjun Mehta" sub="Sales" seed={1} />
        <p className="mt-2 text-xs text-gray-500">seed 1</p>
      </div>
      <div>
        <HrAvatar name="Sneha Kulkarni" sub="Finance" seed={2} />
        <p className="mt-2 text-xs text-gray-500">seed 2</p>
      </div>
      <div>
        <HrAvatar name="Rohan Das" sub="Operations" seed={3} />
        <p className="mt-2 text-xs text-gray-500">seed 3</p>
      </div>
    </div>
  )
}

// A null or empty name (an employee record with no last_name coming back
// NULL from a report) renders "?" initials and an em dash, never a crash
// or an empty row. A single-word name yields one initial.
export function MissingName() {
  return (
    <div className="space-y-4">
      <HrAvatar name={null} sub="EMP-0311" />
      <HrAvatar name="" />
      <HrAvatar name="Rahul" sub="EMP-0056" seed={1} />
    </div>
  )
}

// Both lines truncate inside a narrow table cell.
export function Truncation() {
  return (
    <div style={{ width: 170 }} className="rounded-lg border border-gray-200 p-3">
      <HrAvatar name="Venkatanarasimharaju Subramanyam" sub="EMP-0402 · Platform Engineering" seed={2} />
    </div>
  )
}
