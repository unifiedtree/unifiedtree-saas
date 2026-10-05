// The bell's Messages tab: Team messages sent to the signed-in person (GET /v1/team/messages/mine,
// useTeamMessages), newest first: who sent it, when, the team it went to and the whole text.
// Mobile app twin: components/alerts/TeamMessagesView.tsx.
import { Avatar, EmptyState, ErrorState, SkeletonList } from '@/design/kit/display'
import { timeAgo } from '@/core/notifications/notificationRoutes'
import type { TeamMessage } from '@/modules/hrms/api/shared/contracts'

/** How far back the Messages tab reads (the app's TEAM_MESSAGE_DAYS). */
export const TEAM_MESSAGE_DAYS = 30

export interface TeamMessagesListProps {
  messages: readonly TeamMessage[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  retrying?: boolean
  now?: Date
}

export function TeamMessagesList({ messages, loading, error, onRetry, retrying, now = new Date() }: TeamMessagesListProps) {
  if (loading && !messages) return <div className="ut-bellpop__state"><SkeletonList rows={3} pill={false} label="Loading team messages" /></div>
  if (error && !messages?.length) {
    return <div className="ut-bellpop__state"><ErrorState title="Couldn’t load your team messages" error={error} onRetry={onRetry} retrying={retrying} /></div>
  }
  if (!messages?.length) {
    return (
      <div className="ut-bellpop__state">
        <EmptyState icon="megaphone" title="No team messages" hint={`When your manager messages the team, it shows up here for ${TEAM_MESSAGE_DAYS} days.`} />
      </div>
    )
  }
  return (
    <ul className="ut-bellpop__list" data-testid="team-message-list">
      {messages.map((m) => (
        <li key={m.id} className="ut-bellpop__msg">
          <Avatar name={m.senderName} size={34} tone="pale" />
          <span className="ut-bellpop__text">
            <span className="ut-bellpop__msghead">
              <span className="ut-bellpop__title">{m.senderName}</span>
              <span className="ut-bellpop__meta">{timeAgo(m.createdAt, now)}</span>
            </span>
            {m.teamLabel && <span className="ut-bellpop__meta">To {m.teamLabel}</span>}
            <span className="ut-bellpop__msgbody">{m.body}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
