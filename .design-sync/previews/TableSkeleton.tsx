import { TableSkeleton } from '@unifiedtree/design-sync-entry'

// The defaults (5 rows × 4 cols) inside a table card — the shape a DataTable
// list shows while its first page loads. Rows fade toward the bottom.
export function Default() {
  return (
    <div className="ut-card overflow-hidden">
      <TableSkeleton />
    </div>
  )
}

// rows={6} cols={2}: the label / value list of the employee Personal tab
// (EmployeePersonal.tsx), rendered bare inside its panel.
export function SixRowsTwoColumns() {
  return <TableSkeleton rows={6} cols={2} />
}

// rows={2} cols={4}: the short salary-structure table on the Payroll tab
// (EmployeePayroll.tsx).
export function TwoRowsFourColumns() {
  return <TableSkeleton rows={2} cols={4} />
}
