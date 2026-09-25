// Advances & Loans — ported from the design component PayAdvances.dc.html.
// Rows are GET /v1/advance/requests. Approve / reject / record payout use the
// existing decision actions; a paid-out advance's recovery tools (defer a month,
// close early, write off) open the existing detail panel. "Issue advance" asks
// for the signed-in person, or — with hrms.advance.request.others — for anyone
// else (POST /v1/advance/requests/on-behalf): same approval, payout and
// recovery, and the employee is told it was raised for them.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayAdvancesView } from './PayAdvances.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'
import { MON } from './dates'

export interface AdvRow {
  id: string; empId: string; name: string; code: string; type: string; principal: number; emi: number; months: number; left: number
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'DISBURSED' | 'CLOSED'; raw: unknown
  /** Who raised it for the employee (HR / finance); empty when they asked themselves. */
  raisedBy?: string
}
/** Someone an advance can be raised for. */
export interface AdvPerson { id: string; name: string; code: string }
export interface AdvPlanRow { month: string; amount: number; status: 'PENDING' | 'RECOVERED' | 'SKIPPED' | 'CANCELLED' }

/** Design status → [tone, label]; the API's statuses map onto it. */
const statusOf = (a: AdvRow): [string, string, string] =>
  a.status === 'REQUESTED' ? ['warn', 'Pending approval', 'PENDING']
    : a.status === 'APPROVED' ? ['info', 'Approved · to pay out', 'APPROVED']
      : a.status === 'REJECTED' ? ['red', 'Rejected', 'REJECTED']
        : a.status === 'DISBURSED' && a.left > 0 ? ['ok', 'Active deduction', 'ACTIVE'] : ['gray', a.status === 'CLOSED' ? 'Closed' : 'Repaid', 'CLOSED']
const monthLabel = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T00:00:00'); return `${MON[d.getMonth()]} ${d.getFullYear()}` }

