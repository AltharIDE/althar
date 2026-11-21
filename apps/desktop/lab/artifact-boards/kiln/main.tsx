import { createRoot } from 'react-dom/client'

import { Kiln } from './Kiln'

/* Kiln on its own (kiln.html): what a task's copy of the team's product serves, at the screen the address names. */
const root = document.getElementById('root')
if (root !== null) createRoot(root).render(<Kiln params={new URLSearchParams(window.location.search)} />)
