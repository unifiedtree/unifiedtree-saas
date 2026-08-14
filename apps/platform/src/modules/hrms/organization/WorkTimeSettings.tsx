import React, { useEffect, useMemo, useState } from 'react'
import { Building2, Save, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { HrPageHeader, HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useHrConfig, useUpdateHrConfig } from '../api/useSettings'

// Work-time settings = the per-company knobs that control how late-arrival and
// weekend logic run. Backed by GET/PUT /v1/settings/hr-configuration. Companies
// are picked at the top of the page (mirrors OrgSetup's per-company scope) so
// each subsidiary can carry its own grace + weekend rules.

// ISO-8601 weekday numbering: 1 = Monday .. 7 = Sunday. Matches the backend
// (Integer workweekStartDay; Integer[] weekendDays) and Java DayOfWeek.
const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: 'Monday',    short: 'Mon' },
  { value: 2, label: 'Tuesday',   short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday',  short: 'Thu' },
  { value: 5, label: 'Friday',    short: 'Fri' },
  { value: 6, label: 'Saturday',  short: 'Sat' },
  { value: 7, label: 'Sunday',    short: 'Sun' },
]

export const WorkTimeSettings: React.FC = () => {
  const { toast } = useToast()
  const { data: companies = [], isLoading: companiesLoading } = useCompanies()

  const [companyId, setCompanyId] = useState<string>('')

  // Default the company selector to the first available company once companies
  // load. If the user is a single-company tenant this hides the picker entirely.
  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies, companyId])

  const { data: cfg, isLoading: cfgLoading } = useHrConfig(companyId || undefined)
  const updateCfg = useUpdateHrConfig()

  // Local form state — hydrated from the server response, then mutated freely
  // until Save. Kept as strings for numeric inputs so an empty field renders
  // cleanly (blank vs "0"), then coerced on submit.
  const [graceMinutes, setGraceMinutes] = useState<string>('15')
  const [enableAutoDeduct, setEnableAutoDeduct] = useState<boolean>(false)
  const [workweekStartDay, setWorkweekStartDay] = useState<number>(1)
  const [weekendDays, setWeekendDays] = useState<number[]>([7])
  const [dirty, setDirty] = useState(false)

  // Hydrate the form when the config first arrives, or when the user swaps
  // companies. Guard on !dirty so an in-flight edit is never clobbered by a
  // background refetch (react-query invalidates aggressively).
  useEffect(() => {
    if (!cfg || dirty) return
    setGraceMinutes(String(cfg.lateGraceMinutes ?? 15))
    setEnableAutoDeduct(!!cfg.enableLateAutoDeduction)
    setWorkweekStartDay(cfg.workweekStartDay ?? 1)
    setWeekendDays(Array.isArray(cfg.weekendDays) && cfg.weekendDays.length > 0 ? [...cfg.weekendDays] : [7])
  }, [cfg, dirty])

  const graceOk = /^\d{1,3}$/.test(graceMinutes) && Number(graceMinutes) >= 0
  const weekendOk = weekendDays.length >= 0 && weekendDays.every((d) => d >= 1 && d <= 7)
  const canSave = !!companyId && graceOk && weekendOk && dirty && !updateCfg.isPending

  const toggleWeekend = (day: number) => {
    setDirty(true)
    setWeekendDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)))
  }

  const onSave = async () => {
    if (!companyId || !graceOk) return
    try {
      await updateCfg.mutateAsync({
        companyId,
        body: {
          lateGraceMinutes: Number(graceMinutes),
          enableLateAutoDeduction: enableAutoDeduct,
          workweekStartDay,
          weekendDays,
        },
      })
      toast('Work time settings saved', 'success')
      setDirty(false)
    } catch {
      toast('Failed to save work time settings', 'error')
    }
  }

  const summary = useMemo(() => {
    if (!weekendDays.length) return 'No weekend days'
    return weekendDays
      .map((d) => WEEKDAYS.find((w) => w.value === d)?.short ?? String(d))
      .join(', ')
  }, [weekendDays])

  const busy = companiesLoading || cfgLoading

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Master · Organisation"
        title="Work Time Settings"
        subtitle="Late-arrival grace period, auto-deduction, and workweek definition. Applies per company."
      />

      {/* Company selector — only rendered when there's more than one company
          in the tenant, to keep single-company workspaces uncluttered. */}
      {companies.length > 1 && (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-white px-4 py-2.5">
          <Building2 size={14} className="flex-shrink-0 text-[var(--text-tertiary)]" />
          <span className="text-sm text-[var(--text-secondary)]">Viewing for:</span>
          <select
            value={companyId}
            onChange={(e) => { setCompanyId(e.target.value); setDirty(false) }}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none"
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId && !companiesLoading ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-white p-8 text-center text-sm text-[var(--text-secondary)]">
          Create a company first to configure its work time settings.
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); onSave() }}
          className="space-y-6 rounded-xl border border-[var(--border-default)] bg-white p-6 shadow-sm"
        >
          {busy && (
            <p className="text-xs text-[var(--text-tertiary)]">Loading current settings…</p>
          )}

          {/* Late-arrival grace + auto-deduct */}
          <section className="space-y-3">
            <div className="flex items-start gap-2">
              <Clock size={16} className="mt-0.5 text-[var(--text-tertiary)]" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Late arrival</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Punches after the shift-start + grace window count as late.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  Grace minutes
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  value={graceMinutes}
                  onChange={(e) => { setGraceMinutes(e.target.value.replace(/\D/g, '').slice(0, 3)); setDirty(true) }}
                  className="w-full rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
                />
                {!graceOk && graceMinutes.length > 0 && (
                  <p className="mt-1 text-xs text-rose-600">Enter a whole number between 0 and 999.</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  Auto-deduct late minutes
                </label>
                <label className="flex h-[38px] items-center gap-2 rounded-lg border border-[var(--border-default)] bg-white px-3 text-sm text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableAutoDeduct}
                    onChange={(e) => { setEnableAutoDeduct(e.target.checked); setDirty(true) }}
                    className="h-4 w-4 accent-[#059669]"
                  />
                  <span>{enableAutoDeduct ? 'Enabled' : 'Disabled'}</span>
                </label>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  When on, minutes past the grace window are subtracted from paid hours.
                </p>
              </div>
            </div>
          </section>

          {/* Workweek definition */}
          <section className="space-y-3 border-t border-[var(--border-subtle)] pt-6">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Workweek</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                First day of the working week + which days count as weekends.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                Workweek starts on
              </label>
              <select
                value={workweekStartDay}
                onChange={(e) => { setWorkweekStartDay(Number(e.target.value)); setDirty(true) }}
                className="w-full max-w-xs rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              >
                {WEEKDAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                Weekend days
              </label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const on = weekendDays.includes(d.value)
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleWeekend(d.value)}
                      aria-pressed={on}
                      className={clsx(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                        on
                          ? 'border-[#059669] bg-[#ECFDF5] text-[#047857]'
                          : 'border-[var(--border-default)] bg-white text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
                      )}
                    >
                      {d.short}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                Currently: <span className="font-medium text-[var(--text-secondary)]">{summary}</span>
              </p>
            </div>
          </section>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--border-subtle)] pt-6">
            {dirty && (
              <span className="mr-auto text-xs text-amber-700">Unsaved changes</span>
            )}
            <HrButton type="submit" variant="primary" disabled={!canSave}>
              <Save size={14} /> {updateCfg.isPending ? 'Saving…' : 'Save Changes'}
            </HrButton>
          </div>
        </form>
      )}
    </div>
  )
}

export default WorkTimeSettings
