import React, { useState } from 'react'
import { Plus, CalendarDays, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import { useHolidays, useCreateHoliday, useDeleteHoliday, type HolidayType } from '../api/useSettings'
import { useCompanies } from '../api/useOrg'

const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  NATIONAL: 'National',
  FESTIVAL: 'Festival',
  RESTRICTED: 'Restricted',
  REGIONAL: 'Regional',
  OPTIONAL: 'Optional',
  COMPANY: 'Company',
}

const HOLIDAY_TYPE_COLOR: Record<HolidayType, string> = {
  NATIONAL: 'text-red-400 bg-red-500/10',
  FESTIVAL: 'text-amber-400 bg-amber-500/10',
  RESTRICTED: 'text-blue-400 bg-blue-500/10',
  REGIONAL: 'text-green-400 bg-green-500/10',
  OPTIONAL: 'text-[#64748B] bg-[#F1F5F9]/40',
  COMPANY: 'text-[#0F6E56] bg-[#0F6E56]/10',
}

// ── Add Drawer ────────────────────────────────────────────────────────────────

interface AddHolidayDrawerProps {
  companyId: string
  year: number
  onClose: () => void
}

function AddHolidayDrawer({ companyId, year, onClose }: AddHolidayDrawerProps) {
  const { toast } = useToast()
  const create = useCreateHoliday()
  const [form, setForm] = useState({
    holidayDate: '',
    holidayName: '',
    holidayType: 'NATIONAL' as HolidayType,
    description: '',
  })

  const handleSave = async () => {
    if (!form.holidayDate || !form.holidayName.trim()) {
      toast('Date and name are required', 'error')
      return
    }
    try {
      await create.mutateAsync({
        companyId,
        ...form,
        description: form.description || undefined,
      })
      toast('Holiday added', 'success')
      onClose()
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to add holiday', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-[#E2E8F0] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h3 className="text-[#0F172A] font-semibold">Add Holiday</h3>
          <button onClick={onClose} className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg hover:bg-white/5">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#64748B] mb-1.5">Date *</label>
            <input
              type="date"
              value={form.holidayDate}
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              onChange={(e) => setForm((p) => ({ ...p, holidayDate: e.target.value }))}
              className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#64748B] mb-1.5">Holiday Name *</label>
            <input
              value={form.holidayName}
              onChange={(e) => setForm((p) => ({ ...p, holidayName: e.target.value }))}
              placeholder="e.g. Republic Day"
              className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#64748B] mb-1.5">Type</label>
            <select
              value={form.holidayType}
              onChange={(e) => setForm((p) => ({ ...p, holidayType: e.target.value as HolidayType }))}
              className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500 transition-colors"
            >
              {Object.entries(HOLIDAY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#64748B] mb-1.5">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Optional"
              className="w-full bg-white border border-[#E2E8F0]/60 rounded-xl px-3 py-2 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-[#E2E8F0]">
          <button onClick={onClose} className="px-4 py-2.5 border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] rounded-xl text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={create.isPending}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[#0F172A] font-medium rounded-xl text-sm transition-colors"
          >
            {create.isPending ? 'Adding...' : 'Add Holiday'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function HolidayCalendar() {
  const { toast } = useToast()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [showAdd, setShowAdd] = useState(false)
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: holidays = [], isLoading } = useHolidays(companyId, year)
  const deleteHoliday = useDeleteHoliday()

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i)
  const sorted = [...holidays].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}" from the holiday calendar?`)) return
    try {
      await deleteHoliday.mutateAsync(id)
      toast('Holiday removed', 'success')
    } catch {
      toast('Failed to remove holiday', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs text-[#64748B] font-medium">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-white border border-[#E2E8F0]/60 rounded-lg px-2.5 py-1.5 text-sm text-[#0F172A] focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {!isLoading && (
            <span className="text-xs text-slate-600">{sorted.length} holiday{sorted.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <Can code={P.SETTINGS_HOLIDAYS_WRITE}>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-xs font-medium rounded-xl transition-colors"
          >
            <Plus size={13} />
            Add Holiday
          </button>
        </Can>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[#E2E8F0]/60 rounded-2xl">
          <CalendarDays size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-[#64748B] text-sm font-medium">No holidays for {year}</p>
          <p className="text-slate-600 text-xs mt-1">Add public and company holidays for accurate leave calculations</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((h) => {
            const typeStyle = HOLIDAY_TYPE_COLOR[h.holidayType] ?? 'text-[#64748B] bg-[#F1F5F9]/40'
            return (
              <div key={h.id} className="bg-white border border-[#E2E8F0] rounded-2xl px-4 py-3 flex items-center gap-4">
                <div className="text-center w-12 flex-shrink-0">
                  <p className="text-lg font-bold text-[#0F172A] leading-none">
                    {format(new Date(h.holidayDate + 'T00:00:00'), 'd')}
                  </p>
                  <p className="text-xs text-[#64748B] uppercase">
                    {format(new Date(h.holidayDate + 'T00:00:00'), 'MMM')}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#0F172A] font-medium text-sm">{h.holidayName}</p>
                  {h.description && <p className="text-[#64748B] text-xs mt-0.5 truncate">{h.description}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${typeStyle}`}>
                  {HOLIDAY_TYPE_LABELS[h.holidayType] ?? h.holidayType}
                </span>
                <Can code={P.SETTINGS_HOLIDAYS_WRITE}>
                  <button
                    onClick={() => handleDelete(h.id, h.holidayName)}
                    disabled={deleteHoliday.isPending}
                    className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </Can>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && companyId && (
        <AddHolidayDrawer companyId={companyId} year={year} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
