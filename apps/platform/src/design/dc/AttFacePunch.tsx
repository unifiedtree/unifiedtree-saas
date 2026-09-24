// Face Punch — ported from the design component AttFacePunch.dc.html.
// Events come from GET /v1/attendance/face/admin/events. The API reports a
// confidence band (high / medium / low), not a percentage, so the bar shows the
// band instead of a made-up number.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { AttFacePunchView } from './AttFacePunch.view'
import { HrAvatar, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'

const ST: Record<string, [string, string]> = {
  OK: ['ok', 'Verified'], REVIEW: ['warn', 'Needs a look'], CONFIRMED: ['ok', 'Checked by HR'], FLAGGED: ['red', 'Flagged'], FAILED: ['red', 'Rejected by camera'],
}

export class AttFacePunch extends DCLogic {
  state: any = { q: '', view: null }
  renderVals() {
    const p = this.props, st = p.state || 'live'
    const isLoading = st === 'loading', isError = st === 'error', isEmpty = st === 'empty'
    const events: any[] = p.events || []
    const list = isEmpty || isError ? [] : events
    const toReview = list.filter((e) => e.status === 'REVIEW')
    const view = this.state.view || (toReview.length && !isLoading ? 'review' : 'all')
    const q = this.state.q.trim().toLowerCase()
    const rows = list.filter((r) => !q || `${r.name} ${r.code} ${r.device}`.toLowerCase().includes(q))
    const bar = (r: any) => {
      const c = r.conf, ok = c >= 85
      return createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
        createElement('span', { style: { width: 72, height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden', display: 'inline-block' } },
          createElement('span', { style: { display: 'block', height: '100%', width: c + '%', background: ok ? '#10b981' : '#f59e0b' } })),
        createElement('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: ok ? '#047857' : '#b45309' } }, r.band))
    }
    const columns = [
      { key: 'name', header: 'Employee', render: (r: any) => createElement(HrAvatar, { name: r.name, sub: r.code } as any) },
      { key: 'device', header: 'Kiosk', render: (r: any) => createElement('span', { style: { fontFamily: "'JetBrains Mono',ui-monospace,monospace", fontSize: 12.5 } }, r.device) },
      { key: 'time', header: 'Time', render: (r: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, r.time + ' IST') },
      { key: 'conf', header: 'How sure the camera was', render: bar },
      { key: 'st', header: 'Status', render: (r: any) => createElement(HrStatusPill, { tone: (ST[r.status] || ST.OK)[0] } as any, (ST[r.status] || ST.OK)[1]) },
    ]
    const review = toReview.map((r) => ({
      ...r, first: r.name.split(' ')[0], sub: `${r.code} · ${r.device} · ${r.time}`, w: r.conf + '%',
      bandSure: r.band === 'Low' ? 'partly sure' : `${r.band.toLowerCase()} confidence`, bandMatch: `${r.band} match`,
      rule: 'Low-confidence punches need a person to check.', needLabel: 'Medium needed',
      yes: () => p.onReview && p.onReview(r.id, true), no: () => p.onReview && p.onReview(r.id, false),
    }))
    const views = [
      { key: 'review', label: 'Needs a look', count: isLoading ? '…' : toReview.length, urgent: toReview.length > 0 },
      { key: 'all', label: 'All punches', count: isLoading ? '…' : list.length },
    ].map((v) => ({ ...v, active: v.key === view, tip: v.key === 'review' ? 'Punches the camera wasn’t sure about' : 'Every face punch today', onClick: () => this.setState({ view: v.key }) }))
    return {
      views, isLoading, isError, isEmpty,
      showAll: view === 'all' && !isError && !isEmpty, showReview: view === 'review' && !isError && !isEmpty,
      hasReview: review.length > 0, noReview: review.length === 0, review, rows, columns,
      summary: isLoading ? 'Loading face check-ins…' : `${list.length} face check-ins today, newest first`,
      search: { value: this.state.q, onChange: (v: string) => this.setState({ q: v }), placeholder: 'Find a person, code or kiosk…' },
      open: (r: any) => r.empId && p.onNavigate && p.onNavigate('/hrms/employees/' + r.empId),
      retry: { label: 'Try again', onClick: () => p.onRetry && p.onRetry() },
      errIcon: dashIconComponent('circleX'), faceIcon: dashIconComponent('scanFace'), okIcon: dashIconComponent('checkCircle'), icCheck: dashIcon('check', 15),
    }
  }
  render() { return dc(this, AttFacePunchView, 'AttFacePunch') }
}
