import type { AnyRouter } from '@tanstack/react-router'

import type { Section } from '../../src/renderer/features/settings/sections'
import { ALTHAR } from './data'
import { lab, type View } from './state'

/*
 * Where the lab's parts send the window: Althar's own page, which the app's
 * routes don't know (main.tsx adds it), and the places a highlight's way in
 * opens. Through the lab's router, set as the page starts.
 */

let router: AnyRouter | null = null
export const setRouter = (one: AnyRouter) => {
  router = one
}

const to = (path: string) => void router?.history.push(path)

export const WHATS_NEW = '/whats-new'

export const go = {
  /** Althar's page, on a view: opening it is looking at the update, so its tab's dot goes. */
  althar: (view: View = 'new') => {
    lab.set({ unseen: false, view })
    to(WHATS_NEW)
  },
  home: () => to('/'),
  project: (projectId = ALTHAR) => to(`/projects/${projectId}`),
  settings: (section: Section) => to(`/settings/${section}`),
}
