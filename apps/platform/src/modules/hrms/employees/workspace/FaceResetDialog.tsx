// Reset face enrollment (HR): a kit confirm dialog. The copy is the corrected one from e32a4dc6.
import { useState } from 'react'
import { Dialog, PanelButton, useToast } from '@/design/kit/overlays'

export function FaceResetDialog({ open, onClose, name, onReset }: { open: boolean; onClose: () => void; name: string; onReset: () => Promise<string> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { toast.success(await onReset()); onClose() } catch (e) { toast.error('Couldn’t reset the face enrollment', { detail: (e as Error)?.message }) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Reset face enrollment?" icon="scanFace" tone="warning" busy={busy}
      sub={`This deletes the stored face templates and clears any verification lockout. Face punch-in stops working for ${name} until they enrol again — from the mobile app, or with Enroll face here.`}
      footer={<>
        <PanelButton onClick={onClose}>Cancel</PanelButton>
        <PanelButton variant="danger" busy={busy} onClick={() => void go()}>Yes, reset</PanelButton>
      </>} />
  )
}
