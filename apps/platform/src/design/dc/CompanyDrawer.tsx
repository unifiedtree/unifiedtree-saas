// Ported from the design component CompanyDrawer.dc.html.
import { createElement } from 'react'
import { DCLogic, dc } from './dc-runtime'
import { CompanyDrawerView } from './CompanyDrawer.view'
import { HrButton } from '@/shared/components/hr'

export class CompanyDrawer extends DCLogic {
  state: any = { touched: false, f: null }
  init() {
    const c = this.props.company || {}
    return { name: c.name || '', legal: c.legal || '', industry: c.industry || '', cin: c.cin || '', pan: c.pan || '', gstin: c.gstin || '', prefix: c.prefix || 'EMP', next: c.next || '0001' }
  }
  renderVals() {
    const p = this.props, f = this.state.f || this.init(), isEdit = !!(p.company && p.company.id)
    const up = (v: string) => v.toUpperCase().replace(/\s/g, '')
    const set = (k: string, fn?: (v: string) => string) => (e: any) => this.setState({ f: { ...f, [k]: fn ? fn(e.target.value) : e.target.value } })
    const prefixOk = /^[A-Za-z0-9]{1,10}$/.test(f.prefix), nextOk = /^\d{1,8}$/.test(f.next)
    const valid = !!f.name.trim()
    const busy = !!p.saving
    const save = () => {
      if (!valid) { this.setState({ touched: true }); return }
      if (p.onSave) p.onSave({ ...(p.company || {}), name: f.name.trim(), legal: f.legal.trim(), industry: f.industry.trim(), currency: 'INR', country: 'India', cin: f.cin, pan: f.pan, gstin: f.gstin })
    }
    const footer = createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      createElement(HrButton, { variant: 'ghost', onClick: p.onClose } as any, 'Cancel'),
      createElement(HrButton, { onClick: save, disabled: !valid || busy } as any, busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'))
    return {
      title: isEdit ? 'Edit company' : 'Add company', close: p.onClose || (() => {}), footer, f, isEdit,
      nameError: this.state.touched && !valid, touch: () => this.setState({ touched: true }),
      setName: set('name'), setLegal: set('legal'), setIndustry: set('industry'),
      setCin: set('cin', up), setPan: set('pan', up), setGstin: set('gstin', up),
      setPrefix: set('prefix', (v) => v.toUpperCase()), setNext: set('next'),
      prefixError: !prefixOk, nextError: !nextOk, formatInvalid: !prefixOk || !nextOk || busy,
      preview: prefixOk && nextOk ? `${f.prefix}-${f.next}` : '—',
      saveFormat: () => prefixOk && nextOk && p.onSaveFormat && p.onSaveFormat({ prefix: f.prefix, next: f.next }),
    }
  }
  render() { return dc(this, CompanyDrawerView, 'CompanyDrawer') }
}
