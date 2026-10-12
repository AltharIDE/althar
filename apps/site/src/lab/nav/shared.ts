import { type MouseEvent, useEffect, useRef, useState } from 'react'

import coordinatorDark from '../../../../../brand/export/crew/coordinator-dark.svg?url'
import coordinator from '../../../../../brand/export/crew/coordinator.svg?url'
import leadDark from '../../../../../brand/export/crew/lead-dark.svg?url'
import lead from '../../../../../brand/export/crew/lead.svg?url'
import projectDark from '../../../../../brand/export/crew/project-dark.svg?url'
import project from '../../../../../brand/export/crew/project.svg?url'
import stepDark from '../../../../../brand/export/crew/step-dark.svg?url'
import step from '../../../../../brand/export/crew/step.svg?url'
import taskDark from '../../../../../brand/export/crew/task-dark.svg?url'
import task from '../../../../../brand/export/crew/task.svg?url'

/*
 * What every nav concept shares: the live nav's pages, each with the crew
 * figure that stands for it, and the phone menu's opening and closing.
 */

/** A crew figure from the brand pack (brand/export/crew): on paper, and in its pool of light for dark grounds. */
export interface Figure {
  light: string
  dark: string
}

export interface Page {
  href: string
  name: string
  /** Its number, as the Masthead numbers the parts of a page. */
  no: string
  crew: Figure
}

/** The live nav's pages, in its order: the project is the home, the coordinator brings the shifts, the lead argues the thesis, a task is the docs. */
export const PAGES: readonly Page[] = [
  { href: '/', name: 'Home', no: '01', crew: { light: project, dark: projectDark } },
  { href: '/shifts', name: 'Shifts', no: '02', crew: { light: coordinator, dark: coordinatorDark } },
  { href: '/thesis', name: 'Thesis', no: '03', crew: { light: lead, dark: leadDark } },
  { href: '/docs', name: 'Docs', no: '04', crew: { light: task, dark: taskDark } },
]

/** The reviewer, who reads the code: GitHub's figure. */
export const REVIEWER: Figure = { light: step, dark: stepDark }

export interface NavProps {
  /** The page being read. */
  here: string
  /** Called when a page is chosen, so the lab can stay where it is and move the nav instead. */
  onGo?: (href: string, event: MouseEvent) => void
}

/** Whether the page has scrolled past `past` px. */
export function useScrolled(past = 40) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > past)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [past])
  return scrolled
}

/**
 * The phone menu: open and closed by its button, closed again by Escape (focus
 * back on the button), by choosing a page, or by the window growing past a phone's.
 */
export function useMenu() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    // Past the phone's width the menu's button is gone, so the menu closes rather than stay open with no way to close it.
    const wide = window.matchMedia('(min-width: 901px)')
    const onWide = () => {
      if (wide.matches) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      window.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
    }
  }, [open])
  return { open, button, toggle: () => setOpen((o) => !o), close: () => setOpen(false) }
}
