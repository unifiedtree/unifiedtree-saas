// Help & support (More → Settings): the people in this workspace who can help — the ones who manage
// users and roles — with their work email (DECISIONS 11). Never a vendor name or link (white label).
//
// The list comes from GET /v1/workspace/admin-contacts (the shared useAdminContacts hook, loaded when
// the panel opens). While the endpoint answers FEATURE_NOT_READY or 404 the panel says the contacts
// aren't available yet, instead of showing anything made up.
import { SidePanel } from '@/design/kit/overlays'
import { useAdminContacts } from '@/modules/hrms/api/shared/useAdminContacts'
import { Avatar, EmptyState, ErrorState, SkeletonList } from '@/design/kit/display'
import { ShellIcon } from './shellIcons'

export interface HelpContact {
  name: string
  email: string | null
  /** Their role, e.g. "Owner". */
  role?: string | null
}

export interface HelpContactsState {
  data?: HelpContact[]
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  /** The endpoint isn't there yet (not deployed, or its feature isn't switched on). */
  notAvailable?: boolean
  refetch?: () => void
  isFetching?: boolean
}

/** The contacts, fetched only while the panel is open. */
export function useHelpContacts(open: boolean): HelpContactsState {
  const q = useAdminContacts({ enabled: open })
  return {
    data: q.data?.map((c) => ({ name: c.name, email: c.email, role: c.roleLabel })),
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    notAvailable: q.notAvailable,
    isFetching: q.isFetching,
    refetch: () => { void q.refetch() },
  }
}

export function HelpPanel({ open, onClose, contacts }: { open: boolean; onClose: () => void; contacts: HelpContactsState }) {
  const list = contacts.data ?? []
  let body
  if (contacts.notAvailable) {
    body = <EmptyState icon="help" title="Contacts aren’t available yet" hint="Ask the person who invited you to this workspace." />
  } else if (contacts.isLoading) {
    body = <SkeletonList rows={3} label="Loading contacts" />
  } else if (contacts.isError) {
    body = <ErrorState error={contacts.error} title="Couldn’t load the contacts" onRetry={contacts.refetch} retrying={contacts.isFetching} />
  } else if (!list.length) {
    body = <EmptyState icon="help" title="No one to list yet" hint="Nobody in this workspace manages users and roles yet." />
  } else {
    body = (
      <ul className="ut-help__list">
        {list.map((c) => (
          <li key={(c.email ?? '') + c.name} className="ut-help__row">
            <Avatar name={c.name} size={40} />
            <span className="ut-help__who">
              <span className="ut-help__name">{c.name}</span>
              {c.role && <span className="ut-help__role">{c.role}</span>}
              {c.email && (
                <a className="ut-help__mail" href={`mailto:${c.email}`}>
                  <ShellIcon name="mail" size={14} />{c.email}
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <SidePanel open={open} onClose={onClose} title="Help & support" sub="People in your workspace who can help you" width={420} closeLabel="Close panel">
      <p className="ut-help__intro">For access, sign-in or anything about how your workspace is set up, write to one of the people who run it.</p>
      {body}
    </SidePanel>
  )
}
