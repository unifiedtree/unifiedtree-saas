import { apiJson } from '@/core/api/client'
import type { EmployeeSalaryStructure, SalaryComponent } from '../api/usePayroll'

interface PayrollInput {
  employeeId: string
  ctcAnnual: number
  effectiveFrom: string
  pfApplicable: boolean
  basicSalary: number
  hra: number
  specialAllowance: number
  otherAllowance: number
}

/** Persist the entered breakup through the same salary-structure API as the employee profile. */
export async function saveOnboardingPayroll(input: PayrollInput) {
  const note = 'Initial salary structure from employee onboarding'
  const current = await apiJson<EmployeeSalaryStructure | null>(`/v1/payroll/structures/employee/${input.employeeId}`)
  // A later document-upload retry must not create another salary revision.
  if (current?.revisionNote === note && current.effectiveFrom === input.effectiveFrom) return
  if (current) throw new Error('A salary structure already exists. Review it from the employee Payroll tab before continuing.')
  let catalog = await apiJson<SalaryComponent[]>('/v1/payroll/components')
  const lines = [
    { code: 'BASIC', name: 'Basic Salary', amount: input.basicSalary },
    { code: 'HRA', name: 'House Rent Allowance', amount: input.hra },
    { code: 'SPECIAL', name: 'Special Allowance', amount: input.specialAllowance },
    { code: 'OTHER_ALLOWANCE', name: 'Other Allowance', amount: input.otherAllowance },
  ].filter(line => line.amount > 0)
  for (const line of lines) {
    if (!catalog.some(component => component.code === line.code)) {
      await apiJson('/v1/payroll/components', { method: 'POST', body: JSON.stringify({
        code: line.code, name: line.name, category: 'EARNING', isStatutory: false,
        isTaxable: true, computationType: 'FIXED', displayOrder: 45,
      }) })
      catalog = await apiJson<SalaryComponent[]>('/v1/payroll/components')
    }
  }
  const components = lines.map(line => {
    const component = catalog.find(item => item.code === line.code)
    if (!component?.isActive || component.category !== 'EARNING') throw new Error(`Activate the ${line.name} earning component in Payroll before saving this structure.`)
    return { componentId: component.id, monthlyAmount: line.amount }
  })
  await apiJson('/v1/payroll/structures', { method: 'POST', body: JSON.stringify({
    employeeId: input.employeeId, ctcAnnual: input.ctcAnnual, effectiveFrom: input.effectiveFrom,
    pfApplicable: input.pfApplicable, pfStatus: input.pfApplicable ? 'ENROLLED' : 'NOT_APPLICABLE',
    revisionNote: note, components,
  }) })
}
