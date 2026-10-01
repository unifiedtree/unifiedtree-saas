// The live camera for the punch dialogs: opens while `active`, stops when it isn't (or on unmount),
// and says what's happening in a line the dialog shows. The photo is taken with faceEnroll's
// captureFrame, prepared the way the phone and the web enrolment prepare theirs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { cameraErrorText, captureFrame, openCamera, type Frame } from '../face/faceEnroll'

export interface StepLine { state: 'wait' | 'ok' | 'bad'; text: string }

export function useCamera(active: boolean, readyText = 'Camera ready. Look straight at it.') {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [line, setLine] = useState<StepLine>({ state: 'wait', text: 'Starting the camera…' })
  const [attempt, setAttempt] = useState(0)
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => {
    if (!active) { stop(); return }
    let live = true
    setLine({ state: 'wait', text: 'Starting the camera…' })
    openCamera().then((stream) => {
      if (!live) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setLine({ state: 'bad', text: 'The camera stopped. Check that it’s connected, then try again.' }))
      const v = videoRef.current
      if (v) { v.srcObject = stream; void v.play().catch(() => {}) }
      setLine({ state: 'ok', text: readyText })
    }).catch((e) => { if (live) setLine({ state: 'bad', text: cameraErrorText(e) }) })
    return () => { live = false; stop() }
  }, [active, attempt, stop, readyText])
  const capture = useCallback((): Frame | null => (videoRef.current ? captureFrame(videoRef.current) : null), [])
  return { videoRef, line, retry: () => setAttempt((n) => n + 1), stop, capture }
}
