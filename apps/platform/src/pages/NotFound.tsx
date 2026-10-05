import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import { useHome } from '@/design/shell/useHome'
import './notFound.css'

/**
 * Any address no page answers to (the catch-all route, inside the shell): says so, shows the
 * address, and offers Home and Back. Before, these links fell through to Home without a word.
 * Mobile app twin: app/+not-found.tsx.
 */
export function NotFound() {
  const location = useLocation()
  const navigate = useNavigate()
  const home = useHome()
  const address = `${location.pathname}${location.search}`
  // 'default' is the first page of this visit (a pasted or bookmarked link): there is nothing to go back to.
  const canGoBack = location.key !== 'default'
  const homePath = home.ready && home.kind !== 'none' ? home.path : '/'

  return (
    <div className="ut-notfound">
      <section className="ut-notfound__card" aria-labelledby="ut-notfound-title" data-testid="not-found">
        <span className="ut-notfound__icon" aria-hidden="true">{dashIcon('search', 26)}</span>
        <h1 id="ut-notfound-title" className="ut-notfound__title">Page not found</h1>
        <p className="ut-notfound__text">This link doesn’t open a page. It may be old, or typed wrongly.</p>
        <code className="ut-notfound__path" title={address}>{address}</code>
        <div className="ut-notfound__actions">
          <Button variant="primary" size={40} icon="home" onClick={() => navigate(homePath, { replace: true })}>Go to Home</Button>
          {canGoBack && <Button variant="secondary" size={40} icon="chevronLeft" onClick={() => navigate(-1)}>Back</Button>}
        </div>
      </section>
    </div>
  )
}
