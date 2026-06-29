import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { Button, Field, Input } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { HrPageHeader, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import {
  useProbationConfig, useUpdateProbationConfig,
  useProbationReminders, useTriggerProbationScan,
} from '../api/useProbation'

const remTone: Record<string, PillTone> = { OVERDUE: 'red', FINAL: 'warn' }

export const ProbationSettings: React.FC = () => {
  const { toast } = useToast()
  const { data: config } = useProbationConfig()
  const update = useUpdateProbationConfig()
  const scan = useTriggerProbationScan()
  const { data: reminders = [], isLoading: remindersLoading } = useProbationReminders()
  const canReadReminders = usePermission(P.HRMS_PROBATION_REMINDERS_READ)

  const [days, setDays] = useState(7)
  const [autoExtend, setAutoExtend] = useState(false)
  const [autoExtendDays, setAutoExtendDays] = useState(90)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (config) {
      setDays(config.reminderDaysBefore)
      setAutoExtend(config.autoExtendEnabled)
      setAutoExtendDays(config.autoExtendDays)
      setDirty(false)
    }
  }, [config])

  const save = () => {
    if (days < 1 || days > 90) { toast('Reminder days must be between 1 and 90', 'error'); return }
    update.mutate({ reminderDaysBefore: days, autoExtendEnabled: autoExtend, autoExtendDays }, {
      onSuccess: () => { toast('Probation settings saved', 'success'); setDirty(false) },
      onError: (e) => toast((e as Error).message, 'error'),
    })
  }

  const triggerScan = () => {
    scan.mutate(undefined, {
      onSuccess: (res) => toast(`Scan complete — ${res.remindersSent} reminder(s) sent`, 'success'),
      onError: (e) => toast((e as Error).message, 'error'),
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6 sm:p-8">
      <HrPageHeader
        crumb="Settings"
        title="Probation Settings"
        subtitle="Configure when probation-ending reminders are sent to managers and HR."
      />

      <div className="space-y-5 rounded-2xl border border-border-default bg-white p-6 shadow-sm">
        <Field label="Reminder days before probation ends" hint="How many days ahead of the probation end date to email the manager and HR (1–90).">
          <Input
            type="number" min={1} max={90} value={days}
            onChange={(e) => { setDays(Number(e.target.value)); setDirty(true) }}
            className="max-w-[140px]"
          />
        </Field>

        <label className="flex cursor-pointer select-none items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={autoExtend}
            onClick={() => { setAutoExtend(v => !v); setDirty(true) }}
            className={clsx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              autoExtend ? 'bg-[#FF9D00]' : 'bg-border-strong')}
          >
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{ transform: autoExtend ? 'translateX(18px)' : 'translateX(4px)' }} />
          </button>
          <span className="text-sm font-medium text-text-primary">Auto-extend probation if no action is taken</span>
        </label>

        {autoExtend && (
          <Field label="Auto-extend by (days)">
            <Input
              type="number" min={1} max={365} value={autoExtendDays}
              onChange={(e) => { setAutoExtendDays(Number(e.target.value)); setDirty(true) }}
              className="max-w-[140px]"
            />
          </Field>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Can code={P.HRMS_PROBATION_CONFIG_UPDATE}>
            <Button loading={update.isPending} disabled={!dirty} onClick={save}>Save settings</Button>
          </Can>
          <Can code={P.HRMS_PROBATION_CONFIG_UPDATE}>
            <Button variant="secondary" loading={scan.isPending} onClick={triggerScan}>Trigger scan now</Button>
          </Can>
        </div>
      </div>

      {canReadReminders && (
        <div>
          <h2 className="mb-3 text-sm font-bold text-text-primary">Recent reminders</h2>
          <TableCard>
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Type</th>
                  <th className="hidden sm:table-cell">Probation End</th><th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {remindersLoading ? (
                  [...Array(3)].map((_, i) => <tr key={i}><td colSpan={4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
                ) : reminders.length === 0 ? (
                  <tr><td colSpan={4} className="py-12 text-center text-sm text-text-tertiary">No reminders sent yet</td></tr>
                ) : reminders.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-text-primary">{r.employeeName}</td>
                    <td><HrStatusPill tone={remTone[r.reminderType] ?? 'info'}>{r.reminderType}</HrStatusPill></td>
                    <td className="hidden sm:table-cell text-text-secondary">{format(new Date(r.probationEndDate), 'd MMM yyyy')}</td>
                    <td className="text-text-secondary">{format(new Date(r.sentAt), 'd MMM yyyy, HH:mm')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </div>
  )
}
