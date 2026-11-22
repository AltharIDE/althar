import { useSyncExternalStore } from 'react'

import { LinkButton, type SetupWay } from '@althar/ui'

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

/** What a welcome picked on its way in: the New project page opens on it. */
export interface Intent {
  readonly way?: SetupWay
  /** A repository's id, to clone. */
  readonly repo?: string
  /** What was typed or pasted to find it. */
  readonly query?: string
  /** A folder found on the home. */
  readonly folder?: string
  /** A folder typed by its path on the home. */
  readonly path?: string
  /** A new repository's name. */
  readonly fresh?: string
}
let intent: Intent | null = null
/** What the welcome picked, read as the page's choice starts; anything else that opens the page starts it empty. */
export const intentNow = () => intent

const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))

/**
 * Goes from a welcome to the New project page, with what it picked. Where
 * `door` is given (what was pressed), it grows into the page: the page
 * arrives from where the press was, as the view's transition draws it.
 */
export const enter = (next: Intent = {}, door?: HTMLElement | null) => {
  const go = () => {
    startNew()
    intent = next
  }
  const view = (document as Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } })
    .startViewTransition
  if (view === undefined || lab.get().d === 'b' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return go()
  if (door) door.style.viewTransitionName = 'lab-door'
  const transition = view.call(document, async () => {
    if (door) door.style.viewTransitionName = ''
    go()
    // The page is drawn a frame or two after the route changes; until it is, the old view holds still.
    for (let i = 0; i < 20 && document.querySelector('[data-lab-page]') === null; i++) await frame()
    const page = document.querySelector<HTMLElement>('[data-lab-page]')
    if (page !== null && door) page.style.viewTransitionName = 'lab-door'
  })
  void transition.finished.finally(() => {
    const page = document.querySelector<HTMLElement>('[data-lab-page]')
    if (page !== null) page.style.viewTransitionName = ''
  })
}

/** Starts a new project the way the direction does. */
export const startNew = (files?: ReadonlyArray<File>, fallback?: (files?: ReadonlyArray<File>) => void) => {
  intent = null
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
