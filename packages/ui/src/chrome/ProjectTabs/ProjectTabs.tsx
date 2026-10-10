import { useEffect, useRef, useState } from 'react'

import { Logo } from '../../foundations/Logo/Logo'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import s from './ProjectTabs.module.css'

/*
 * The top of the window: a tab for the home, then one for each project the
 * person keeps open, so going from one project to another is one press.
 * Each project's tab carries its mark, with the running arc while work runs
 * there, and a violet dot after its name while anything there waits on you; the home's has the dot while anything waits in any project. How many is
 * read out, not shown. The tab that has the window
 * joins the screen's own bar below it. A project's tab closes from its ×,
 * and the + opens one of the other projects, or a folder as a new one.
 * However many are open, the home's tab stays put; the others give way
 * together, down to their marks, and past that they scroll, by wheel too,
 * fading at the side where more are, with a menu of them all. On
 * macOS the system draws the traffic lights over its start, so it keeps
 * their space, as the TitleBar does when it is the top; where the system
 * draws none, the same three dots are the window's own buttons (close,
 * minimize, maximize), and the app behind them does what they ask.
 */

/** A project as its tab shows it. */
export interface ProjectTab {
  id: string
  name: string
  /** What its mark is drawn from: what stays when it is renamed, such as its id. */
  seed: string
  ink: ProjectInk
  /** Work runs there. */
  running: boolean
  /** Calls waiting on you there. */
  yours: number
}

export interface ProjectTabsText {
  label: string
  home: string
  close: (name: string) => string
  /** Read after a tab's count. */
  yours: (n: number) => string
  running: string
  open: string
  others: string
  openFolder: string
  /** The menu of every open project, when more are open than fit. */
  all: string
  /** The window's own buttons, where the system draws none. */
  closeWindow: string
  minimizeWindow: string
  maximizeWindow: string
}

export const projectTabsText: ProjectTabsText = {
  label: 'Projects',
  home: 'Home',
  close: (name) => `Close ${name}`,
  yours: (n) => (n === 1 ? '1 call waits on you' : `${n} calls wait on you`),
  running: 'work running',
  open: 'Open a project',
  others: 'Other projects',
  openFolder: 'Open a folder…',
  all: 'All open projects',
  closeWindow: 'Close the window',
  minimizeWindow: 'Minimize the window',
  maximizeWindow: 'Maximize the window',
}

export type ProjectTabsProps = RootProps<
  'header',
  {
    tabs: readonly ProjectTab[]
    /** The tab that has the window: a project's id, or null for the home. */
    current: string | null
    /** A tab was pressed: a project's id, or null for the home. */
    onSelect: (id: string | null) => void
    onClose: (id: string) => void
    /** Calls waiting on you across every project, on the home's tab. */
    yours?: number
    /** The projects without a tab, which the + offers. */
    others?: readonly ProjectTab[]
    /** Gives one of the others a tab. Without it, the + offers none of them. */
    onOpen?: (id: string) => void
    /** Opens a folder as a new project. Without it or any others to open, there is no +. */
    onOpenFolder?: () => void
    /** space: leave room for the system's lights. drawn: draw the window's own buttons. none: no room. */
    lights?: 'space' | 'drawn' | 'none'
    /** The window's own buttons, where the system draws none (lights='drawn'). */
    onCloseWindow?: () => void
    onMinimize?: () => void
    /** Maximizes, or restores what it maximized. */
    onToggleMaximize?: () => void
    text?: Partial<ProjectTabsText>
  }
>

/** Something waits on you: a violet dot beside a tab's name, and how many read out after it. */
function Yours({ n, text }: { n: number; text: ProjectTabsText }) {
  if (n === 0) return null
  return (
    <>
      <span className={s.yours} aria-hidden="true" />
      <VisuallyHidden>, {text.yours(n)}</VisuallyHidden>
    </>
  )
}

