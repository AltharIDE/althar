import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'
import './proto.css'

import { createRoot } from 'react-dom/client'

import { Screen } from './screens'
import { Pages } from './pages'

/* Which page this is: one window (screen.html, by its query), or a page of them. */
const page = document.body.dataset.page ?? 'index'
const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(page === 'screen' ? <Screen query={new URLSearchParams(location.search)} /> : <Pages page={page} />)
