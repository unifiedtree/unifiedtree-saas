// My Attendance — ported from the design component AttMine.dc.html.
// Stats: GET /v1/attendance/monthly-stats; day codes from GET /v1/attendance/history.
import { DCLogic, dc } from './dc-runtime'
import { AttMineView } from './AttMine.view'
import { dashIcon, dashIconComponent } from './icons'

const K: Record<string, [string, string, string]> = {
  P: ['#10b981', '#fff', 'Present'], L: ['#f59e0b', '#fff', 'Late'], A: ['#f43f5e', '#fff', 'Absent'], H: ['#8b5cf6', '#fff', 'Holiday'],
  W: ['#99f6e4', '#115e59', 'Weekend / WFH'], O: ['#e2e8f0', '#475569', 'Weekly off'], F: ['#f8fafc', '#94a3b8', 'Upcoming'],
  // Approved leave (the API has it; the design's sample month had none). Listed only when used.
  V: ['#e9d5ff', '#6b21a8', 'On leave'],
}

export class AttMine extends DCLogic {
  renderVals() {
    const p = this.props, M = p.month || { label: '', year: 2000, month: 1, stats: {}, days: {}, todayDay: 0 }
    const st = p.state || 'live', isLoading = st === 'loading', isEmpty = st === 'empty', s = isEmpty ? {} : M.stats || {}
    const v = (n: any, suf?: string) => (isLoading ? '—' : (n ?? 0) + (suf || ''))
    const tiles = ([
      ['Present', s.present, 'green', 'userCheck'], ['Absent', s.absent, 'red', 'userX'], ['Late', s.late, 'orange', 'clock'],
      ['On time', s.ontime, 'teal', 'checkCircle'], ['Holidays', s.holidays, 'purple', 'calendar'], ['Score', s.score, 'blue', 'star'],
    ] as [string, any, string, string][]).map(([label, n, color, icon], i) => ({
      icon: dashIcon(icon, 17), color, label, value: v(n, i === 5 ? '%' : ''), sub: i === 5 ? 'On-time attendance' : 'This month', tip: '', onClick: () => {},
    }))
    const first = new Date(M.year, M.month - 1, 1), off = (first.getDay() + 6) % 7, dim = new Date(M.year, M.month, 0).getDate(), cells: any[] = []
    for (let i = 0; i < off; i++) cells.push({ day: '', bg: 'none', fg: 'none', stroke: 'none', title: '' })
    for (let d = 1; d <= dim; d++) {
      const code = isEmpty ? 'F' : (M.days || {})[d] || 'F', k = K[code]
      cells.push({ day: d, bg: k[0], fg: k[1], stroke: d === M.todayDay ? '#0f172a' : 'none', title: `${d} ${String(M.label).split(' ')[0]} · ${k[2]}` })
    }
    return {
      tiles, cells, monthLabel: M.label, isError: st === 'error', notError: st !== 'error',
      legend: Object.entries(K).filter(([c]) => c !== 'V' || Object.values(M.days || {}).includes('V')).map(([, k]) => ({ bg: k[0], label: k[2] })),
      retry: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      errIcon: dashIconComponent('circleX'),
    }
  }
  render() { return dc(this, AttMineView, 'AttMine') }
}
