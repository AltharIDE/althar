// Scrappy: the real Althar site, as a run of it serves it: main's (?run=main) or the task's branch (?run=task), on the page ?path= names.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../../src/styles/global.css'
import '../../../../../apps/site/src/styles/base.css'

import { createRoot } from 'react-dom/client'

import { App } from '../../../../../apps/site/src/App'

const path = new URLSearchParams(window.location.search).get('path') ?? '/'
const el = document.getElementById('app')
if (!el) throw new Error('Missing #app')
createRoot(el).render(<App pathname={path} />)
