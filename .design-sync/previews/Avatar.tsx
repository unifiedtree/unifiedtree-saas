import { Avatar, Badge } from '@unifiedtree/design-sync-entry'

// Inline SVG so the photo cell renders offline and deterministically.
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fde68a"/><circle cx="32" cy="24" r="12" fill="#b45309"/><path d="M6 64c2-16 12-25 26-25s24 9 26 25z" fill="#b45309"/></svg>',
  )

// name-only initials at each size.
export function Sizes() {
  const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const
  return (
    <div className="flex items-end gap-4">
      {sizes.map(s => (
        <div key={s} className="flex flex-col items-center gap-1">
          <Avatar name="Priya Sharma" size={s} />
          <span className="text-xs text-gray-500">{s}</span>
        </div>
      ))}
    </div>
  )
}

// Initials come from the first two words; no name falls back to "?".
export function Initials() {
  return (
    <div className="flex items-center gap-3">
      <Avatar name="Priya Sharma" />
      <Avatar name="Arjun Mehta" />
      <Avatar name="Sneha Reddy Kondapalli" />
      <Avatar name="Vikram" />
      <Avatar />
    </div>
  )
}

// src renders the photo; the same person falls back to initials without one.
export function WithPhoto() {
  return (
    <div className="flex items-center gap-3">
      <Avatar src={PHOTO} name="Rahul Verma" size="xl" />
      <Avatar src={PHOTO} name="Rahul Verma" size="md" />
      <Avatar name="Rahul Verma" size="md" />
    </div>
  )
}

// ring: a surface-coloured halo that keeps overlapping avatars separated.
export function ApproverStack() {
  const names = ['Priya Sharma', 'Arjun Mehta', 'Sneha Reddy', 'Vikram Nair']
  return (
    <div className="flex items-center">
      {names.map((n, i) => (
        <Avatar key={n} name={n} size="sm" ring style={{ marginLeft: i ? -8 : 0 }} />
      ))}
      <span className="ml-3 text-xs text-gray-500">+3 more approvers</span>
    </div>
  )
}

// The employee row as the directory renders it.
export function EmployeeRow() {
  return (
    <div className="flex items-center gap-3">
      <Avatar name="Ananya Iyer" size="md" />
      <div className="min-w-0">
        <div className="text-sm font-medium">Ananya Iyer</div>
        <div className="text-xs text-gray-500">EMP-0142 · Product Design</div>
      </div>
      <Badge tone="success" dot className="ml-auto">Active</Badge>
    </div>
  )
}
