// Mounts one scenario (?case=<name>) for the overlay-kit browser tests; see overlays.test.ts.
// StrictMode, like the app, so effects that run twice in development are covered too.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/globals.css'
import { SCENARIOS } from './scenarios'

const name = new URLSearchParams(window.location.search).get('case') || ''
const Scenario = SCENARIOS[name]
window.__log = []
createRoot(document.getElementById('root')!).render(<StrictMode>{Scenario ? <Scenario /> : <p>Unknown case “{name}”.</p>}</StrictMode>)
requestAnimationFrame(() => { document.body.dataset.ready = '1' })
