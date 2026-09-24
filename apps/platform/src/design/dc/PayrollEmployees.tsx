// A payroll run's Employees tab — ported from the design component
// PayrollEmployees.dc.html. Rows are GET /v1/payroll/runs/{id}/employees.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { PayrollEmployeesView } from './PayrollEmployees.view'
import { HrButton } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { dashIcon, dashIconComponent } from './icons'
import { inr } from './PayslipDrawer'

export interface RunEmployeeRow { id: string; code: string; name: string; role: string; dept: string; paidDays: number; lop: number; gross: number; net: number }

export class PayrollEmployees extends DCLogic {
  state: any = { q: '', dept: '', page: 0, size: 10 }
  renderVals() {
    const p = this.props, s = this.state, mobile = !!p.mobile, open = p.onOpen || (() => {})
    const step = p.step || 'draft', busy = !!p.busy, isDraft = step === 'draft' && !busy
    const all: RunEmployeeRow[] = p.rows || [], q = s.q.trim().toLowerCase()
    const rows = all.filter((e) => (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)) && (!s.dept || e.dept === s.dept))
    const totalPages = Math.max(1, Math.ceil(rows.length / s.size)), page = Math.min(s.page, totalPages - 1)
    const pageRows = rows.slice(page * s.size, page * s.size + s.size).map((e) => ({ ...e, grossLabel: inr(e.gross), netLabel: inr(e.net), onOpen: () => open(e) }))
    const depts = [...new Set(all.map((e) => e.dept).filter(Boolean))].sort()
    const num = (v: any, warn?: boolean) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums', color: warn ? '#b45309' : undefined, fontWeight: warn ? 700 : undefined } }, v)
    const columns = [
      { key: 'code', header: 'Code', render: (e: any) => createElement('span', { style: { fontFamily: "'JetBrains Mono',ui-monospace,monospace", fontSize: 12.5, fontWeight: 600, color: '#334155' } }, e.code) },
      { key: 'name', header: 'Employee', render: (e: any) => createElement('div', { style: { display: 'grid', gap: 1 } }, createElement('strong', { style: { fontWeight: 600, color: '#0f172a' } }, e.name), createElement('span', { style: { fontSize: 12, color: '#64748b' } }, [e.role, e.dept].filter(Boolean).join(' · ') || '—')) },
      { key: 'paidDays', header: 'Paid days', render: (e: any) => num(e.paidDays) },
      { key: 'lop', header: 'LOP', render: (e: any) => num(e.lop, e.lop > 0) },
      { key: 'gross', header: 'Gross', render: (e: any) => num(inr(e.gross)) },
      { key: 'net', header: 'Net pay', render: (e: any) => createElement('strong', { style: { fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' } }, inr(e.net)) },
      { key: 'act', header: '', render: (e: any) => createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' }, onClick: (ev: any) => ev.stopPropagation() }, createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: () => open(e), 'data-tip': `Opens ${e.name}’s payslip` } as any, dashIcon('fileText', 14), ' Payslip')) },
    ]
    const set = (patch: any) => this.setState({ ...patch, page: 0 })
    // Export: the rows as a CSV the payroll team can open in Excel.
    const exportCsv = () => {
      const esc = (v: any) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
      const lines = [['Code', 'Employee', 'Department', 'Paid days', 'LOP days', 'Gross', 'Net pay'].join(','), ...rows.map((e) => [e.code, e.name, e.dept, e.paidDays, e.lop, e.gross, e.net].map(esc).join(','))]
      const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = `payroll-${p.fileTag || 'run'}.csv`; a.click(); URL.revokeObjectURL(url)
      if (p.onToast) p.onToast(`Payroll register exported · ${rows.length} rows`)
    }
    return {
      isDraft, showList: !isDraft, busy, isDesktop: !mobile, isMobile: mobile, noRows: pageRows.length === 0,
      draftText: `Process this run to calculate pay for ${p.count ?? 'everyone with a salary structure'}${p.count != null ? ' employees' : ''}. Their payslips will be listed here.`,
      processAction: p.onProcess && p.canProcess !== false ? { label: 'Process', onClick: p.onProcess } : undefined, emptyIcon: dashIconComponent('fileText'),
      search: { value: s.q, onChange: (v: string) => set({ q: v }), placeholder: 'Find a person or EMP code…' },
      filters: [{ key: 'dept', allLabel: 'All departments', value: s.dept, options: depts.map((d) => ({ value: d, label: d })), onChange: (v: string) => set({ dept: v }) }],
      clear: () => set({ q: '', dept: '' }),
      actions: createElement(HrButton, { variant: 'ghost', size: 'sm', onClick: exportCsv, disabled: rows.length === 0, 'data-tip': 'Downloads the payroll register (Excel)' } as any, dashIcon('download', 14), ' Export'),
      pager: createElement(HrPagination as any, { page, pageSize: s.size, totalElements: rows.length, totalPages, pageSizeOptions: [10, 25, 50], onPageChange: (n: number) => this.setState({ page: n }), onPageSizeChange: (n: number) => this.setState({ size: n, page: 0 }) }),
      columns, pageRows, openRow: (e: any) => open(e),
    }
  }
  render() { return dc(this, PayrollEmployeesView, 'PayrollEmployees') }
}
