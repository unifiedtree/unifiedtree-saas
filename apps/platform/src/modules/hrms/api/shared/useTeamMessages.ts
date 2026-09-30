// "Message team": a manager posts a short message to their own team.
//
// Contract C0 · BW-12 · owner P-TEAM (migration V143_55: hrms.team_messages,
// hrms.team_message_recipients; permission hrms.team.message)
//   POST /v1/team/messages  { body }          → TeamMessage (with recipientCount)
//        Permission: @perm.check('hrms.team.message') (OWNER, SUPER_ADMIN,
//        DEPT_MANAGER, MANAGER). Recipients are only the sender's
//        TeamEmployeeScope; each is told in the app and on the phone
//        (TEAM_MESSAGE). Body 1–500 characters. Audited.
//   GET  /v1/team/messages/mine?days=30       → TeamMessage[]  (messages sent TO the caller, newest first)
//   GET  /v1/team/messages/sent               → TeamMessage[]  (messages the caller sent, newest first)
//        Permission: isAuthenticated(); the caller's own rows only.
//   Not available: 404 until P-TEAM ships it; 503 FEATURE_NOT_READY while the
//   tables are missing (hide "Message team" and the messages in Around you).
// Used by: P-TEAM (the message panel), P-HOME (the Message team tile; team
//   messages in the team's "Around you").
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { SHARED_KEYS, type PostTeamMessageRequest, type TeamMessage } from './contracts'
import {
  asAvailable, defaultApi, useAvailableMutation, useAvailableQuery,
  type ApiFetch, type SharedMutationOptions, type SharedQueryOptions,
} from './available'

export const TEAM_MESSAGES_PATH = '/v1/team/messages'
export const TEAM_MESSAGE_MAX_LENGTH = 500

export function teamMessagesToMeQuery(days = 30, api: ApiFetch = defaultApi): SharedQueryOptions<TeamMessage[]> {
  return {
    queryKey: [...SHARED_KEYS.teamMessages, 'mine', days],
    queryFn: () => asAvailable(() => api<TeamMessage[]>(`${TEAM_MESSAGES_PATH}/mine?days=${days}`)),
  }
}

export function sentTeamMessagesQuery(api: ApiFetch = defaultApi): SharedQueryOptions<TeamMessage[]> {
  return {
    queryKey: [...SHARED_KEYS.teamMessages, 'sent'],
    queryFn: () => asAvailable(() => api<TeamMessage[]>(`${TEAM_MESSAGES_PATH}/sent`)),
  }
}

/** Messages sent to the signed-in person in the last `days` days (Around you). */
export function useTeamMessages(days = 30, opts?: { enabled?: boolean }) {
  return useAvailableQuery<TeamMessage[]>({ ...teamMessagesToMeQuery(days), enabled: opts?.enabled ?? true })
}

/** Messages the signed-in person sent. */
export function useSentTeamMessages(opts?: { enabled?: boolean }) {
  return useAvailableQuery<TeamMessage[]>({ ...sentTeamMessagesQuery(), enabled: opts?.enabled ?? true })
}

export function postTeamMessageMutation(
  qc: QueryClient,
  api: ApiFetch = defaultApi,
): SharedMutationOptions<TeamMessage, PostTeamMessageRequest> {
  return {
    mutationFn: (body) =>
      asAvailable(() => api<TeamMessage>(TEAM_MESSAGES_PATH, { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: (result) => (result.available ? qc.invalidateQueries({ queryKey: SHARED_KEYS.teamMessages }) : undefined),
  }
}

export function usePostTeamMessage() {
  const qc = useQueryClient()
  return useAvailableMutation(postTeamMessageMutation(qc))
}