export class PayAdvances extends DCLogic {
  state: any = { q: '', status: '', view: null, issue: null, approve: null, busy: false }
  renderVals() {
    const p = this.props, s = this.state
    const st = p.state || 'live', isLoading = st === 'loading', isError = st === 'error'
    const base: AdvRow[] = isLoading || isError ? [] : p.rows || []
    const isEmpty = !isLoading && !isError && base.length === 0, live = !isLoading && !isError && !isEmpty
    const me: string = p.me || '', canApprove = !!p.canApprove, canRequest = !!p.canRequest, canOthers = !!p.canRequestOthers, Decision = p.decisionActions
    const people: AdvPerson[] = p.people || []
    const firstEmp = canRequest ? me : people[0]?.id || ''
    const q = s.q.trim().toLowerCase()
    const all = base.map((a) => {
      const t = statusOf(a)
      return {
        ...a, tone: t[0], statusLabel: t[1], key: t[2], pending: a.status === 'REQUESTED' && canApprove && a.empId !== me,
        principalL: inr(a.principal), leftL: a.status === 'REJECTED' ? '—' : inr(a.left), emiL: a.months > 1 ? `${inr(a.emi)} × ${a.months} months` : 'One-time recovery',
        onView: () => { this.setState({ view: a.id }); if (p.onView) p.onView(a.id) }, onApprove: () => this.setState({ approve: a.id }),
      }
    })
    const rows = all.filter((a) => (!q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)) && (!s.status || a.key === s.status))
    const columns = [
      { key: 'name', header: 'Employee', render: (a: any) => createElement('div', { style: { display: 'grid', gap: 1 } }, createElement('strong', { style: { color: '#0f172a' } }, a.name), createElement('span', { style: { fontSize: 12, color: '#64748b' } }, a.code)) },
      { key: 'type', header: 'Loan type', render: (a: any) => a.type },
      { key: 'principal', header: 'Principal', render: (a: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, a.principalL) },
      { key: 'emi', header: 'EMI / recovery', render: (a: any) => a.emiL },
      { key: 'left', header: 'Remaining', render: (a: any) => createElement('strong', { style: { fontVariantNumeric: 'tabular-nums', color: '#0f172a' } }, a.leftL) },
      { key: 'status', header: 'Status', render: (a: any) => createElement(HrStatusPill, { tone: a.tone } as any, a.statusLabel) },
      { key: 'act', header: '', render: (a: any) => createElement('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' }, onClick: (e: any) => e.stopPropagation() },
        createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: a.onView, 'data-tip': 'Opens the recovery plan' } as any, 'View'),
        a.pending ? createElement(HrButton, { size: 'sm', onClick: a.onApprove, 'data-tip': 'Opens Approve advance?' } as any, dashIcon('check', 14), ' Approve') : null) },
    ]
    const out = all.filter((a) => a.status === 'DISBURSED').reduce((x, a) => x + a.left, 0)
    const va = s.view ? all.find((a) => a.id === s.view) : null
    const sched: AdvPlanRow[] | null = va ? p.plan || null : null
    const nowKey = `${MON[new Date().getMonth()]} ${new Date().getFullYear()}`
    const plan = va
      ? sched && sched.length
        ? sched.map((r) => { const month = monthLabel(r.month), now = r.status === 'PENDING' && month === nowKey
          return { month, amount: inr(r.amount), note: r.status === 'RECOVERED' ? 'Recovered' : r.status === 'SKIPPED' ? 'Deferred' : r.status === 'CANCELLED' ? 'Cancelled' : now ? `In ${nowKey} run` : 'Upcoming', dot: r.status === 'RECOVERED' ? '#0f6e56' : now ? '#34d399' : '#cbd5e1' } })
        : Array.from({ length: va.months }, (_, i) => ({ month: `Month ${i + 1}`, amount: inr(va.emi), note: va.status === 'REQUESTED' ? 'After approval and payout' : va.status === 'APPROVED' ? 'After payout' : '—', dot: '#cbd5e1' }))
      : []
    const starts = va ? (sched && sched.length ? monthLabel(sched[0].month) : va.status === 'REQUESTED' || va.status === 'APPROVED' ? 'The month after payout' : '—') : ''
    const closeView = () => this.setState({ view: null })
    const vFooter = va ? createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: 'center', width: '100%' } },
      createElement(HrButton, { variant: 'ghost', onClick: closeView } as any, 'Close'),
      (va.status === 'REQUESTED' || va.status === 'APPROVED') && Decision ? createElement(Decision, { advance: va.raw }) : null,
      va.status === 'DISBURSED' || va.status === 'CLOSED' ? createElement(HrButton, { onClick: () => { closeView(); if (p.onRecovery) p.onRecovery(va.id) }, 'data-tip': 'Defer a month, close early or write off' } as any, 'Recovery options') : null) : null
    // Issue advance → for the signed-in person, or (with the permission) for someone else.
    const i = s.issue || { emp: firstEmp, type: 'Salary advance', amount: '', months: '3', start: 'after' }
    const forSelf = !!i.emp && i.emp === me, target = forSelf ? null : people.find((x) => x.id === i.emp) || null
    const allowed = forSelf ? canRequest : canOthers && !!target
    const amt = Number(i.amount) || 0, mo = Number(i.months) || 1, iBad = !allowed || amt < 1 || s.busy
    const closeIssue = () => { if (!s.busy) this.setState({ issue: null }) }
    const saveIssue = async () => {
      if (iBad || !p.onRequest) return
      this.setState({ busy: true })
      try { const ok = await p.onRequest({ employeeId: i.emp, name: target ? target.name : '', amount: amt, reason: i.type, repaymentMonths: mo }); if (ok !== false) this.setState({ issue: null }) } finally { this.setState({ busy: false }) }
    }
    const ap = s.approve ? all.find((a) => a.id === s.approve) : null
    const set = (k: string) => (v: any) => this.setState({ issue: { ...i, [k]: v && v.target ? v.target.value : v } })
    return {
      isLoading, isError, isEmpty, live, isDesktop: !p.mobile, isMobile: !!p.mobile, rows, columns, openRow: (a: any) => a.onView(),
      chips: [{ label: 'Active', value: all.filter((a) => a.key === 'ACTIVE').length }, { label: 'Pending approval', value: all.filter((a) => a.status === 'REQUESTED').length }, { label: 'Outstanding', value: inr(out) }],
      search: { value: s.q, onChange: (v: string) => this.setState({ q: v }), placeholder: 'Find a person or EMP code…' },
      filters: [{ key: 'status', allLabel: 'All statuses', value: s.status, options: [['ACTIVE', 'Active deduction'], ['PENDING', 'Pending approval'], ['APPROVED', 'Approved · to pay out'], ['CLOSED', 'Closed'], ['REJECTED', 'Rejected']].map(([value, label]) => ({ value, label })), onChange: (v: string) => this.setState({ status: v }) }],
      clear: () => this.setState({ q: '', status: '' }),
      actions: createElement(HrButton, {
        variant: 'ghost', size: 'sm', disabled: rows.length === 0, 'data-tip': 'Downloads this list (Excel)',
        onClick: () => {
          const esc = (v: any) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
          const lines = [['Employee', 'Code', 'Type', 'Principal', 'Monthly recovery', 'Months', 'Remaining', 'Status'].join(','), ...rows.map((a) => [a.name, a.code, a.type, a.principal, a.emi, a.months, a.left, a.statusLabel].map(esc).join(','))]
          const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
          const el = document.createElement('a'); el.href = url; el.download = 'advances.csv'; el.click(); URL.revokeObjectURL(url)
        },
      } as any, dashIcon('download', 14), ' Export'),
      viewOpen: !!va, vTitle: 'Advance details', closeView,
      v: va ? { ...va, facts: [{ k: 'Principal', v: va.principalL }, { k: 'Remaining', v: va.leftL }, { k: 'Recovery', v: va.emiL }, { k: 'Starts', v: starts }, ...(va.raisedBy ? [{ k: 'Raised by', v: va.raisedBy }] : [])], plan } : { facts: [], plan: [] },
      vFooter,
      openIssue: () => this.setState({ issue: { emp: firstEmp, type: 'Salary advance', amount: '', months: '3', start: 'after' } }), issueOpen: !!s.issue, closeIssue, i,
      setEmp: set('emp'), setType: set('type'), setAmount: set('amount'), setMonths: set('months'), setStart: set('start'),
      empOptions: [...(canRequest && me ? [{ value: me, label: p.meLabel ? `${p.meLabel} (you)` : 'Me' }] : []), ...(canOthers ? people.map((x) => ({ value: x.id, label: x.code ? `${x.name} · ${x.code}` : x.name })) : [])],
      typeOptions: ['Salary advance', 'Medical emergency', 'Travel advance', 'Personal loan'].map((x) => ({ value: x, label: x })),
      monthOptions: ['1', '2', '3', '6', '10', '12'].map((x) => ({ value: x, label: x === '1' ? 'One month' : `${x} months` })),
      startOptions: [{ value: 'after', label: 'The month after payout' }],
      iPreview: !i.emp ? (canOthers ? 'Choose the employee the advance is for.' : 'You can’t raise advances.')
        : !allowed ? (forSelf ? 'You can’t request an advance for yourself here.' : 'Only HR and finance can raise an advance for someone else.')
          : amt < 1 ? (forSelf ? 'Enter the amount you need.' : 'Enter the amount of the advance.')
            : forSelf ? `${inr(Math.round(amt / mo))} a month from the payroll after it’s paid out, for ${mo === 1 ? '1 month' : mo + ' months'}.`
              : `${inr(Math.round(amt / mo))} a month from ${target!.name}’s salary after it’s paid out, for ${mo === 1 ? '1 month' : mo + ' months'}. It goes to their approver as usual, and ${target!.name} is told it was raised for them.`,
      iFooter: createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' } }, createElement(HrButton, { variant: 'ghost', onClick: closeIssue } as any, 'Cancel'), createElement(HrButton, { onClick: saveIssue, disabled: iBad } as any, s.busy ? 'Sending…' : 'Send for approval')),
      approveOpen: !!ap, aTitle: ap ? `Approve ${ap.name}’s advance?` : 'Approve advance?',
      aDesc: ap ? `${ap.principalL} is approved for payout; recovery ${ap.months > 1 ? `of ${ap.emiL}` : 'in one go'} starts from the payroll after it’s paid out.` : '',
      setApproveOpen: (o: boolean) => { if (!o) this.setState({ approve: null }) }, closeApprove: () => this.setState({ approve: null }),
      doApprove: async () => { if (!ap || !p.onApprove || s.busy) return; this.setState({ busy: true }); try { const ok = await p.onApprove(ap.id); if (ok !== false) this.setState({ approve: null }) } finally { this.setState({ busy: false }) } },
      issueAction: { label: 'Issue advance', onClick: () => this.setState({ issue: { emp: firstEmp, type: 'Salary advance', amount: '', months: '3', start: 'after' } }) },
      errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('creditCard'), retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      skA: { style: { height: 48, width: '100%', borderRadius: 14 } }, skB: { style: { height: 220, width: '100%', borderRadius: 16 } }, icPlus: dashIcon('plus', 15),
    }
  }
  render() { return dc(this, PayAdvancesView, 'PayAdvances') }
}
