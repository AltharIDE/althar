import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/jetbrains-mono'
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
/* Built pages arrive prerendered; the dev server sends an empty shell. */
if (el.hasChildNodes()) hydrateRoot(el, app)
else createRoot(el).render(app)
