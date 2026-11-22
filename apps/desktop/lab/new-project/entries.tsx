import { useSyncExternalStore } from 'react'

import { LinkButton } from '@althar/ui'

import type { Client } from '../../src/renderer/data/client'
import { draftsOf } from '../../src/renderer/features/newProject/draft'
import { homesUi } from '../../src/renderer/features/homes/useHomes'
import s from '../../src/renderer/features/homes/ManageHomes.module.css'
import type { makeRouter } from '../../src/renderer/router'
import { lab } from './state'
import { HOME } from './world'

/*
 * Where a new project starts, wherever it is asked for: the tab bar's + and
 * ⌘N, Manage homes, a home with no projects. Direction B opens its steps over
 * the window; the others open the New project tab, which is theirs.
 */

let wired: { router: ReturnType<typeof makeRouter>; client: Client } | null = null
export const wire = (router: ReturnType<typeof makeRouter>, client: Client) => {
  wired = { router, client }
}

/** B's steps, open over the window or not. */
let guideOpen = false
const guideListeners = new Set<() => void>()
export const guide = {
  open: () => {
    guideOpen = true
    guideListeners.forEach((listener) => listener())
  },
  close: () => {
    guideOpen = false
    guideListeners.forEach((listener) => listener())
  },
}
export const useGuide = () =>
  useSyncExternalStore(
    (listener) => {
      guideListeners.add(listener)
      return () => void guideListeners.delete(listener)
    },
    () => guideOpen,
  )

/** Starts a new project the way the direction does. */
export const startNew = (files?: ReadonlyArray<File>, fallback?: (files?: ReadonlyArray<File>) => void) => {
  homesUi.set({ dialog: null, menu: false })
  if (lab.get().d === 'b') return guide.open()
  if (fallback !== undefined) return fallback(files)
  if (wired === null) return
  draftsOf(wired.client).start()
  void wired.router.navigate({ to: '/new' })
}

/** The tab bar's + and ⌘N: the direction's new project, on any home. */
export const labNew = (fallback: (files?: ReadonlyArray<File>) => void) => (files?: ReadonlyArray<File>) => startNew(files, fallback)

/** A home with no projects, in Manage homes: said, with New project beside it. */
export function LabShelfEmpty({ local, onNew }: { local: boolean; onNew: () => void }) {
  // Only the home this window is on can start one here; another home's opens its window on it.
  const ours = local !== HOME.remote
  return (
    <p className={s.empty}>
      No projects yet.{' '}
      <LinkButton
        onClick={() => {
          if (ours) onNew()
          else lab.restart({ home: local ? 'mac' : 'runner' })
        }}
      >
        New project…
      </LinkButton>
    </p>
  )
}
