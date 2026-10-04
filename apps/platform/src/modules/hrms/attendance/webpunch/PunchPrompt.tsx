// The check-in prompt after sign-in (DECISIONS 21, the NextWave reference): once the welcome has
// gone and the shell is on screen, the web punch dialog opens by itself in check-in mode, for
// someone who can check in from the web and hasn't yet today. The rules are in punchPromptRules.ts.
// It is required: it can't be put aside while a check-in is possible. Only when one isn't (no enrolled
// face and no self-enrolment, a locked face, outside the office, a blocked camera) can the person
// continue without checking in, and then it stays away for this visit.
// The shell loads this file only for people who may punch from the web (mayPunchFromWeb).
import { Component, useEffect, useState, type ReactNode } from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { istToday } from '@/design/dc/dates'
import { useWebPunchSetting, webPunchAllowed } from '../../api/shared/useWebPunchSetting'
import { useMeEmployee } from '../../ess/home/homeApi'
import { useMyDay } from './useMyDay'
import { WebPunchDialog } from './WebPunchDialog'
import { anotherDialogOpen, markOpened, openedThisVisit, promptDecision } from './punchPromptRules'

export function PunchPrompt({ ready }: { ready: boolean }) {
  return <Quiet><Prompt ready={ready} /></Quiet>
}

function Prompt({ ready }: { ready: boolean }) {
  const userId = useSdkStore((s) => s.user?.id) ?? ''
  // Settled once per visit: straight away when it already opened in this tab today.
  const [settled, setSettled] = useState<'open' | 'skip' | null>(() => {
    const today = istToday()
    return !userId || openedThisVisit(userId, today) ? 'skip' : null
  })
  const [open, setOpen] = useState(false)

  // Read only until it's settled, so nothing keeps polling afterwards. Home reads the same
  // queries, so its first load doesn't ask again.
  const asking = settled === null
  const me = useMeEmployee({ enabled: asking })
  const setting = useWebPunchSetting(me.data?.companyId, { enabled: asking })
  const day = useMyDay({ enabled: asking })
  const employee = me.isError ? null : me.data
  const allowed = setting.isError || setting.notAvailable ? false : setting.data ? webPunchAllowed(setting) : undefined
  const myDay = day.isError || day.notAvailable ? null : day.data

  useEffect(() => {
    if (settled) return
    const verdict = promptDecision({ ready, employee, allowed, day: myDay, otherDialog: anotherDialogOpen() })
    if (verdict === 'wait') return
    if (verdict === 'open') { markOpened(userId, istToday()); setOpen(true) }
    setSettled(verdict)
  }, [settled, ready, employee, allowed, myDay, userId])

  if (!open) return null
  return (
    <WebPunchDialog
      open
      mode="in"
      required
      onClose={() => setOpen(false)}
    />
  )
}

/** Whatever goes wrong in here, the app carries on without the prompt. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[PunchPrompt] failed', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