export function ProjectTabs({
  tabs,
  current,
  onSelect,
  onClose,
  yours = 0,
  others = [],
  onOpen,
  onOpenFolder,
  lights = 'space',
  onCloseWindow,
  onMinimize,
  onToggleMaximize,
  className,
  text,
  ...rest
}: ProjectTabsProps) {
  const t = { ...projectTabsText, ...text }
  const offered = onOpen ? others : []
  const list = useRef<HTMLUListElement>(null)
  // Where the projects' tabs scroll to, when more are open than fit: more before, more after.
  const [more, setMore] = useState({ before: false, after: false })
  useEffect(() => {
    const element = list.current
    if (element === null) return
    const measure = () => {
      const before = element.scrollLeft > 1
      const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setMore((was) => (was.before === before && was.after === after ? was : { before, after }))
    }
    // A wheel that turns up and down moves them across, as a trackpad does.
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) return
      element.scrollLeft += event.deltaY
      event.preventDefault()
    }
    measure()
    element.addEventListener('scroll', measure, { passive: true })
    element.addEventListener('wheel', wheel, { passive: false })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resized?.observe(element)
    return () => {
      element.removeEventListener('scroll', measure)
      element.removeEventListener('wheel', wheel)
      resized?.disconnect()
    }
  }, [tabs.length])
  // The tab with the window is kept in sight.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.parentElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current, tabs.length])
  return (
    <header className={cx(s.strip, className)} data-drag="" {...rest}>
      {lights !== 'none' && (
        <span className={s.lights} aria-hidden={lights === 'space' || undefined}>
          {lights === 'drawn' ? (
            <>
              <button type="button" aria-label={t.closeWindow} onClick={onCloseWindow} />
              <button type="button" aria-label={t.minimizeWindow} onClick={onMinimize} />
              <button type="button" aria-label={t.maximizeWindow} onClick={onToggleMaximize} />
            </>
          ) : (
            <>
              <i />
              <i />
              <i />
            </>
          )}
        </span>
      )}
      <nav className={s.nav} aria-label={t.label}>
        <ul className={s.pinned}>
          <li className={cx(s.tab, s.home, current === null && s.current)}>
            <button type="button" className={s.select} aria-current={current === null ? 'page' : undefined} onClick={() => onSelect(null)}>
              <Logo size={15} className={s.logo} />
              <span className={s.name}>{t.home}</span>
              <Yours n={yours} text={t} />
            </button>
          </li>
        </ul>
        <ul className={cx(s.tabs, more.before && s.moreBefore, more.after && s.moreAfter)} ref={list}>
          {tabs.map((tab) => (
            <li key={tab.id} className={cx(s.tab, s.project, tab.id === current && s.current)}>
              <button
                type="button"
                className={s.select}
                aria-current={tab.id === current ? 'page' : undefined}
                onClick={() => onSelect(tab.id)}
              >
                {/* The dot after its name says what waits; the mark says only that work runs. */}
                <ProjectMark seed={tab.seed} ink={tab.ink} size={15} running={tab.running} className={s.mark} />
                <span className={s.name}>{tab.name}</span>
                {tab.running && <VisuallyHidden>, {t.running}</VisuallyHidden>}
                <Yours n={tab.yours} text={t} />
              </button>
              <IconButton icon="close" label={t.close(tab.name)} size="small" className={s.close} onClick={() => onClose(tab.id)} />
            </li>
          ))}
        </ul>
        {(more.before || more.after) && (
          <Menu label={t.all} align="end" width={260} trigger={<ChromeButton icon="list" label={t.all} compact className={s.plus} />}>
            {tabs.map((tab) => (
              <MenuItem
                key={tab.id}
                lead={<ProjectMark seed={tab.seed} ink={tab.ink} size={15} running={tab.running} />}
                hint={tab.yours > 0 ? <Yours n={tab.yours} text={t} /> : undefined}
                onSelect={() => onSelect(tab.id)}
              >
                {tab.name}
              </MenuItem>
            ))}
          </Menu>
        )}
        {(offered.length > 0 || onOpenFolder) && (
          <Menu label={t.open} align="start" width={260} trigger={<ChromeButton icon="plus" label={t.open} compact className={s.plus} />}>
            {offered.length > 0 && (
              <MenuGroup label={t.others}>
                {offered.map((other) => (
                  <MenuItem
                    key={other.id}
                    lead={<ProjectMark seed={other.seed} ink={other.ink} size={15} running={other.running} />}
                    hint={other.yours > 0 ? <Yours n={other.yours} text={t} /> : undefined}
                    onSelect={() => onOpen?.(other.id)}
                  >
                    {other.name}
                  </MenuItem>
                ))}
              </MenuGroup>
            )}
            {offered.length > 0 && onOpenFolder && <MenuSeparator />}
            {onOpenFolder && (
              <MenuItem icon="folder" onSelect={onOpenFolder}>
                {t.openFolder}
              </MenuItem>
            )}
          </Menu>
        )}
      </nav>
    </header>
  )
}
