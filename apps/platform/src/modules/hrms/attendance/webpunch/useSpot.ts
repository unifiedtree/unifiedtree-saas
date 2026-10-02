// The browser's location for a punch dialog, with a line saying where things stand. With
// `zoneCheck` it also runs the pre-punch zone check the phone app makes (POST /geo-fence/check):
// inside the work area, an approved work-from-home day, or "Anywhere" pass; outside stops the
// punch before the camera matters. A server without that check (404) or any other failure lets
// the punch go on: the server applies the zone again when the punch arrives.
import { useEffect, useState } from 'react'
import { httpStatusOf } from '@/core/api/featureNotReady'
import { geoCheck, locate, locationErrorText, type Spot } from './webPunch'
import type { StepLine } from './useCamera'

export function useSpot(active: boolean, zoneCheck: boolean, verb: string) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [place, setPlace] = useState<string | null>(null)
  const [line, setLine] = useState<StepLine>({ state: 'wait', text: 'Finding your location…' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!active) return
    let live = true
    setLine({ state: 'wait', text: 'Finding your location…' })
    locate().then(async (s) => {
      if (!live) return
      setSpot(s)
      if (!zoneCheck) { setLine({ state: 'ok', text: 'Location found' }); return }
      setLine({ state: 'wait', text: 'Checking your work area…' })
      try {
        const g = await geoCheck(s)
        if (!live) return
        setPlace(g.branchName || null)
        if (g.withinFence) setLine({ state: 'ok', text: g.branchName ? `Location found · ${g.branchName}` : 'Location found' })
        else setLine({ state: 'bad', text: `You’re outside your work area${g.branchName ? ` (${g.branchName})` : ''}. ${g.message || ''} Move inside it to ${verb}.`.replace(/\s+/g, ' ').trim() })
      } catch (e) {
        if (!live) return
        if (httpStatusOf(e) === 403) setLine({ state: 'bad', text: `Your role can’t ${verb} from the web. Ask your admin.` })
        else setLine({ state: 'ok', text: 'Location found' })
      }
    }).catch((e) => { if (live) setLine({ state: 'bad', text: locationErrorText(e) }) })
    return () => { live = false }
  }, [active, zoneCheck, verb, attempt])
  return { spot, place, line, retry: () => setAttempt((n) => n + 1) }
}
