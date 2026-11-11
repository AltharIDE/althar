import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Pathname } from '../../lib/pathname'
import { Proto } from '../Proto'

/* The prototype on its own, for a page with no server behind it (vite.config.ts beside this). */
const el = document.getElementById('app')
if (!el) throw new Error('Missing #app')
createRoot(el).render(
  <StrictMode>
    <Pathname value="/">
      <Proto />
    </Pathname>
  </StrictMode>,
)
