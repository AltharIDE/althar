import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'

import { App } from './App'

const app = (
  <StrictMode>
    <App pathname={window.location.pathname} />
  </StrictMode>
)
const el = document.getElementById('app')
if (!el) throw new Error('Missing #app')
/* Built pages arrive prerendered (scripts/prerender.ts); the dev server, and the enterprise page, send an empty shell. */
if (el.hasChildNodes()) hydrateRoot(el, app)
else createRoot(el).render(app)
