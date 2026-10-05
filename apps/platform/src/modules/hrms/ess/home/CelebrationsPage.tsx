// /me/celebrations: everyone to celebrate, from Home's Celebrations card ("See all"):
// Birthdays, Work anniversaries and Welcome aboard (who joined in the last 30 days). Today first,
// the ones that have gone by in the last week stay, faded. The app's /milestones shows the same.
// There's no "Send wishes" button: the backend has nothing that sends one person a message.
import { useNavigate } from 'react-router-dom'
import { Button, PageFrame, PageHeader, Section } from '@/design/kit/display'
import { istToday } from '@/design/dc/dates'
import { useCelebrations } from './homeApi'
import { sectionsOf } from './peopleModel'
import { CelebrationSectionCard } from './PeopleBlocks'
import './home.css'

export function CelebrationsPage() {
  const navigate = useNavigate()
  const q = useCelebrations(30)
  const today = q.data?.today ?? istToday()
  const sections = q.data ? sectionsOf(q.data, today) : []
  return (
    <PageFrame width="narrow" top={22} gap={16} label="Celebrations">
      <PageHeader title="Celebrations" sub="Birthdays, work anniversaries and new joiners in your company, from last week to a month ahead."
        actions={<Button variant="secondary" size={38} icon="chevronLeft" onClick={() => navigate('/me')}>Home</Button>} />
      {q.isLoading || q.error || q.notAvailable ? (
        <Section variant="panel" title="Celebrations" body="list" loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
          empty={q.notAvailable ? { title: 'Not switched on yet', hint: 'Celebrations show here once your workspace has them.', icon: 'calendar' } : undefined} />
      ) : (
        <div className="uh-cel-grid">
          {sections.map((s, i) => <CelebrationSectionCard key={s.key} section={s} today={today} index={i} />)}
        </div>
      )}
    </PageFrame>
  )
}
