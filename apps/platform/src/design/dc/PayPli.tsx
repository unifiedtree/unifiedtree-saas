// Production-Linked Incentive — ported from the design component PayPli.dc.html.
// Rows are this month's PLI targets (GET /v1/pli/targets). Editing saves the
// target (PUT /v1/pli/targets/{id}); "Set monthly targets" writes next month's.
// PLI isn't added to payroll by this backend; bonuses are paid as awards.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayPliView } from './PayPli.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'

export interface PliRow { id: string; team: string; people: number | null; target: number; actual: number; pool: number; metric: string }

const fmt = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export class PayPli extends DCLogic {
  state: any = { q: '', edit: null, fTarget: '', fActual: '', fPer: '', targets: null, busy: false }
  renderVals() {
    const p = this.props, s = this.state, canWrite = !!p.canWrite
    const st = p.state || 'live', isLoading = st === 'loading', isError = st === 'error'
    const base: PliRow[] = isLoading || isError ? [] : p.rows || []
    const isEmpty = !isLoading && !isError && base.length === 0, live = !isLoading && !isError && !isEmpty
    const calc = (r: { target: number; actual: number; pool: number }) => { const mult = r.target ? r.actual / r.target : 0; return { mult, poolNow: mult >= 1 ? r.pool : 0 } }
    const q = s.q.trim().toLowerCase()
    const rows = base.filter((r) => !q || r.team.toLowerCase().includes(q)).map((r) => {
      const c = calc(r)
      return {
        ...r, ...c, met: c.mult >= 1, targetL: `${fmt(r.target)} · ${r.metric}`, actualL: fmt(r.actual), multL: c.mult.toFixed(2) + '×', poolL: inr(c.poolNow),
        peopleL: r.people == null ? 'Headcount not set' : `${r.people} ${r.people === 1 ? 'person' : 'people'}`,
        onEdit: () => canWrite && this.setState({ edit: r.id, fTarget: String(r.target), fActual: String(r.actual), fPer: String(r.people ? Math.round(r.pool / r.people) : r.pool) }),
      }
    })
    const columns = [
      { key: 'team', header: 'Department / team', render: (r: any) => createElement('div', { style: { display: 'grid', gap: 1 } }, createElement('strong', { style: { color: '#0f172a' } }, r.team), createElement('span', { style: { fontSize: 12, color: '#64748b' } }, r.peopleL)) },
      { key: 'target', header: 'Production target', render: (r: any) => r.targetL },
      { key: 'actual', header: 'Actual achieved', render: (r: any) => createElement('strong', { style: { color: r.met ? '#047857' : '#b45309', fontVariantNumeric: 'tabular-nums' } }, r.actualL) },
      { key: 'mult', header: 'PLI multiplier', render: (r: any) => createElement(HrStatusPill, { tone: r.met ? 'ok' : 'gray' } as any, r.multL) },
      { key: 'pool', header: 'Total bonus pool', render: (r: any) => createElement('strong', { style: { fontVariantNumeric: 'tabular-nums', color: '#0f172a' } }, r.poolL) },
      { key: 'act', header: '', render: (r: any) => (canWrite ? createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' }, onClick: (e: any) => e.stopPropagation() }, createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: r.onEdit, 'data-tip': `Edit PLI for ${r.team}` } as any, dashIcon('pencil', 14), ' Edit')) : null) },
    ]
    const total = rows.reduce((a, r) => a + r.poolNow, 0), paidPeople = rows.filter((r) => r.met).reduce((a, r) => a + (r.people || 0), 0)
    const er = s.edit ? base.find((r) => r.id === s.edit) : null
    const per = Number(s.fPer) || 0, dPool = er ? (er.people ? per * er.people : per) : 0
    const draft = er ? { target: Number(s.fTarget) || 0, actual: Number(s.fActual) || 0, pool: dPool } : null, dc0 = draft ? calc(draft) : null
    const closeEdit = () => { if (!s.busy) this.setState({ edit: null }) }
    const saveEdit = async () => {
      if (!er || !draft || !draft.target || s.busy || !p.onSave) return
      this.setState({ busy: true })
      try { const ok = await p.onSave(er.id, { targetValue: draft.target, actualValue: draft.actual, payoutAmount: draft.pool }); if (ok !== false) this.setState({ edit: null }) } finally { this.setState({ busy: false }) }
    }
    const tg = s.targets
    const exportCsv = () => {
      const esc = (v: any) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
      const lines = [['Team', 'People', 'Metric', 'Target', 'Actual', 'Multiplier', 'Bonus pool'].join(','), ...rows.map((r) => [r.team, r.people ?? '', r.metric, r.target, r.actual, r.mult.toFixed(2), r.poolNow].map(esc).join(','))]
      const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = `pli-${p.periodKey || 'month'}.csv`; a.click(); URL.revokeObjectURL(url)
    }
    return {
      isLoading, isError, isEmpty, live, isDesktop: !p.mobile, isMobile: !!p.mobile, rows, columns, openRow: (r: any) => r.onEdit(), totalLabel: inr(total), paidPeople,
      monthName: p.monthName || '', targetsDesc: `Targets for ${p.nextMonthLabel || 'next month'}. Bonuses are paid when a team meets its target.`,
      pliLead: 'PLI isn’t added to payroll yet — bonuses are paid out as awards. This month:', pliLink: 'Manage awards →',
      openRun: () => p.onAwards && p.onAwards(), runTip: 'Opens PLI awards', runLabel: '',
      search: { value: s.q, onChange: (v: string) => this.setState({ q: v }), placeholder: 'Search teams…' },
      actions: createElement(HrButton, { variant: 'ghost', size: 'sm', onClick: exportCsv, disabled: rows.length === 0, 'data-tip': 'Downloads this list (Excel)' } as any, dashIcon('download', 14), ' Export'),
      editOpen: !!er, eTitle: er ? `Edit PLI · ${er.team}` : '', closeEdit, fTarget: s.fTarget, fActual: s.fActual, fPer: s.fPer,
      setTarget: (e: any) => this.setState({ fTarget: e.target.value }), setActual: (e: any) => this.setState({ fActual: e.target.value }), setPer: (e: any) => this.setState({ fPer: e.target.value }),
      ePool: dc0 ? inr(dc0.poolNow) : '',
      ePreviewNote: dc0 && er ? `${dc0.mult.toFixed(2)}× target · ${dc0.mult >= 1 ? (er.people ? `bonus pool for ${er.people} ${er.people === 1 ? 'person' : 'people'}` : 'the amount is the whole pool (no headcount on this target)') : 'below target, so no bonus'}` : '',
      eFooter: er ? createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' } }, createElement(HrButton, { variant: 'ghost', onClick: closeEdit } as any, 'Cancel'), createElement(HrButton, { onClick: saveEdit, disabled: !draft?.target || s.busy } as any, s.busy ? 'Saving…' : 'Save')) : null,
      openTargets: () => canWrite && this.setState({ targets: Object.fromEntries(base.map((r) => [r.id, String(r.target)])) }), targetsOpen: !!tg, setTargetsOpen: (o: boolean) => { if (!o && !s.busy) this.setState({ targets: null }) }, closeTargets: () => { if (!s.busy) this.setState({ targets: null }) },
      targetRows: tg ? base.map((r) => ({ team: r.team, value: tg[r.id], onChange: (e: any) => this.setState({ targets: { ...tg, [r.id]: e.target.value } }) })) : [],
      saveTargets: async () => {
        if (!tg || s.busy || !p.onSaveTargets) return
        this.setState({ busy: true })
        try { const ok = await p.onSaveTargets(base.map((r) => ({ row: r, targetValue: Number(tg[r.id]) || r.target }))); if (ok !== false) this.setState({ targets: null }) } finally { this.setState({ busy: false }) }
      },
      targetsAction: canWrite ? { label: 'Set monthly targets', onClick: () => this.setState({ targets: Object.fromEntries(base.map((r) => [r.id, String(r.target)])) }) } : undefined,
      errIcon: dashIconComponent('circleX'), emptyIcon: dashIconComponent('target'), retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      skA: { style: { height: 56, width: '100%', borderRadius: 14 } }, skB: { style: { height: 220, width: '100%', borderRadius: 16 } }, icTarget: dashIcon('target', 15), icInfo: dashIcon('info', 18),
    }
  }
  render() { return dc(this, PayPliView, 'PayPli') }
}
