import type { AnyRouter } from '@tanstack/react-router'

import type { Section } from '../../src/renderer/features/settings/sections'
import { ALTHAR } from './data'
import { lab } from './state'

/*
 * Where the lab's parts send the window: its own What's new page, which the
 * app's routes don't know (main.tsx adds it), and the places a highlight's
 * way in opens. Through the lab's router, set as the page starts.
 */

let router: AnyRouter | null = null
export const setRouter = (one: AnyRouter) => {
  router = one
}

const to = (path: string) => void router?.history.push(path)

export const WHATS_NEW = '/whats-new'

export const go = {
  /** What's new: its tab, or C's home with the notes in place. */
  whatsNew: () => {
    const { d } = lab.get()
    if (d === 'c') {
      lab.set({ homeNotes: true, unseen: false })
      return to('/')
    }
    lab.set({ tab: true, unseen: false })
    to(WHATS_NEW)
  },
  home: () => to('/'),
  project: (projectId = ALTHAR) => to(`/projects/${projectId}`),
  settings: (section: Section) => to(`/settings/${section}`),
}
