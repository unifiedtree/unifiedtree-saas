import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Hammer, ArrowLeft } from 'lucide-react'

/**
 * Placeholder for HR module screens that are designed (per the client mockup)
 * but whose backend + UI are still being built. Routed via /hrms/soon/:key so
 * the full client nav structure is navigable without any 404s. Each entry below
 * carries the client's screen title + a one-line description of what it will do.
 */
const SOON: Record<string, { title: string; desc: string }> = {
  'rules-policies':       { title: 'Rules & Policies', desc: 'Configure shift types and leave-type rules in one place.' },
  'att-analytics':        { title: 'Attendance Analytics', desc: 'Workforce attendance KPIs, weekly trends and on-time rate.' },
  'shifts-ot':            { title: 'Shifts & Overtime', desc: 'Publish shift rosters and approve overtime with rate multipliers.' },
  'hiring-pipeline':      { title: 'Hiring Pipeline', desc: 'Job openings, applicant tracking and offer management.' },
  'emp-vault':            { title: 'Employee Vault', desc: 'Letters, contracts and a verified document vault per employee.' },
  'payroll-dashboard':    { title: 'Payroll Dashboard', desc: 'Total cost, average salary, pending disbursals and tax liabilities.' },
  'salary-structure':     { title: 'Salary Structure', desc: 'Per-employee CTC breakdown and bulk revisions.' },
  'pli':                  { title: 'Production-Linked Incentive', desc: 'Targets vs achieved with PLI multipliers and bonus pools.' },
  'advances':             { title: 'Advances & Loans', desc: 'Issue advances, track EMI recovery and remaining balances.' },
  'bank-disbursement':    { title: 'Bank Disbursement', desc: 'NEFT/RTGS payout batches and bank advice files.' },
  'expense-center':       { title: 'Expense Center', desc: 'Expense claims, travel advances and reimbursement batches.' },
  'emp-performance':      { title: 'Employee Performance', desc: 'Overall ratings, scores and review history.' },
  'appraisals':           { title: 'Appraisals & 360° Feedback', desc: 'Review cycles with manager and peer feedback.' },
  'kpi-tracking':         { title: 'KPI Tracking', desc: 'Define KPIs with owners, targets and live progress.' },
  'skill-matrix':         { title: 'Skill Matrix', desc: 'Skill distribution radar and per-employee proficiency.' },
  'training':             { title: 'Training Programs', desc: 'Schedule sessions and track enrollment and completion.' },
  'certifications':       { title: 'Certifications & Compliance', desc: 'Certification validity and renewal reminders.' },
  'statutory':            { title: 'Statutory Compliance', desc: 'PF, ESI, PT and TDS filings with challan tracking.' },
  'muster-roll':          { title: 'Muster Roll (Factory Act)', desc: 'Labour-inspector register formats and audit status.' },
  'posh':                 { title: 'POSH Case Management', desc: 'Confidential incident logging and investigation workflow.' },
  'inspector-view':       { title: 'Inspector View', desc: 'Temporary secure read-only links for government auditors.' },
  'compliance-calendar':  { title: 'Compliance Calendar', desc: 'Statutory filing deadlines synced to a calendar.' },
  'payroll-reports':      { title: 'Payroll Reports', desc: 'Salary register, tax reports, PF/ESI returns and variance.' },
  'workforce-analytics':  { title: 'Workforce Analytics', desc: 'Growth trend, department distribution, attrition and diversity.' },
  'resignation':          { title: 'Resignation & Exit Workflow', desc: 'Initiate exits, notice periods and clearance tracking.' },
  'fnf':                  { title: 'Full & Final Settlement', desc: 'Dues, leave encashment and settlement payouts.' },
  'notification-templates': { title: 'Notification Templates', desc: 'Email and push templates with merge fields.' },
  'integrations':         { title: 'Integrations', desc: 'Connect Google Workspace, Slack, biometric devices and more.' },
}

export const ModuleComingSoon: React.FC = () => {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const entry = SOON[key] ?? { title: 'This module', desc: 'This screen is being built.' }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft size={15} /> Back
      </button>
      <div className="rounded-2xl border border-border-default bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF4E1] text-[#FF9D00]">
          <Hammer size={26} />
        </div>
        <h1 className="text-xl font-bold text-text-primary">{entry.title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">{entry.desc}</p>
        <span className="mt-5 inline-flex items-center rounded-full bg-[#FFF4E1] px-3 py-1 text-xs font-semibold text-[#C16E00]">
          Being built — coming soon
        </span>
      </div>
    </div>
  )
}

export default ModuleComingSoon
