// The small round button on a profile's photo (V143.102, w43): opens "Profile photo" with the
// ImagePicker (upload, change, remove). The page shows it only to the person themself or to
// someone with hrms.employee.write — the server checks the same.
import { useState } from 'react'
import { Dialog, PanelButton } from '@/design/kit/overlays'
import { dashIcon } from '@/design/dc/icons'
import { ImagePicker } from './ImagePicker'
import './imagePicker.css'

export interface PhotoEditButtonProps {
  employeeId: string
  name: string
  current?: string | null
  /** "your" wording when it is the viewer's own photo. */
  self?: boolean
  onChange?: (url: string | null) => void
}

export function PhotoEditButton({ employeeId, name, current, self, onChange }: PhotoEditButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="wf-photo-btn" aria-label={self ? 'Change your photo' : `Change ${name}’s photo`}
        title={self ? 'Change your photo' : 'Change photo'} onClick={() => setOpen(true)} data-photo-edit="">
        {dashIcon('pencil', 14)}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Profile photo" icon="users" width={460}
        sub={self ? 'Shown on your profile, in the directory, team lists and approvals.' : `Shown on ${name}’s profile, in the directory, team lists and approvals.`}
        footer={<PanelButton onClick={() => setOpen(false)}>Done</PanelButton>}>
        <ImagePicker kind="employee" id={employeeId} name={name} current={current} size={72} onChange={onChange} />
      </Dialog>
    </>
  )
}
