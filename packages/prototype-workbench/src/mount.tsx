import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import type { Prototype } from './prototype'
import { Workbench } from './Workbench'

/** Draws a prototype's workbench on the page; what it returns draws a new version of the prototype in its place, keeping what is shown. */
export function mount<F>(prototype: Prototype<F>, element = document.getElementById('root')) {
  if (element === null) throw new Error('The workbench page has no #root to draw in.')
  const root = createRoot(element)
  const draw = <G,>(next: Prototype<G>) =>
    root.render(
      <StrictMode>
        <Workbench prototype={next} />
      </StrictMode>,
    )
  draw(prototype)
  return draw
}
