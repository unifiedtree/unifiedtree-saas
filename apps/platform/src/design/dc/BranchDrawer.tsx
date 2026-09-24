// Ported from the design component BranchDrawer.dc.html.
import { createElement, createRef } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { BranchDrawerView } from './BranchDrawer.view'
import { HrButton } from '@/shared/components/hr'
import { dashIcon } from './icons'

const CITY: Record<string, [number, number]> = {
  Mumbai: [19.0759837, 72.8776559], Pune: [18.5204303, 73.8567437], Bengaluru: [12.9715987, 77.5945627], Hyderabad: [17.3601415, 78.5367771],
  Chennai: [13.0826802, 80.2707184], Delhi: [28.6139391, 77.2090212], Gurugram: [28.4594965, 77.0266383], Ahmedabad: [23.022505, 72.5713621],
  Kolkata: [22.572646, 88.363895], Kochi: [9.9312328, 76.2673041],
}
const STATES = ['Andhra Pradesh', 'Delhi', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Maharashtra', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal']

export class BranchDrawer extends DCLogic {
  state: any = { touched: false, f: null }
  init() {
    const b = this.props.branch || {}
    const g = b.geo || { on: true, lat: '', lng: '', radius: 100 }
    return {
      name: b.name || '', code: b.code || '', city: b.city || '', state: b.state || '', hq: !!b.hq,
      geoOn: b.id ? !!g.on : true,
      lat: g.lat === '' || g.lat == null ? '' : String(g.lat),
      lng: g.lng === '' || g.lng == null ? '' : String(g.lng),
      radius: String(g.radius || 100),
    }
  }
  secDetails = createRef<HTMLElement>()
  secLocation = createRef<HTMLElement>()
  secGeo = createRef<HTMLElement>()
  secReview = createRef<HTMLElement>()
  jump(ref: { current: HTMLElement | null }) {
    const el = ref.current
    if (!el) return
    let sp = el.parentElement
    while (sp && !(sp.scrollHeight > sp.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sp).overflowY))) sp = sp.parentElement
    if (sp) sp.scrollTo({ top: sp.scrollTop + el.getBoundingClientRect().top - sp.getBoundingClientRect().top - 12, behavior: 'smooth' })
  }
  renderVals() {
    const p = this.props, f = this.state.f || this.init()
    const set = (k: string, fn?: (v: string) => string) => (e: any) => {
      const v = fn ? fn(e.target.value) : e.target.value
      const nf = { ...f, [k]: v }
      if (k === 'city' && CITY[v] && (!f.lat || !f.lng)) { nf.lat = String(CITY[v][0]); nf.lng = String(CITY[v][1]) }
      this.setState({ f: nf })
    }
    const readOnly = !!p.readOnly, isEdit = !!(p.branch && p.branch.id)
    const geoLocked = !readOnly && !!p.geoReadOnly
    const lat = Number(f.lat), lng = Number(f.lng), rad = Number(f.radius)
    const coordsOk = f.lat !== '' && f.lng !== '' && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    const radiusOk = isFinite(rad) && rad >= 25 && rad <= 5000
    const okDetails = !!f.name.trim(), okLocation = !!f.city.trim() && !!f.state, okGeo = !f.geoOn || (coordsOk && radiusOk)
    const valid = okDetails && okLocation && okGeo
    const doneFlags = [okDetails, okLocation, okGeo && okDetails && okLocation, false]
    const firstTodo = doneFlags.findIndex((d) => !d)
    const refs = [this.secDetails, this.secLocation, this.secGeo, this.secReview]
    const steps = ['Branch details', 'Location', 'Attendance', 'Review'].map((label, i) => ({
      n: i + 1, label, done: doneFlags[i], current: !doneFlags[i] && i === firstTodo, todo: !doneFlags[i] && i !== firstTodo, onClick: () => this.jump(refs[i]),
    }))
    const busy = !!p.saving
    const save = () => {
      if (!valid) { this.setState({ touched: true }); return }
      if (p.onSave) p.onSave({
        ...(p.branch || {}), name: f.name.trim(), code: f.code.trim().toUpperCase(), city: f.city.trim(), state: f.state, country: 'India', hq: f.hq,
        geo: { on: f.geoOn, lat: coordsOk ? lat : '', lng: coordsOk ? lng : '', radius: radiusOk ? rad : 100 },
      })
    }
    const footer = createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' } },
      readOnly
        ? createElement(HrButton, { variant: 'ghost', onClick: p.onClose } as any, 'Close')
        : [
          createElement(HrButton, { key: 'c', variant: 'ghost', onClick: p.onClose } as any, 'Cancel'),
          createElement(HrButton, { key: 's', onClick: save, disabled: !valid || busy } as any, busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create branch', isEdit || busy ? null : dashIcon('arrowRight', 15)),
        ])
    const otherHq = p.currentHq && (!p.branch || p.currentHq !== p.branch.name) ? p.currentHq : null
    return {
      title: readOnly ? 'Branch details' : isEdit ? 'Edit branch' : 'Create branch',
      subtitle: isEdit ? `${p.branch.name} · ${p.companyName || ''}` : `Add a new workplace location for ${p.companyName || 'this company'}.`,
      close: p.onClose || (() => {}), footer, readOnly, f, steps,
      secDetails: this.secDetails, secLocation: this.secLocation, secGeo: this.secGeo, secReview: this.secReview,
      nameError: this.state.touched && !okDetails, touchName: () => this.setState({ touched: true }),
      radiusError: f.geoOn && f.radius !== '' && !radiusOk,
      states: STATES,
      hqHint: f.hq && otherHq ? `Replaces ${otherHq} as the headquarters.` : 'The headquarters is used as the primary company location.',
      geoOn: f.geoOn, geoOff: !f.geoOn,
      toggleGeo: () => !readOnly && !geoLocked && this.setState({ f: { ...f, geoOn: !f.geoOn } }),
      pick: (la: number, ln: number) => !geoLocked && this.setState({ f: { ...f, lat: String(la), lng: String(ln) } }),
      mapReadOnly: readOnly || geoLocked,
      canCentre: !readOnly && !geoLocked && !!CITY[f.city],
      centre: () => CITY[f.city] && this.setState({ f: { ...f, lat: String(CITY[f.city][0]), lng: String(CITY[f.city][1]) } }),
      setName: set('name'), setCode: set('code', (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')), setCity: set('city'), setState: set('state'),
      setHq: (e: any) => this.setState({ f: { ...f, hq: e.target.checked } }),
      setLat: set('lat'), setLng: set('lng'), setRadius: set('radius'),
      review: [
        { k: 'Branch', v: f.name || '—' }, { k: 'Code', v: f.code || '—' }, { k: 'Location', v: f.city && f.state ? `${f.city}, ${f.state}` : '—' },
        { k: 'Headquarters', v: f.hq ? 'Yes' : 'No' },
        { k: 'Geofence', v: f.geoOn ? (coordsOk ? `${lat.toFixed(4)}, ${lng.toFixed(4)} · ${f.radius} m` : 'Pin not set') : 'Off' },
      ],
      icLock: dashIcon('lock', 16), icBuilding: dashIcon('building', 16), icPin: dashIcon('mapPin', 16), icShield: dashIcon('shield', 16), icCross: dashIcon('crosshair', 14),
    }
  }
  render() { return dc(this, BranchDrawerView, 'BranchDrawer') }
}
