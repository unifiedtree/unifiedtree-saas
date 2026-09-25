// The dashboard's "Export headcount" workbook: Summary + Employees sheets built
// from GET /v1/reports/headcount/workbook with the shared .xlsx writer. Names
// only (no ids), readable headers, one file per company and date.
import type { Cell, Sheet } from '@/shared/export/fileExport'
import { fmtShort, dt, MONTHS } from '@/design/dc/dates'
import type { HeadcountGroup, HeadcountWorkbookData } from '../api/useReports'

/** headcount-<company>-<yyyy-mm-dd>.xlsx, with the company name made safe for a file name. */
export function headcountFileName(company: string | undefined, asOf: string): string {
  const safe = (company || 'company').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'company'
  return `headcount-${safe}-${asOf}.xlsx`
}

const MONTH = (m: string) => m.charAt(0) + m.slice(1).toLowerCase()
const prepared = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function headcountSheets(wb: HeadcountWorkbookData): Sheet[] {
  const rows: Cell[][] = []
  const bold: number[] = []
  const t = wb.totals
  const endMonth = MONTHS[dt(wb.fiscalYear.to).getMonth()]
  rows.push(['Headcount summary'])
  rows.push(['Company', wb.companyName])
  rows.push(['As of', fmtShort(wb.asOf)])
  rows.push(['Fiscal year', `${wb.fiscalYear.label} (${MONTH(wb.fiscalYear.startMonth)} to ${endMonth})`])
  rows.push(['Prepared', `${prepared()} IST`])
  rows.push([])
  bold.push(rows.length); rows.push(['Totals', 'People'])
  rows.push(['Total headcount', t.total])
  rows.push(['Active (confirmed)', t.active])
  rows.push(['On probation', t.probation])
  rows.push(['On notice', t.onNotice])
  rows.push(['Suspended', t.suspended])
  rows.push(['Joined this month', t.joinedThisMonth])
  rows.push(['Left this month', t.leftThisMonth])
  rows.push([`Joined this fiscal year (${wb.fiscalYear.label})`, t.joinedThisFiscalYear])
  rows.push([`Left this fiscal year (${wb.fiscalYear.label})`, t.leftThisFiscalYear])
  const table = (title: string, groups: HeadcountGroup[]) => {
    rows.push([])
    bold.push(rows.length); rows.push([title, 'Total', 'Active', 'On probation', 'On notice'])
    if (!groups.length) rows.push(['Nobody', 0, 0, 0, 0])
    for (const g of groups) rows.push([g.name, g.total, g.active, g.probation, g.onNotice])
  }
  table('By department', wb.byDepartment)
  table('By branch', wb.byBranch)
  table('By designation', wb.byDesignation)
  table('By employment type', wb.byEmploymentType)
  if (wb.genderIncluded && wb.byGender) table('By gender', wb.byGender)
  const notes: string[] = []
  if (wb.pastDate) notes.push('Statuses on a past date are worked out from joining, confirmation, probation, notice and exit dates.')
  if (!wb.employeesIncluded) notes.push('The employee list isn’t included: your role can’t read employee records.')
  if (!wb.genderIncluded) notes.push('The gender breakdown isn’t included: your role can’t read the diversity report.')
  if (notes.length) {
    rows.push([])
    bold.push(rows.length); rows.push(['Notes'])
    for (const n of notes) rows.push([n])
  }
  const sheets: Sheet[] = [{ name: 'Summary', rows, bold, widths: [44, 14, 12, 14, 12] }]
  if (wb.employeesIncluded && wb.employees) {
    sheets.push({
      name: 'Employees',
      widths: [16, 26, 22, 22, 20, 16, 14, 16, 24, 30, 16, 16],
      rows: [
        ['Employee code', 'Name', 'Department', 'Designation', 'Branch', 'Employment type', 'Status', 'Date of joining', 'Reporting manager', 'Work email', 'Probation ends', 'Notice last day'],
        ...wb.employees.map((e) => [e.employeeCode, e.name, e.department, e.designation, e.branch, e.employmentType, e.status,
          e.dateOfJoining, e.reportingManager, e.workEmail, e.probationEnds, e.noticeLastDay]),
      ],
    })
  }
  return sheets
}
