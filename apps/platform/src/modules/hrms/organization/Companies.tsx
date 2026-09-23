import React, { useState } from 'react'
import { Building2, MapPin, Edit, Users, Focus, Save, Plus } from 'lucide-react'
import { useCompanies } from '../api/useOrg'
import { HrAvatar, HrButton, HrStatusPill } from '@/shared/components/hr'

export const Companies: React.FC = () => {
  const { data: companies = [] } = useCompanies()
  const activeCompany = companies[0]

  const [geofenceEnabled, setGeofenceEnabled] = useState(true)
  const [radius, setRadius] = useState(500)

  return (
    <div className="mx-auto max-w-[1680px] space-y-7 p-4 sm:p-6 lg:p-8">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
            <Building2 size={14} /> Company Profile / Companies & Branches
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Companies & Branches</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <HrButton variant="ghost"><Plus size={15} /> Add Company</HrButton>
          <HrButton><MapPin size={15} /> Add Branch</HrButton>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left: Hierarchy View */}
        <div className="flex flex-col gap-6">
          <section className="ut-card overflow-hidden">
            {/* Company Header */}
            <div className="flex items-center justify-between border-b border-[var(--border-default)] p-5" style={{ background: 'linear-gradient(90deg, #EFF6FF, var(--bg-base))' }}>
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2563EB] text-xl font-bold text-white shadow-sm">
                  {activeCompany?.name ? activeCompany.name.substring(0, 2).toUpperCase() : 'UT'}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">{activeCompany?.name || 'Unified Tree Holdings Ltd.'}</h3>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">Reg: UT-2023-9884 • 1,848 Employees Total</div>
                </div>
              </div>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                <Edit size={16} />
              </button>
            </div>

            {/* Branches List */}
            <div className="p-5">
              <h4 className="mb-4 text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Branch Locations (3)</h4>

              {/* Branch Item 1 (HQ) */}
              <div className="group mb-4 flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-4 transition-colors hover:border-[#2563EB]">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-white p-2 text-[#2563EB]">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-[var(--text-primary)]">
                      Global HQ - Bangalore
                      <span className="rounded-md bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#2563EB]">Headquarters</span>
                    </div>
                    <div className="mb-2 flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
                      <MapPin size={12} /> Cyber Park, Electronics City Phase 1, Bengaluru
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <HrAvatar name="Amit Sharma" seed={1}  />
                        <span className="text-[11px] font-medium text-gray-700">Amit Sharma (Mgr)</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                        <Users size={12} /> 1,200 Emp
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-semibold text-[#059669]">
                    <MapPin size={12} className="fill-current" /> Geofence Active (500m)
                  </div>
                  <div><HrButton variant="ghost" size="sm">Manage</HrButton></div>
                </div>
              </div>

              {/* Branch Item 2 */}
              <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-white p-4">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-2 text-[#D97706]">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <div className="mb-1 text-[15px] font-semibold text-[var(--text-primary)]">Manufacturing Plant - Pune</div>
                    <div className="mb-2 flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
                      <MapPin size={12} /> MIDC Bhosari, Pune, Maharashtra
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <HrAvatar name="Rajesh Kumar" seed={2}  />
                        <span className="text-[11px] font-medium text-gray-700">Rajesh Kumar (Plant Head)</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                        <Users size={12} /> 520 Emp
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-semibold text-[#059669]">
                    <MapPin size={12} className="fill-current" /> Geofence Active (1km)
                  </div>
                  <div><HrButton variant="ghost" size="sm">Manage</HrButton></div>
                </div>
              </div>

              {/* Branch Item 3 */}
              <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-white p-4">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-2 text-[#9333EA]">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <div className="mb-1 text-[15px] font-semibold text-[var(--text-primary)]">Sales Hub - Mumbai</div>
                    <div className="mb-2 flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
                      <MapPin size={12} /> BKC, Bandra East, Mumbai
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <HrAvatar name="Priya Mehta" seed={3}  />
                        <span className="text-[11px] font-medium text-gray-700">Priya Mehta (VP Sales)</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                        <Users size={12} /> 128 Emp
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#DC2626]">
                    <MapPin size={12} className="opacity-60" /> Geofence Disabled
                  </div>
                  <div><HrButton variant="ghost" size="sm">Manage</HrButton></div>
                </div>
              </div>

            </div>
          </section>
        </div>

        {/* Right: Geofence Setup Widget */}
        <div className="sticky top-6">
          <section className="ut-card p-5">
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-default)] pb-4">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-primary)]">
                <MapPin size={18} className="text-[#2563EB]" /> Branch Geofence
              </div>
              <span className="rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-0.5 text-[11px] font-medium">HQ - Bangalore</span>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-gray-700">Attendance Geofencing</span>
              <button
                type="button"
                role="switch"
                aria-checked={geofenceEnabled}
                onClick={() => setGeofenceEnabled(!geofenceEnabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2 ${geofenceEnabled ? 'bg-[#2563EB]' : 'bg-gray-200'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${geofenceEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Mock Map */}
            <div className="relative mb-4 h-48 w-full overflow-hidden rounded-lg border border-[var(--border-default)] bg-gray-200">
              {/* Grid lines pattern */}
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
              
              {/* Radius Circle */}
              <div className="absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#2563EB] bg-blue-500/20">
                <MapPin className="fill-[#2563EB] text-white drop-shadow-md" size={28} />
              </div>

              <button className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
                <Focus size={14} /> Recenter
              </button>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Allowed Radius</label>
              <div className="flex items-center gap-3">
                <input 
                  type="range" 
                  min="100" max="2000" 
                  value={radius} 
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="flex-1 accent-[#2563EB]"
                />
                <div className="w-16 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] py-1 text-center text-[13px] font-semibold text-gray-700">
                  {radius}m
                </div>
              </div>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Latitude</label>
                <input type="text" defaultValue="12.8452" className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-center text-[13px] outline-none focus:border-[#2563EB]" />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Longitude</label>
                <input type="text" defaultValue="77.6602" className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-center text-[13px] outline-none focus:border-[#2563EB]" />
              </div>
            </div>

            <HrButton className="w-full justify-center"><Save size={16} /> Save Geofence</HrButton>
          </section>
        </div>
      </div>
    </div>
  )
}
