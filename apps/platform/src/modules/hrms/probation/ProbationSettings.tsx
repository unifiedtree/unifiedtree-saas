import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { DataTable, Badge, Button, Field, Input, type Column } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  useProbationConfig, useUpdateProbationConfig,
  useProbationReminders, useTriggerProbationScan,
  type ProbationReminder,
} from '../api/useProbation'

const reminderColumns: Column<ProbationReminder>[] = [
  { key: 'employeeName', header: 'Employee', cell: (r) => r.employeeName },
  {
    key: 'reminderType', header: 'Type',
    cell: (r) => (
      <Badge tone={r.reminderType === 'OVERDUE' ? 'error' : r.reminderType === 'FINAL' ? 'warning' : 'info'}>
        {r.reminderType}
      </Badge>
    ),
  },
  { key: 'probationEndDate', header: 'Probation End', cell: (r) => format(new Date(r.probationEndDate), 'd MMM yyyy'), hideBelow: 'sm' },
  { key: 'sentAt', header: 'Sent', cell: (r) => format(new Date(r.sentAt), 'd MMM yyyy, HH:mm') },
]

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
    <div className="max-w-4xl mx-auto p-6 sm:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">Probation Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Configure when probation-ending reminders are sent to managers and HR.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        <Field label="Reminder days before probation ends" hint="How many days ahead of the probation end date to email the manager and HR (1–90).">
          <Input
            type="number" min={1} max={90} value={days}
            onChange={(e) => { setDays(Number(e.target.value)); setDirty(true) }}
            className="max-w-[140px]"
          />
        </Field>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={autoExtend}
            onClick={() => { setAutoExtend(v => !v); setDirty(true) }}
            className={clsx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              autoExtend ? 'bg-[#0F6E56]' : 'bg-slate-300')}
          >
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{ transform: autoExtend ? 'translateX(18px)' : 'translateX(4px)' }} />
          </button>
          <span className="text-sm font-medium text-slate-800">Auto-extend probation if no action is taken</span>
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
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-800">Recent reminders</h2>
          </div>
          <DataTable
            columns={reminderColumns}
            data={reminders}
            getRowKey={(r) => r.id}
            isLoading={remindersLoading}
            emptyTitle="No reminders sent yet"
            emptyDescription="Reminders appear here once the scan fires."
          />
        </div>
      )}
    </div>
  )
}
