import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@unifiedtree/design-sync-entry'
import { Briefcase, FileText, User, UserCircle } from 'lucide-react'

const facts: Array<[string, string]> = [
  ['Employee code', 'EMP-0142'],
  ['Department', 'Engineering'],
  ['Designation', 'Senior Engineer'],
  ['Reporting manager', 'Arjun Mehta'],
]

function FactGrid() {
  return (
    <div className="ut-card grid grid-cols-2 gap-x-8 gap-y-3 p-5 text-sm">
      {facts.map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-[var(--text-tertiary)]">{k}</span>
          <span className="font-medium text-[var(--text-primary)]">{v}</span>
        </div>
      ))}
    </div>
  )
}

// A trigger is an inline-flex button, so a leading lucide icon sits beside
// the label with the built-in gap. The `cards` variant tints the active chip.
export function WithIcons() {
  return (
    <Tabs defaultValue="overview" variant="cards">
      <TabsList>
        <TabsTrigger value="overview"><UserCircle size={16} /> Overview</TabsTrigger>
        <TabsTrigger value="personal"><User size={16} /> Personal</TabsTrigger>
        <TabsTrigger value="job"><Briefcase size={16} /> Job</TabsTrigger>
        <TabsTrigger value="documents"><FileText size={16} /> Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="personal" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="job" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="documents" className="pt-4"><FactGrid /></TabsContent>
    </Tabs>
  )
}

// Count badges as trailing children (pending approvals per queue), on the
// underline variant with the Leave tab active.
export function WithCounts() {
  return (
    <Tabs defaultValue="leave" variant="underline">
      <TabsList>
        <TabsTrigger value="leave">Leave <Badge size="sm" tone="accent">12</Badge></TabsTrigger>
        <TabsTrigger value="advance">Advances <Badge size="sm">4</Badge></TabsTrigger>
        <TabsTrigger value="expense">Expenses <Badge size="sm">9</Badge></TabsTrigger>
        <TabsTrigger value="regularisation">Regularisation <Badge size="sm">2</Badge></TabsTrigger>
      </TabsList>
      <TabsContent value="leave" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="advance" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="expense" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="regularisation" className="pt-4"><FactGrid /></TabsContent>
    </Tabs>
  )
}
