// The Access section of the Master design's "Add employee" drawer (shown only to
// people who can give roles or single permissions). It is a custom field of the
// design's RecordForm, so the choices are saved with the rest of the form as the
// new record's `access`; masterSync gives them to the person's login once the
// invitation has created it.
import { AccessPicker, NoLoginNote } from '@/modules/rbac/components/AccessPicker'
import { emptyAccess, type AccessDraft } from '@/modules/rbac/api/newPersonAccess'

export function MasterAccessStep({ value, onChange, canInvite }: { value: AccessDraft | undefined; onChange: (next: AccessDraft) => void; canInvite: boolean }) {
  return (
    <div style={{ gridColumn: '1 / -1', minWidth: 0 }} data-access-step>
      {canInvite ? <AccessPicker value={value ?? emptyAccess()} onChange={onChange} />
        : <NoLoginNote why="You can’t send login invites, so someone who can will need to invite them from their profile." />}
    </div>
  )
}
