import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@charrette/ui/styles.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

const el = document.getElementById('app')
if (!el) throw new Error('Missing #app')
createRoot(el).render(
  <StrictMode>
    <App pathname={window.location.pathname} />
  </StrictMode>,
)
