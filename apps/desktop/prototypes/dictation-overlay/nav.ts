// Throwaway: the app's router, for the overlays and the switcher, which live outside its screens.
import type { makeRouter } from '../../src/renderer/router'

let router: ReturnType<typeof makeRouter> | null = null

export const keepRouter = (made: ReturnType<typeof makeRouter>) => {
  router = made
}

/** Goes to an address the app knows: /, /projects/p1?room=board, /threads/th-scroll. */
export const navigate = (path: string) => {
  router?.history.push(path)
}
