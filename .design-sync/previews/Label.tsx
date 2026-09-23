import { Label, Input } from '@unifiedtree/design-sync-entry'

// Label bound to its input with htmlFor.
export function WithInput() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5">
      <Label htmlFor="emp-code">Employee code</Label>
      <Input id="emp-code" defaultValue="EMP-0142" />
    </div>
  )
}

// required adds the asterisk.
export function Required() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5">
      <Label htmlFor="work-email" required>Work email</Label>
      <Input id="work-email" type="email" placeholder="name@company.in" />
    </div>
  )
}

// Two label/input pairs side by side.
export function FormPair() {
  return (
    <div className="grid w-full max-w-sm grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="first-name" required>First name</Label>
        <Input id="first-name" defaultValue="Ananya" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="last-name">Last name</Label>
        <Input id="last-name" defaultValue="Iyer" />
      </div>
    </div>
  )
}
