// Payroll module page (Payroll Dashboard · Salary Structure · Processing &
// Payslips · Payroll Settings · PLI · Advances & Loans · Bank Disbursement) —
// ported from the design component PayrollModule.dc.html. The section comes from
// the route; data and actions for each section come from PayrollContainer via `px`.
import { DCLogic, dc } from './dc-runtime'
import { PayrollModuleView } from './PayrollModule.view'
import { dashIcon } from './icons'

// Payroll Settings opens in HRMS settings, the one settings place in HRMS.
export const PAYROLL_ROUTES: Record<string, string> = {
  dashboard: '/hrms/payroll-dashboard', salary: '/hrms/salary-structure', runs: '/hrms/payroll/runs', settings: '/hrms/settings/payroll',
  pli: '/hrms/pli', advances: '/hrms/advances', bank: '/hrms/bank-disbursement',
}
const SECTIONS: [string, string, string][] = [
  ['dashboard', 'Payroll Dashboard', 'dashboard'], ['salary', 'Salary Structure', 'list'], ['runs', 'Processing & Payslips', 'receipt'],
  ['settings', 'Payroll Settings', 'settings'], ['pli', 'Production-Linked Incentive', 'target'], ['advances', 'Advances & Loans', 'creditCard'],
  ['bank', 'Bank Disbursement', 'building'],
]

/** A page with unsaved changes (Payroll Settings) can ask before the module switches section. */
declare global { interface Window { __utLeaveGuard?: ((proceed: () => void) => boolean) | null } }

export class PayrollModule extends DCLogic {
  renderVals() {
    const p = this.props, nav: ((path: string) => void) | undefined = p.onNavigate
    const section: string = p.section || 'runs', runId: string = p.runId || ''
    const visible: string[] = p.sections || SECTIONS.map((s) => s[0])
    const go = (sec: string, extra?: { runId?: string; tab?: string; focus?: string; force?: boolean }) => {
      const e = extra || {}
      if (!e.force && typeof window.__utLeaveGuard === 'function' && window.__utLeaveGuard(() => go(sec, { ...e, force: true }))) return
      const base = PAYROLL_ROUTES[sec] || PAYROLL_ROUTES.runs
      const path = sec === 'runs' && e.runId ? `${base}/${e.runId}${e.tab ? '?tab=' + e.tab : ''}` : sec === 'bank' && e.runId ? `${base}?run=${e.runId}` : sec === 'salary' && e.focus ? `${base}?employee=${e.focus}` : base
      if (nav) nav(path)
    }
    const sections = SECTIONS.filter(([k]) => visible.includes(k)).map(([k, label, icon]) => {
      const on = k === section, detail = on && k === 'runs' && !!runId
      return {
        label, icon: dashIcon(icon, 17), active: on, inactive: !on, tip: detail ? 'Back to all payroll runs' : on ? 'You are here' : '',
        onClick: () => { if (!on || detail) go(k) },
      }
    })
    return {
      hasMsg: false, msg: '', sections, go, toast: p.onToast, navFn: nav || null, state: 'live', mobile: !!p.mobile,
      sDash: section === 'dashboard', sSalary: section === 'salary', sRuns: section === 'runs' && !runId, sRun: section === 'runs' && !!runId,
      sSettings: section === 'settings', sPli: section === 'pli', sAdvances: section === 'advances', sBank: section === 'bank',
      runId, runTab: p.runTab || '', focus: p.focus || '',
      // Prototype-only wiring (its run lifecycle lived in page state); real data arrives through px.
      initialStep: 'draft', skipped: false, resume: null, fixed: [], runStatusAll: {}, sepStatus: null,
      canManage: !!p.canManage, companiesMode: 'one', settingsAccess: p.settingsAccess || 'view', settingsSaveFails: false,
      createRun: undefined, saveStatus: undefined, fixEmployee: (code: string) => go('salary', { focus: code }), markFixed: undefined,
      px: p.px || {},
    }
  }
  render() { return dc(this, PayrollModuleView, 'PayrollModule') }
}
