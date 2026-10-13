import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'
import './proto.css'

import { createRoot } from 'react-dom/client'

import { Pages } from './pages'

/* Which page this is, as its body says. */
const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<Pages page={document.body.dataset.page ?? 'index'} />)
