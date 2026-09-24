// Attendance & Time module page (Analytics · Daily Tracking · Shifts & Overtime)
// — ported from the design component AttendancePage.dc.html. Section comes from
// the route, the tab from ?tab=; data and actions come from AttendanceContainer.
import { DCLogic, dc } from './dc-runtime'
import { AttendancePageView } from './AttendancePage.view'
import { dashIcon, dashIconComponent } from './icons'
import { fmt } from './shift-util'
import { MONTHS } from './dates'

export class AttendancePage extends DCLogic {
  state: any = { tab: null, status: null, newKey: 0, prefillDate: '', addKey: 0, rosterFilter: null }
  componentDidUpdate(pp: any) {
    const p = this.props
    // Our own tab switches come back through the URL (?tab=); keep what they set
    // (the roster filter, an opened form) instead of resetting it.
    const echo = pp.section === p.section && pp.initialTab !== p.initialTab && p.initialTab === this.state.tab
    if (!echo && (pp.section !== p.section || pp.initialTab !== p.initialTab || pp.initialStatus !== p.initialStatus || pp.date !== p.date || pp.viewAs !== p.viewAs))
      this.setState({ tab: null, status: null, newKey: 0, addKey: 0, rosterFilter: null })
  }
  renderVals() {
    const p = this.props, ss = this.state, D = p.data || {}, S: Record<string, string> = p.states || {}
    const isHr = (p.viewAs || 'admin') !== 'employee', nav = p.onNavigate, toast = p.onToast || (() => {}), mobile = !!p.mobile
    const live = (k: string) => (S[k] || 'loading') === 'live'
    const corr: any[] = D.corr || [], face: any[] = D.face || [], shifts: any[] = D.shifts || [], roster: any[] = D.roster || [], ot: any[] = D.ot || [], sreq: any[] = D.sreq || [], myReq: any[] = D.myReq || []
    const pend = (xs: any[], k?: string, key?: string) => (live(key || '') ? xs.filter((x) => x.status === (k || 'PENDING')).length : 0)
    const nCorr = isHr ? pend(corr, 'PENDING', 'corr') : 0, nFace = pend(face, 'REVIEW', 'face'), nOt = pend(ot, 'PENDING', 'ot'), nSreq = pend(sreq, 'PENDING', 'sreq')
    const noShift = roster.filter((r) => !r.shift).length
    const c = D.counts || {}, rate = c.present ? Math.round((c.present / (c.present + (c.absent || 0) + (c.notMarked || 0))) * 100) : 0
    const shiftsX = shifts.map((s) => ({ ...s, people: roster.filter((r) => r.shift === s.id).length }))
    const mine = shifts.find((s) => s.id === D.myShift) || null
    const sayK = (key: string, a: string, b: string) => { const st = S[key] || 'loading'; return st === 'live' ? a : st === 'loading' ? 'Loading…' : st === 'error' ? 'Couldn’t load' : b }
    const todo = nCorr + nFace, waiting = nOt + nSreq
    const SECS = [
      { key: 'analytics', route: '/hrms/att-analytics', label: 'Attendance Analytics', short: 'Analytics', icon: 'pieChart', desc: 'Charts, trends and monthly reports', status: sayK('ov', `${rate}% came in today`, 'No numbers yet'), alert: 0, hrOnly: true },
      { key: 'daily', route: '/hrms/attendance', label: 'Daily Tracking', short: 'Daily', icon: 'clock', desc: isHr ? 'Today’s check-ins, punches and fixes' : 'Your check-ins and fixes',
        status: isHr ? sayK('logs', `${c.late ?? 0} late today · ${todo ? todo + ' to check' : 'all checked'}`, 'No check-ins yet') : sayK('month', `${(D.month && D.month.stats && D.month.stats.score) ?? 0}% on time this month`, 'No check-ins yet'), alert: isHr ? todo : 0 },
      { key: 'shifts', route: '/hrms/shifts', label: 'Shifts & Overtime', short: 'Shifts', icon: 'calendarClock', desc: isHr ? 'Work timings, roster and extra hours' : 'Your work timing',
        status: isHr ? sayK('shifts', waiting ? `${waiting} waiting for you` : 'All caught up', 'No shifts yet') : sayK('shifts', mine ? `${mine.name} · ${fmt(mine.start)} – ${fmt(mine.end)}` : 'No shift yet', 'No shifts yet'), alert: isHr ? waiting : 0 },
    ].filter((s) => isHr || !s.hrOnly)
    const TABS: Record<string, any[]> = {
      analytics: [['overview', 'Overview', 'dashboard'], ['calendar', 'Calendar', 'calendarDays']],
      daily: isHr ? [['team', 'Daily Logs', 'list'], ['face', 'Face Punch', 'scanFace', nFace], ['corrections', 'Regularization', 'pencil', nCorr], ['my', 'My Attendance', 'userCheck']] : [['my', 'My Attendance', 'userCheck'], ['corrections', 'Regularization', 'pencil']],
      shifts: isHr ? [['schedules', 'Shift Schedules', 'clock'], ['roster', 'Roster', 'users', live('roster') ? noShift : 0], ['overtime', 'Overtime', 'timer', nOt], ['requests', 'Shift Requests', 'swap', nSreq]] : [['myshift', 'My Shift', 'calendarClock']],
    }
    let section: string = p.section || 'daily'
    if (!TABS[section]) section = 'daily'
    const noAccess = section === 'analytics' && !isHr, sec = SECS.find((s) => s.key === section) || SECS[0]
    const list = noAccess ? [] : TABS[section], keys = list.map((t) => t[0])
    let tab = ss.tab || p.initialTab
    if (!keys.includes(tab)) tab = keys[0]
    const reset = { status: null, newKey: 0, addKey: 0, rosterFilter: null }
    const BT: Record<string, string> = { face: 'face checks need a look', corrections: 'fixes waiting for you', roster: 'people have no shift yet', overtime: 'overtime entries waiting for you', requests: 'shift changes waiting for you' }
    const setTab = (k: string) => { this.setState({ tab: k, ...reset }); if (p.onTab) p.onTab(sec.route, k) }
    const tabs = list.map(([k, label, icon, n]) => ({ key: k, label, icon: dashIcon(icon, 16), active: k === tab, inactive: k !== tab, hasBadge: !!n, badge: n, tip: n ? `${n} ${BT[k]}` : '', onClick: () => setTab(k) }))
    const sections = SECS.map((s) => {
      const on = !noAccess && s.key === section
      return {
        key: s.key, label: s.label, short: s.short, desc: s.desc, status: s.status, icon: dashIcon(s.icon, 18), active: on, inactive: !on, hasCount: s.alert > 0, count: s.alert,
        dotOn: s.alert ? '#fcd34d' : '#6ee7b7', dotOff: s.alert ? '#f59e0b' : '#10b981', tip: on ? 'You are here' : '', onClick: () => { if (!on && nav) nav(s.route) },
      }
    })
    const openLogs = (status: string, date?: string) => { if (nav) nav(`/hrms/attendance?tab=team${status ? '&status=' + status : ''}${date ? '&date=' + date : ''}`) }
    const go = (path: string) => (nav ? nav(path) : toast(path))
    const HELP: Record<string, string> = {
      overview: 'How everyone is doing today and this month. Tap any number to see the people behind it.',
      calendar: 'Each box is one day. Greener means more people came in. Tap a day to see what happened.',
      team: 'Everyone’s check-in and check-out for the day. Tap a coloured box to see only those people, or tap a person for details.',
      face: 'Every check-in made at a face kiosk. When the camera isn’t sure it’s the right person, it asks you to take a look.',
      corrections: isHr ? 'When someone forgets to punch, they ask for a fix here. Read the reason, then approve or reject it.' : 'Forgot to punch in or out? Ask for a fix here and see what HR decided.',
      my: 'Your own month at a glance. Each coloured box is one day.',
      schedules: 'The work timings your company uses. The coloured part of each bar shows when people work.',
      roster: 'Who works which shift. Tap “Change shift” to move someone to a different one.',
      overtime: 'Extra time people worked after their shift ended. Approve it or reject it here.',
      requests: 'People who asked to move to a different shift. Approving moves them from the start date they chose.',
      myshift: 'The hours you’re expected to work. Need different hours? Ask for a change.',
    }
    const is = (s: string, t: string) => !noAccess && section === s && tab === t
    const A = p.actions || {}
    const today: string = D.today || ''
    const monthLabel = today ? `${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}` : ''
    const px = {
      AttOverview: { state: S.ov, ov: D.ov, onRetry: A.retryOv },
      AttCalendar: { state: S.ov, ov: D.ov, onRetry: A.retryOv },
      AttDailyLogs: { state: S.logs, logs: D.logs, date: p.date || '', onDate: A.onDate, onRetry: A.retryLogs, canRegularize: !!p.canRequestFix },
      AttFacePunch: { state: S.face, events: face, onRetry: A.retryFace },
      AttRegularization: { state: S.corr, requests: corr, mine: D.mineCorr || [], canApprove: isHr && !!p.canApproveCorr, onNew: A.newCorr, onRetry: A.retryCorr },
      AttMine: { state: S.month, month: D.month, onRetry: A.retryMonth },
      ShiftSchedules: { state: S.shifts, canEdit: !!p.canEditShifts, onRetry: A.retryShifts },
      ShiftRoster: { state: S.roster, canEdit: !!p.canAssign, onRetry: A.retryRoster },
      ShiftOvertime: { state: S.ot, monthLabel, rangeLabel: D.otRange, canDecide: !!p.canDecideOt, onRetry: A.retryOt },
      ShiftRequestsHr: { state: S.sreq, onRetry: A.retrySreq },
      ShiftRequestsMine: { state: S.myReq, onRetry: A.retryMyReq },
    }
    return {
      isDesktop: !mobile, isMobile: mobile, sections, tabs, showTabs: !noAccess, noAccess,
      secLabel: sec.label, secIcon: dashIcon(sec.icon, 14), tabsLabel: sec.label + ' tabs', helper: HELP[tab] || '',
      title: noAccess ? 'Attendance Analytics' : (list.find((t) => t[0] === tab) || [])[1] || sec.label,
      crumbSec: noAccess ? 'Attendance Analytics' : sec.label, subtitle: noAccess ? 'Charts and monthly reports are for HR and managers.' : HELP[tab] || '',
      todayLabel: D.todayLabel || '', monthLabel,
      icModule: dashIcon('clock', 20), icCal: dashIcon('calendar', 14), icChevron: dashIcon('chevronRight', 18), icInfo: dashIcon('info', 16),
      icPencil: dashIcon('pencil', 15), icFile: dashIcon('fileText', 15), icPlus: dashIcon('plus', 15), icDownload: dashIcon('download', 15),
      actAnalytics: section === 'analytics' && isHr, actDaily: section === 'daily' && isHr && !!p.canManual, actShifts: section === 'shifts' && isHr && !!p.canEditShifts,
      goManual: () => go('/hrms/attendance/manual-entry'), goMuster: () => go('/hrms/muster-roll'),
      goReport: () => go(D.reportLink || '/hrms/reports/attendance-summary'),
      addShift: () => { this.setState({ tab: 'schedules', addKey: ss.addKey + 1, newKey: 0, rosterFilter: null }); if (p.onTab) p.onTab('/hrms/shifts', 'schedules') },
      tOverview: is('analytics', 'overview'), tCalendar: is('analytics', 'calendar'), tTeam: is('daily', 'team'), tFace: is('daily', 'face'), tReg: is('daily', 'corrections'), tMine: is('daily', 'my'),
      tSchedules: is('shifts', 'schedules'), tRoster: is('shifts', 'roster'), tOvertime: is('shifts', 'overtime'), tRequests: is('shifts', 'requests'), tMyShift: is('shifts', 'myshift'),
      state: 'live', mobile, isHr, navFn: go, toast, openLogs,
      initialStatus: ss.status ?? p.initialStatus ?? '', date: p.date || '',
      corr, face, shiftsX, roster, ot, otSummary: D.otSummary || [], sreq, myReq, myShift: D.myShift, mySince: D.mySince, noShift,
      newKey: ss.newKey, prefillDate: ss.prefillDate, addKey: ss.addKey, rosterFilter: ss.rosterFilter || '',
      // A fix request is always raised for the signed-in person, so HR fixes
      // someone else's day with a manual entry for that person and date.
      regularize: (row: any, iso: string) => {
        if (isHr && row && row.id) return go(`/hrms/attendance/manual-entry?employeeId=${row.id}&date=${iso || today}`)
        this.setState({ tab: 'corrections', newKey: ss.newKey + 1, prefillDate: iso || today, addKey: 0 }); if (p.onTab) p.onTab('/hrms/attendance', 'corrections')
      },
      seePeople: (id: string) => { this.setState({ tab: 'roster', rosterFilter: id, addKey: 0, newKey: 0 }); if (p.onTab) p.onTab('/hrms/shifts', 'roster') },
      decideCorr: A.decideCorr, reviewFace: A.reviewFace, saveShift: A.saveShift, deleteShift: A.deleteShift, assign: A.assign,
      decideOt: A.decideOt, decideSreq: A.decideSreq, newSreq: A.newSreq,
      px,
      lockIcon: dashIconComponent('lock'),
      goDaily: { label: 'Open Daily Tracking', onClick: () => { if (nav) nav('/hrms/attendance') } },
    }
  }
  render() { return dc(this, AttendancePageView, 'AttendancePage') }
}
