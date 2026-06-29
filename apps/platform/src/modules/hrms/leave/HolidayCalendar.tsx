import React, { useState } from 'react'
import { Plus, CalendarDays, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { useToast } from '@/shared/hooks/useToast'
import { Can, P } from '@unifiedtree/sdk'
import { TableSkeleton } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrStatusPill, HrButton, type PillTone } from '@/shared/components/hr'
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

const HOLIDAY_TYPE_TONE: Record<HolidayType, PillTone> = {
  NATIONAL: 'red',
  FESTIVAL: 'orange',
  RESTRICTED: 'info',
  REGIONAL: 'green',
  OPTIONAL: 'gray',
  COMPANY: 'teal',
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
      <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md bg-white border-l border-border-default flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h3 className="text-text-primary font-semibold">Add Holiday</h3>
          <button onClick={onClose} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-bg-base">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Date *</label>
            <input
              type="date"
              value={form.holidayDate}
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              onChange={(e) => setForm((p) => ({ ...p, holidayDate: e.target.value }))}
              className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-[#FF9D00] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Holiday Name *</label>
            <input
              value={form.holidayName}
              onChange={(e) => setForm((p) => ({ ...p, holidayName: e.target.value }))}
              placeholder="e.g. Republic Day"
              className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-[#FF9D00] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Type</label>
            <select
              value={form.holidayType}
              onChange={(e) => setForm((p) => ({ ...p, holidayType: e.target.value as HolidayType }))}
              className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-[#FF9D00] transition-colors"
            >
              {Object.entries(HOLIDAY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Optional"
              className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-[#FF9D00] transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-border-default">
          <HrButton variant="ghost" onClick={onClose}>
            Cancel
          </HrButton>
          <HrButton
            onClick={handleSave}
            disabled={create.isPending}
            className="flex-1"
          >
            {create.isPending ? 'Adding...' : 'Add Holiday'}
          </HrButton>
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
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader
        title="Holiday Calendar"
        crumb="Leave Management"
        subtitle={!isLoading ? `${sorted.length} holiday${sorted.length !== 1 ? 's' : ''} in ${year}` : undefined}
        actions={
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary font-medium">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="bg-white border border-border-default rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-[#FF9D00] transition-colors"
              >
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Can code={P.SETTINGS_HOLIDAYS_WRITE}>
              <HrButton size="sm" onClick={() => setShowAdd(true)}>
                <Plus size={14} />
                Add Holiday
              </HrButton>
            </Can>
          </>
        }
      />

      {isLoading ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border-default rounded-2xl bg-white">
          <CalendarDays size={32} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-text-secondary text-sm font-medium">No holidays for {year}</p>
          <p className="text-text-tertiary text-xs mt-1">Add public and company holidays for accurate leave calculations</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((h) => (
            <div key={h.id} className="bg-white border border-border-default rounded-2xl px-4 py-3 flex items-center gap-4 shadow-sm">
              <div className="text-center w-12 flex-shrink-0">
                <p className="text-lg font-bold text-text-primary leading-none">
                  {format(new Date(h.holidayDate + 'T00:00:00'), 'd')}
                </p>
                <p className="text-xs text-text-tertiary uppercase">
                  {format(new Date(h.holidayDate + 'T00:00:00'), 'MMM')}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary font-medium text-sm">{h.holidayName}</p>
                {h.description && <p className="text-text-secondary text-xs mt-0.5 truncate">{h.description}</p>}
              </div>
              <HrStatusPill tone={HOLIDAY_TYPE_TONE[h.holidayType] ?? 'gray'}>
                {HOLIDAY_TYPE_LABELS[h.holidayType] ?? h.holidayType}
              </HrStatusPill>
              <Can code={P.SETTINGS_HOLIDAYS_WRITE}>
                <button
                  onClick={() => handleDelete(h.id, h.holidayName)}
                  disabled={deleteHoliday.isPending}
                  className="p-1.5 text-text-tertiary hover:text-[#B91C1C] rounded-lg hover:bg-[#FEE2E2] disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {showAdd && companyId && (
        <AddHolidayDrawer companyId={companyId} year={year} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
