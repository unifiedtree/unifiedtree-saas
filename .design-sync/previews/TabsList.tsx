import { Tabs, TabsContent, TabsList, TabsTrigger } from '@unifiedtree/design-sync-entry'

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

// TabsList reads the variant from Tabs: under `underline` it is the full-width
// strip with the bottom rule the triggers sit on.
export function UnderlineStrip() {
  return (
    <Tabs defaultValue="overview" variant="underline">
      <TabsList aria-label="Employee record sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
        <TabsTrigger value="job">Job</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="personal" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="job" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="documents" className="pt-4"><FactGrid /></TabsContent>
    </Tabs>
  )
}

// Under `pills` the list becomes a w-fit tray with an inset padding, so it
// hugs its triggers instead of spanning the row.
export function PillsTray() {
  return (
    <Tabs defaultValue="attendance" variant="pills">
      <TabsList aria-label="Employee workspace">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="attendance">Attendance</TabsTrigger>
        <TabsTrigger value="payroll">Payroll</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="attendance" className="pt-4"><FactGrid /></TabsContent>
      <TabsContent value="payroll" className="pt-4"><FactGrid /></TabsContent>
    </Tabs>
  )
}
