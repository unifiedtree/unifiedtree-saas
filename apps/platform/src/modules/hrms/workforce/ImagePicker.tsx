// Upload / change / remove one picture: an employee photo, a branch logo or an agency logo
// (useRecordImages, V143.102). A preview, "Upload …" (or "Change …") and "Remove". The browser
// shrinks the picture before it goes up; the server checks it again. Every outcome is a toast;
// a server without the feature says so ("isn’t switched on") and nothing else changes.
import { useRef, useState } from 'react'
import { Avatar, Button } from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { IMAGE_ACCEPT, prepareImage, removeRecordImage, uploadRecordImage, useRefreshImages, type ImageKind } from '../api/useRecordImages'
import './imagePicker.css'

export interface ImagePickerProps {
  kind: ImageKind
  /** The record's API id. */
  id: string
  /** Its name: the initials and the alt text. */
  name: string
  /** The picture it has now (an address), if any. */
  current?: string | null
  /** Told the new address (null once removed). */
  onChange?: (url: string | null) => void
  /** Preview size (default 56). */
  size?: number
  /** A compact row (the button only, no hint). */
  compact?: boolean
}

const NOUN: Record<ImageKind, string> = { employee: 'photo', branch: 'logo', agency: 'logo' }

export function ImagePicker({ kind, id, name, current, onChange, size = 56, compact }: ImagePickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const refresh = useRefreshImages()
  const [busy, setBusy] = useState<'up' | 'rm' | null>(null)
  const [shown, setShown] = useState<string | null | undefined>(undefined)
  const pic = shown === undefined ? current : shown
  const noun = NOUN[kind]

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file || busy) return
    setBusy('up')
    try {
      const blob = await prepareImage(file, kind === 'employee' ? 'photo' : 'logo')
      const url = await uploadRecordImage(kind, id, blob)
      setShown(url)
      onChange?.(url)
      refresh(kind)
      toast.success(kind === 'employee' ? `Photo updated for ${name}` : `Logo updated for ${name}`)
    } catch (e) {
      toast.error(`Couldn’t upload the ${noun}`, { detail: (e as Error).message || 'Please try again.' })
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    if (busy) return
    setBusy('rm')
    try {
      await removeRecordImage(kind, id)
      setShown(null)
      onChange?.(null)
      refresh(kind)
      toast.success(kind === 'employee' ? `Photo removed for ${name}` : `Logo removed for ${name}`)
    } catch (e) {
      toast.error(`Couldn’t remove the ${noun}`, { detail: (e as Error).message || 'Please try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="wf-imgpick" data-compact={compact ? '' : undefined} data-image-picker={kind}>
      <Avatar name={name} src={pic} size={size} tone="pale" shape={kind === 'employee' ? 'circle' : 'square'} decorative={false} />
      <div className="wf-imgpick__main">
        <div className="wf-imgpick__acts">
          <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden aria-hidden="true" tabIndex={-1} data-image-input={kind}
            onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size={36} variant="secondary" icon="upload" loading={busy === 'up'} disabled={!!busy} onClick={() => input.current?.click()}>
            {pic ? `Change ${noun}` : `Upload ${noun}`}
          </Button>
          {pic && <Button size={36} variant="ghost" icon="trash" loading={busy === 'rm'} disabled={!!busy} onClick={() => void remove()}>Remove</Button>}
        </div>
        {!compact && <div className="wf-imgpick__hint">JPG or PNG, up to 10 MB. It’s shrunk to 512 px{kind === 'employee' ? ' and cropped to a square' : ''}.</div>}
      </div>
    </div>
  )
}
