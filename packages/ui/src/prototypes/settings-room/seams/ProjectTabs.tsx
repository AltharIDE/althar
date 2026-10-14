// Scrappy, the third round: the kit's ProjectTabs, drawn by its own styles, with a Settings tab beside Home while Settings is open.
// A copy of packages/ui/src/chrome/ProjectTabs/ProjectTabs.tsx; what changed is marked "Settings".
import { useEffect, useRef, useState } from 'react'

import { ChromeButton } from '../../../chrome/ChromeButton/ChromeButton'
import s from '../../../chrome/ProjectTabs/ProjectTabs.module.css'
import { type ProjectTabsProps, type ProjectTabsText, projectTabsText } from '../../../chrome/ProjectTabs/ProjectTabs'
import { WindowButtons } from '../../../chrome/WindowButtons/WindowButtons'
import { Icon } from '../../../foundations/Icon/Icon'
import { Logo } from '../../../foundations/Logo/Logo'
import { ProjectMark } from '../../../foundations/ProjectMark/ProjectMark'
import { cx } from '../../../lib/cx'
import { IconButton } from '../../../primitives/IconButton/IconButton'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../primitives/Menu/Menu'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { isRound3, useDirection } from '../state'
import { settingsTab, useSettingsTab } from '../tab'

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
  current: route,
  onSelect: select,
  onClose,
  yours = 0,
  others = [],
  onOpen,
  onNewProject,
  end,
  lights = 'space',
  onCloseWindow,
  onMinimize,
  onToggleMaximize,
  maximized = false,
  className,
  text,
  ...rest
}: ProjectTabsProps) {
  const t = { ...projectTabsText, ...text }
  // Settings: its tab, in the third round only; while it has the window, no other tab does.
  const shown = isRound3(useDirection())
  const settings = useSettingsTab()
  const onSettings = shown && settings.open && settings.current
  const current = onSettings ? undefined : route
  const onSelect = (id: string | null) => {
    settingsTab.leave()
    select(id)
  }
  const offered = onOpen ? others : []
  const list = useRef<HTMLUListElement>(null)
  const [more, setMore] = useState({ before: false, after: false })
  useEffect(() => {
    const element = list.current
    if (element === null) return
    const measure = () => {
      const before = element.scrollLeft > 1
      const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setMore((was) => (was.before === before && was.after === after ? was : { before, after }))
    }
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
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.parentElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current, tabs.length])
  return (
    <header className={cx(s.strip, className)} data-drag="" {...rest}>
      {lights === 'drawn' ? (
        <WindowButtons
          onClose={onCloseWindow}
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          maximized={maximized}
          text={{ close: t.closeWindow, minimize: t.minimizeWindow, maximize: t.maximizeWindow, restore: t.restoreWindow }}
        />
      ) : (
        lights !== 'none' && (
          <span className={s.lights} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )
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
          {/* Settings: beside Home, as the app's and not a project's; closed like a project's tab. */}
          {shown && settings.open && (
            <li className={cx(s.tab, s.project, onSettings && s.current)}>
              <button
                type="button"
                className={s.select}
                aria-current={onSettings ? 'page' : undefined}
                onClick={() => settingsTab.set({ current: true })}
              >
                <Icon name="gear" size={15} className={s.logo} />
                <span className={s.name}>Settings</span>
              </button>
              <IconButton icon="close" label="Close Settings" size="small" className={s.close} onClick={settingsTab.close} />
            </li>
          )}
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
        {offered.length === 0 && onNewProject && (
          <ChromeButton icon="plus" label={t.newProject} kbd={t.newProjectKbd} compact className={s.plus} onClick={onNewProject} />
        )}
        {offered.length > 0 && (
          <Menu label={t.open} align="start" width={260} trigger={<ChromeButton icon="plus" label={t.open} compact className={s.plus} />}>
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
            {onNewProject && <MenuSeparator />}
            {onNewProject && (
              <MenuItem icon="plus" kbd={t.newProjectKbd} onSelect={onNewProject}>
                {t.newProject}
              </MenuItem>
            )}
          </Menu>
        )}
      </nav>
      {end !== undefined && <div className={s.end}>{end}</div>}
    </header>
  )
}
