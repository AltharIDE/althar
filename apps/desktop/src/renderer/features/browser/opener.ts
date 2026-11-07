import { createContext, useContext, useMemo } from 'react'

import { useServices } from '../../data/services'
import { usePreferences } from '../../shared/usePreferences'
import { pages } from './pages'

/*
 * Where a web address from a conversation opens (ADR-099): a run's address
 * always beside the conversation it belongs to, a link in the thread beside
 * it too, or in the person's browser where they keep links there
 * (Settings › Browser). What isn't in a conversation opens in the person's
 * browser, as before.
 */

export interface PageOpener {
  /** A run's address: beside the conversation, whatever the person keeps for links. */
  readonly run: (address: string) => void
  /** A link from the thread: beside the conversation, or in the person's browser, as they keep links. */
  readonly link: (address: string) => void
  /** Where a link from the thread opens. */
  readonly links: 'beside' | 'outside'
}

/* The person's browser, through the main process, which opens only web pages there. */
const outside = (address: string) => void window.open(address, '_blank')

const OUTSIDE: PageOpener = { run: outside, link: outside, links: 'outside' }

const Opener = createContext<PageOpener>(OUTSIDE)

/** The conversation's opener, for the runs' cards, pills and lists inside it. */
export const PageOpenerProvider = Opener.Provider

/** Where an address from the conversation on screen opens. */
export const usePageOpener = (): PageOpener => useContext(Opener)

/**
 * Opens pages beside an owner's conversation: the task's or the project's.
 * `onShow` puts the conversation on screen, as a task's other faces or a
 * project's board step aside for it.
 */
export const useOpener = (owner: string | null, onShow?: () => void): PageOpener => {
  const browser = useServices().host.pages
  const links = usePreferences().preferences.browserLinks
  return useMemo(() => {
    if (owner === null || browser === undefined) return OUTSIDE
    const beside = (address: string) => {
      pages.place(owner, 'beside')
      onShow?.()
      void browser.open(owner, address).then((opened) => {
        if (opened !== null) pages.known(opened)
      })
    }
    return { run: beside, link: links === 'outside' ? outside : beside, links }
  }, [owner, browser, links, onShow])
}
