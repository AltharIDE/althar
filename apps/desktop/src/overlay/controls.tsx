import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline'
import { createRoot } from 'react-dom/client'

import '../../../../packages/ui/src/styles/base.css'
import { BoardsControls } from '../../../../packages/ui/src/thread/Canvas/BoardsControls'
import type { GroundChange, GroundPage, GroundState } from './ground'

/*
 * A canvas of boards' controls (ADR-104), floating over its boards: the
 * kit's own, drawn by the ground in the canvas's document, since nothing of
 * Althar's window can be drawn over the canvas's view. They change the
 * ground as its keys do; the main process hears the change with the rest of
 * its news. Their styles are the kit's, which the ground's script puts in
 * the page as it runs, over the canvas's tokens (light or dark as the
 * system's scheme is); their type is the kit's too.
 */

export interface Controls {
  /** Draws them as the ground stands now. */
  readonly show: (pages: ReadonlyArray<GroundPage>, state: GroundState) => void
  /** Whether a key is theirs: every key in a menu of theirs, and those that press or move between them where one has the keyboard. */
  readonly owns: (event: KeyboardEvent) => boolean
}

/** The kit's type, in the canvas's document, where the window's fonts don't reach. */
const withType = () => {
  if ([...document.fonts].some((face) => face.family === 'Inter Variable')) return
  const face = new FontFace('Inter Variable', `url(${inter}) format('woff2')`, { weight: '100 900', style: 'normal' })
  document.fonts.add(face)
  void face.load().catch(() => undefined)
}

/** The keys a control under the keyboard answers itself. */
const PRESSING = new Set([' ', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

export const controlsIn = (layer: HTMLElement, set: (change: GroundChange) => void): Controls => {
  withType()
  const root = createRoot(layer)
  // A control pressed with the pointer gives the keyboard back to the boards, so V, the arrows and Space are theirs again;
  // one whose menu it opened keeps it, for the menu.
  layer.addEventListener('pointerup', () => {
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement && layer.contains(active) && active.getAttribute('aria-expanded') !== 'true') active.blur()
    })
  })
  return {
    show: (pages, state) =>
      root.render(
        <BoardsControls
          pages={pages}
          view={state.view}
          page={state.page}
          board={state.board}
          zoom={state.zoom}
          tool={state.tool}
          onView={(view) => set({ view })}
          // A page picked shows every board of it.
          onPage={(page) => set({ page, view: 'every' })}
          onStep={(step) => set({ step })}
          onZoom={(zoom) => set({ zoom })}
          onTool={(tool) => set({ tool })}
        />,
      ),
    owns: (event) => {
      const target = event.target
      if (!(target instanceof Element)) return false
      if (target.closest('[role="menu"]') !== null) return true
      return layer.contains(target) && PRESSING.has(event.key)
    },
  }
}
