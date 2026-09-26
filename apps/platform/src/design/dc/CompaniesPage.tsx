// Companies & Branches — logic ported from the design component
// CompaniesPage.dc.html. Data and saves come from CompaniesPageContainer
// (real API); the prototype's in-memory seed and local CRUD are replaced by
// the container's async callbacks.
import { createElement, createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { CompaniesPageView } from './CompaniesPage.view'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon, dashIconComponent } from './icons'

export class CompaniesPage extends DCLogic {
  state: any = { view: 'cards', q: '', status: '', city: '', drawer: null, confirm: null, pickerOpen: false, pickerQ: '', busy: false }
  pickerRef = createRef<HTMLDivElement>()
  searchRef = createRef<HTMLInputElement>()
  _down?: (e: MouseEvent) => void
  _esc?: (e: KeyboardEvent) => void
  componentDidMount() {
    this._down = (e: MouseEvent) => {
      const el = this.pickerRef.current
      if (!this.state.pickerOpen || !el) return
      const path = e.composedPath ? e.composedPath() : []
      if (!path.includes(el) && !el.contains(e.target as Node)) this.setState({ pickerOpen: false })
    }
    this._esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.state.pickerOpen) this.setState({ pickerOpen: false }) }
    document.addEventListener('mousedown', this._down)
    document.addEventListener('keydown', this._esc)
  }
  componentWillUnmount() {
    if (this._down) document.removeEventListener('mousedown', this._down)
    if (this._esc) document.removeEventListener('keydown', this._esc)
  }
  componentDidUpdate(_pp: any, ps: any) {
    if (this.state.pickerOpen && !(ps && ps.pickerOpen)) setTimeout(() => { const i = this.searchRef.current; if (i && i.focus) i.focus() }, 0)
  }
  /** Run a save; close the drawer / confirm only when it succeeded. */
  async run(fn: (() => Promise<boolean | void>) | undefined, after: Record<string, any>) {
    if (!fn || this.state.busy) return
    this.setState({ busy: true })
    try {
      const ok = await fn()
      if (ok !== false) this.setState(after)
    } finally {
      this.setState({ busy: false })
    }
  }
  renderVals() {
    const p = this.props
    const st = p.state || 'live', canEdit = !!p.canEdit, mobile = !!p.mobile
    const nav = p.onNavigate || (() => {})
    const companies: any[] = p.companies || [], branches: any[] = p.branches || []
    // Archived branches (API includeArchived) show only under the "Inactive" filter, with Restore.
    const archived: any[] = p.archivedBranches || []
    // Archived companies show there too (after the branches), each with Restore.
    const archivedCos: any[] = p.archivedCompanies || []
    const isEmpty = st === 'empty', isLoading = st === 'loading', isError = st === 'error'
    const list = isEmpty ? [] : companies
    /** Why a company can't be archived yet, or null. The server refuses the same two cases. */
    const archiveBlock = (c: any) => {
      if (!c) return null
      if (list.length <= 1) return 'This is the only active company. Add or restore another company before archiving this one.'
      const n = Number(c.employees) || 0
      return n > 0 ? `${n === 1 ? '1 person still works' : `${n} people still work`} at ${c.name}. Move them to another company or record their exit first.` : null
    }
    const co0 = list.find((c) => c.id === p.companyId) || list[0] || null
    const coB = co0 ? branches.filter((b) => b.companyId === co0.id) : []
    const coArch = co0 ? archived.filter((b) => b.companyId === co0.id) : []
    const valOf = (v: any) => (v && v.target ? v.target.value : v)
    const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    const geoCount = coB.filter((b) => b.geo.on).length
    const hqB = coB.find((b) => b.hq)
    const fmt = p.format || null
    const co = co0
      ? {
        ...co0, initials: initials(co0.name), tone: co0.status === 'ACTIVE' ? 'ok' : 'gray', statusLabel: co0.status === 'ACTIVE' ? 'Active' : 'Inactive',
        branchCount: coB.length, meta: `${co0.industry || '—'} · ${co0.country || 'India'} · ${co0.currency || 'INR'}`,
        pickMeta: `${co0.industry || '—'} · ${coB.length} ${coB.length === 1 ? 'branch' : 'branches'}`,
        geofenced: `${geoCount} of ${coB.length}`, legalLabel: co0.legal || '—', industryLabel: co0.industry || '—', hqName: hqB ? hqB.name : 'Not set',
        cinLabel: co0.cin || 'Not registered', panLabel: co0.pan || '—', gstinLabel: co0.gstin || '—',
        nextId: fmt ? `${fmt.prefix}-${fmt.next}` : '—', desc: co0.desc || 'No description yet.',
      }
      : {}
    const pick = (id: string) => { this.setState({ q: '', status: '', city: '', pickerOpen: false, pickerQ: '' }); if (p.onPickCompany) p.onPickCompany(id) }
    const pq = this.state.pickerQ.trim().toLowerCase()
    const pickList = list.filter((c) => !pq || `${c.name} ${c.legal || ''} ${c.industry || ''}`.toLowerCase().includes(pq))
    const pickRows = pickList.map((c) => {
      const n = branches.filter((b) => b.companyId === c.id).length, sel = !!co0 && c.id === co0.id
      return { id: c.id, name: c.name, initials: initials(c.name), meta: `${c.industry || '—'} · ${n} ${n === 1 ? 'branch' : 'branches'}`, sel, unsel: !sel, inactive: c.status !== 'ACTIVE', onPick: () => pick(c.id) }
    })
    const q = this.state.q.trim().toLowerCase(), sf = this.state.status, cf = this.state.city
    const empUrl = (b: any) => `/hrms/employees?companyId=${b.companyId}&branchId=${b.id}`
    const pool = sf === 'INACTIVE' ? coArch : coB
    const rows = pool
      .filter((b) => (!q || `${b.name} ${b.city} ${b.code}`.toLowerCase().includes(q)) && (!sf || b.status === sf) && (!cf || b.city === cf))
      .sort((a, b) => (b.hq ? 1 : 0) - (a.hq ? 1 : 0) || a.name.localeCompare(b.name))
      .map((b) => ({
        ...b, location: `${b.city || '—'}, ${b.state || '—'} · ${b.country || 'India'}`, codeLabel: b.code || '—',
        tone: b.status === 'ACTIVE' ? 'ok' : 'gray', statusLabel: b.status === 'ACTIVE' ? 'Active' : 'Inactive',
        geoOn: !!b.geo.on, geoOff: !b.geo.on, geoLabel: b.geo.on ? `On · ${b.geo.radius} m` : 'Not set',
        onEmployees: () => nav(empUrl(b)), employeesTip: `→ ${empUrl(b)}`,
        onManage: () => this.setState({ drawer: { type: 'branch', id: b.id } }),
        manageTip: canEdit ? 'Opens Edit branch' : 'Opens branch details', manageLabel: canEdit ? 'Manage' : 'View',
        archiveLabel: b.status === 'ACTIVE' ? 'Archive' : 'Restore',
        archiveTip: b.status === 'ACTIVE' ? 'Archives this branch' : 'Restores this branch to lists and pickers',
        onArchive: b.status === 'ACTIVE'
          ? () => this.setState({ confirm: { kind: 'branch', id: b.id, name: b.name } })
          : () => this.run(() => p.onRestoreBranch && p.onRestoreBranch(b), {}),
      }))
    const columns = [
      { key: 'name', header: 'Branch', render: (b: any) => createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, createElement('strong', { style: { fontWeight: 700, color: '#0f172a' } }, b.name), b.hq ? createElement(HrStatusPill, { tone: 'warn' } as any, 'HQ') : null) },
      { key: 'location', header: 'Location', render: (b: any) => `${b.city || '—'}, ${b.state || '—'}` },
      { key: 'employees', header: 'Employees', render: (b: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, b.employees) },
      { key: 'geo', header: 'Geofence', render: (b: any) => b.geoLabel },
      { key: 'status', header: 'Status', render: (b: any) => createElement(HrStatusPill, { tone: b.tone } as any, b.statusLabel) },
      {
        key: 'actions', header: '', render: (b: any) => createElement('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' }, onClick: (e: any) => e.stopPropagation() },
          createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: b.onManage, 'data-tip': b.manageTip } as any, canEdit ? 'Edit' : 'View'),
          canEdit ? createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: b.onArchive, 'data-tip': b.archiveTip } as any, b.archiveLabel) : null),
      },
    ]
    // Under "Inactive" the search applies to archived companies too; with no active company left
    // (the empty page) every archived one is listed, so the workspace can always get one back.
    const coPool = isEmpty ? archivedCos : sf === 'INACTIVE' ? archivedCos : []
    const coRows = coPool
      .filter((c) => isEmpty || !q || `${c.name} ${c.legal || ''} ${c.industry || ''}`.toLowerCase().includes(q))
      .map((c) => {
        const n = branches.filter((b) => b.companyId === c.id).length
        return {
          ...c, meta: `${c.industry || '—'} · ${c.country || 'India'} · ${c.currency || 'INR'}`, legalLabel: c.legal || '—', branchCount: n,
          onRestore: () => this.setState({ confirm: { kind: 'restore', id: c.id, name: c.name } }),
        }
      })
    const coColumns = [
      { key: 'name', header: 'Company', render: (c: any) => createElement('strong', { style: { fontWeight: 700, color: '#0f172a' } }, c.name) },
      { key: 'industry', header: 'Industry', render: (c: any) => c.industry || '—' },
      { key: 'employees', header: 'Employees', render: (c: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, c.employees) },
      { key: 'branches', header: 'Branches', render: (c: any) => createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, c.branchCount) },
      { key: 'status', header: 'Status', render: () => createElement(HrStatusPill, { tone: 'gray' } as any, 'Inactive') },
      {
        key: 'actions', header: '', render: (c: any) => canEdit
          ? createElement('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
            createElement(HrButton, { size: 'sm', variant: 'ghost', onClick: c.onRestore, 'data-tip': 'Restores this company to lists and pickers' } as any, 'Restore'))
          : null,
      },
    ]
    const cities = [...new Set(pool.map((b) => b.city).filter(Boolean))].sort()
    const view = mobile ? 'cards' : this.state.view
    const hasList = !isLoading && !isError && pool.length > 0
    const d = this.state.drawer
    const drawerBranch = d && d.type === 'branch' ? (d.id ? branches.find((b) => b.id === d.id) || archived.find((b) => b.id === d.id) || null : null) : null
    const drawerCompany = d && d.type === 'company' ? (d.id ? { ...(companies.find((c) => c.id === d.id) || {}), prefix: fmt?.prefix, next: fmt?.next } : null) : null
    const cf2 = this.state.confirm
    const restoring = !!cf2 && cf2.kind === 'restore'
    // A company archive the server would refuse: the dialog says what to do first instead of offering Archive.
    const block = cf2 && cf2.kind === 'company' ? archiveBlock(list.find((c) => c.id === cf2.id)) : null
    const coErr = !!p.archivedCompaniesError
    const emptyWithArchived = isEmpty && coRows.length > 0
    const addBranch = () => this.setState({ drawer: { type: 'branch', id: null } })
    const addCompany = () => this.setState({ drawer: { type: 'company', id: null } })
    const nB = branches.filter((b) => list.some((c) => c.id === b.companyId)).length
    return {
      canEdit, readOnly: !canEdit, isLoading, notLoading: !isLoading,
      hasCompanies: list.length > 0, noCompanies: list.length === 0, co,
      pickRows, pickNoMatch: pickRows.length === 0, pickerOpen: this.state.pickerOpen, pickerClosed: !this.state.pickerOpen, pickerQ: this.state.pickerQ,
      setPickerQ: (e: any) => this.setState({ pickerQ: e.target.value }),
      togglePicker: () => this.setState((s: any) => ({ pickerOpen: !s.pickerOpen, pickerQ: '' })),
      pickerKey: (e: any) => { if (e.key === 'Enter') { e.preventDefault(); if (pickList[0]) pick(pickList[0].id) } },
      pickerRef: this.pickerRef, searchRef: this.searchRef, addCompany,
      totalsLabel: `${list.length} ${list.length === 1 ? 'company' : 'companies'} · ${nB} ${nB === 1 ? 'branch' : 'branches'}`,
      showToggle: !mobile, isCards: view === 'cards', isTable: view === 'table',
      showTableView: () => this.setState({ view: 'table' }), showCardsView: () => this.setState({ view: 'cards' }),
      q: this.state.q, setQ: (e: any) => this.setState({ q: e.target.value }),
      statusFilter: sf, setStatus: (v: any) => this.setState({ status: valOf(v) }),
      statusOptions: [{ value: '', label: 'All statuses' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }],
      cityFilter: cf, setCity: (v: any) => this.setState({ city: valOf(v) }),
      cityOptions: [{ value: '', label: 'All cities' }, ...cities.map((c) => ({ value: c, label: c }))],
      clearFilters: () => this.setState({ q: '', status: '', city: '' }),
      listLoading: isLoading || !!p.branchesLoading, listError: isError || !!p.branchesError,
      listEmpty: !isLoading && !isError && !p.branchesLoading && pool.length === 0 && sf !== 'INACTIVE',
      // "Inactive" with nothing archived: say so rather than "No branches yet".
      listNoMatch: (hasList && rows.length === 0) || (!isLoading && !isError && !p.branchesLoading && sf === 'INACTIVE' && pool.length === 0),
      showCards: hasList && rows.length > 0 && view === 'cards', showTable: hasList && rows.length > 0 && view === 'table',
      showAddMore: hasList && rows.length > 0 && canEdit,
      rows, columns, rowClick: (b: any) => b.onManage(),
      goEmployees: () => co0 && nav(`/hrms/employees?companyId=${co0.id}`),
      employeesTip: co0 ? `→ /hrms/employees?companyId=${co0.id}` : '',
      editCompany: () => co0 && this.setState({ drawer: { type: 'company', id: co0.id } }),
      archiveCompany: () => co0 && this.setState({ confirm: { kind: 'company', id: co0.id, name: co0.name } }),
      archiveCompanyTip: archiveBlock(co0) || 'Archives this company',
      // Archived companies: under "Inactive" after the branches, or on the empty page when none is active.
      archivedPanelLive: list.length > 0 && !isLoading && sf === 'INACTIVE' && (coRows.length > 0 || coErr),
      archivedPanelEmpty: emptyWithArchived,
      archivedCoList: coRows.length > 0, archivedCoRows: coRows, archivedCoCount: coRows.length, coColumns,
      archivedCoCards: isEmpty || view === 'cards', archivedCoTable: !isEmpty && view === 'table',
      archivedCoHint: canEdit ? 'Restore one to bring it back to lists and pickers.' : 'Hidden from lists and pickers.',
      archivedCoError: coErr && coRows.length === 0, retryArchived: () => p.onRetryArchived && p.onRetryArchived(),
      emptyTitle: emptyWithArchived ? 'No active companies' : 'No companies yet',
      emptyDesc: emptyWithArchived ? (canEdit ? 'Restore an archived company below, or add a new one.' : 'Every company is archived.') : 'Add your first company to get started.',
      addBranch,
      addBranchAction: canEdit ? { label: 'Add branch', onClick: addBranch } : undefined,
      addCompanyAction: canEdit ? { label: 'Add company', onClick: addCompany } : undefined,
      retryAction: { label: 'Retry', onClick: () => p.onRetry && p.onRetry() },
      emptyBuildingIcon: dashIconComponent('building'), emptyErrorIcon: dashIconComponent('circleX'),
      skRow: { style: { height: 112, width: '100%', borderRadius: 14 } }, sk1: { style: { height: 20, width: '60%', borderRadius: 6 } },
      sk2: { style: { height: 72, width: '100%', borderRadius: 12 } }, sk3: { style: { height: 120, width: '100%', borderRadius: 12 } },
      companyDrawerOpen: !!(d && d.type === 'company'), branchDrawerOpen: !!(d && d.type === 'branch'),
      drawerCompany, drawerBranch, currentHq: hqB ? hqB.name : '', drawerBusy: this.state.busy,
      closeDrawer: () => this.setState({ drawer: null }),
      saveCompany: (c: any) => this.run(() => p.onSaveCompany && p.onSaveCompany(c), { drawer: null }),
      saveFormat: (f: any) => this.run(() => p.onSaveFormat && p.onSaveFormat(co0, f), {}),
      saveBranch: (b: any) => this.run(() => p.onSaveBranch && p.onSaveBranch({ ...b, companyId: b.companyId || (co0 && co0.id) }, hqB), { drawer: null }),
      confirmOpen: !!cf2,
      // Short when refused: the title is cut to one line, and the description names the company.
      confirmTitle: !cf2 ? 'Archive?' : restoring ? `Restore ${cf2.name}?` : block ? 'Can’t archive yet' : `Archive ${cf2.name}?`,
      confirmDesc: restoring ? 'It shows in lists and pickers again.' : block || (cf2 && cf2.kind === 'company'
        ? 'It will be hidden from lists and pickers. To bring it back, choose Inactive in the status filter.'
        : 'It will be hidden from lists and pickers. Existing employee assignments are kept.'),
      confirmCanAct: !block, cancelLabel: block ? 'OK' : 'Cancel',
      confirmLabel: restoring ? 'Restore' : 'Archive', confirmVariant: restoring ? 'primary' : 'danger',
      setConfirmOpen: (o: boolean) => { if (!o) this.setState({ confirm: null }) },
      cancelConfirm: () => this.setState({ confirm: null }),
      doConfirm: () => {
        if (!cf2 || block) return
        if (restoring) this.run(() => p.onRestoreCompany && p.onRestoreCompany({ id: cf2.id, name: cf2.name }), { confirm: null })
        else this.run(() => p.onArchive && p.onArchive(cf2.kind, cf2.id), { confirm: null })
      },
      icBuilding: dashIcon('building', 18), icBuildingLg: dashIcon('building', 24), icPencil: dashIcon('pencil', 15), icArchive: dashIcon('archive', 15),
      icShieldSm: dashIcon('shield', 14), icPlus: dashIcon('plus', 15), icGrid: dashIcon('grid', 14), icList: dashIcon('list', 14),
      icSearch: dashIcon('search', 16), icPin: dashIcon('mapPin', 14), icChevronDown: dashIcon('chevronDown', 16), icCheck: dashIcon('check', 16),
    }
  }
  render() { return dc(this, CompaniesPageView, 'CompaniesPage') }
}
