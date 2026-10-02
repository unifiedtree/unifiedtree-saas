// Pieces the punch dialogs share: the camera box with its face guide, a step line with its dot,
// and the note that says what went wrong. Styles in webPunch.css (tokens only).
import type { ReactNode, RefObject } from 'react'
import { dashIcon } from '@/design/dc/icons'
import type { StepLine } from './useCamera'
import './webPunch.css'

export function CameraBox({ videoRef, on, scanning, label = 'Camera preview' }: {
  videoRef: RefObject<HTMLVideoElement>; on: boolean; scanning?: boolean; label?: string
}) {
  return (
    <div className="uwp-cam" role="img" aria-label={label}>
      {on ? (
        <>
          <video ref={videoRef} className="uwp-video" autoPlay playsInline muted aria-hidden="true" />
          <svg className="uwp-guide" viewBox="0 0 300 400" aria-hidden="true">
            <ellipse cx="150" cy="190" rx="92" ry="122" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="10 8" />
            <path d="M22 60V30a8 8 0 0 1 8-8h30M240 22h30a8 8 0 0 1 8 8v30M278 340v30a8 8 0 0 1-8 8h-30M60 378H30a8 8 0 0 1-8-8v-30" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          {scanning && <span className="uwp-scan" aria-hidden="true" />}
        </>
      ) : (
        <span className="uwp-cam-idle" aria-hidden="true">{dashIcon('scanFace', 44)}</span>
      )}
    </div>
  )
}

export function StepDot({ state }: { state: StepLine['state'] }) {
  return (
    <span className="uwp-dot" data-state={state} aria-hidden="true">
      {state === 'ok' ? dashIcon('check', 12) : state === 'bad' ? dashIcon('x', 12) : <span className="uwp-spin" />}
    </span>
  )
}

export function Step({ line }: { line: StepLine }) {
  return <li className="uwp-line" data-state={line.state}><StepDot state={line.state} />{line.text}</li>
}

export function PunchNote({ tone, children }: { tone: 'bad' | 'warn'; children: ReactNode }) {
  return <p className="uwp-callout" data-tone={tone} role="alert">{children}</p>
}
