import { Separator, Card, CardContent } from '@unifiedtree/design-sync-entry'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

// Horizontal rules between stacked sections.
export function Horizontal() {
  return (
    <div className="w-full max-w-sm text-sm">
      <div className="py-2">
        <div className="font-medium">Ananya Iyer</div>
        <div className="text-xs text-gray-500">EMP-0142 · Product Design</div>
      </div>
      <Separator />
      <div className="flex justify-between py-2"><span className="text-gray-500">Date of joining</span><span>12 Mar 2024</span></div>
      <Separator />
      <div className="flex justify-between py-2"><span className="text-gray-500">Reporting manager</span><span>Priya Sharma</span></div>
      <Separator />
      <div className="flex justify-between py-2"><span className="text-gray-500">Location</span><span>Bengaluru</span></div>
    </div>
  )
}

// Vertical separators in an inline meta row (the container sets the height).
export function Vertical() {
  return (
    <div className="flex items-center gap-3 text-sm" style={{ height: 20 }}>
      <span className="font-medium">EMP-0142</span>
      <Separator orientation="vertical" />
      <span className="text-gray-500">Engineering</span>
      <Separator orientation="vertical" />
      <span className="text-gray-500">Bengaluru</span>
      <Separator orientation="vertical" />
      <span className="text-gray-500">Full-time</span>
    </div>
  )
}

// Inside a card, spaced with className.
export function InCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="pt-5 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Gross</span><span className="tabular-nums">{inr(92500)}</span></div>
        <Separator className="my-3" />
        <div className="flex justify-between"><span className="text-gray-500">Deductions</span><span className="tabular-nums">− {inr(11840)}</span></div>
        <Separator className="my-3" />
        <div className="flex justify-between font-semibold"><span>Net pay</span><span className="tabular-nums">{inr(80660)}</span></div>
      </CardContent>
    </Card>
  )
}
