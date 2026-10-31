import '@fontsource-variable/figtree'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { setUpInstall } from './lib/install'

setUpInstall()

// Pages load their code on first visit. A tab opened before a deploy asks for files the new
// deploy no longer has; reloading picks up the new ones. Once a minute at most, so a real
// outage shows the page's error instead of reloading forever.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('metaproof.chunkReload') || 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('metaproof.chunkReload', String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
