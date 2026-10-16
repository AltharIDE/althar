// C · One scrolling sheet: Settings opens a sheet beside the project, as a document opens beside a thread; every section one under another, its index held at the top.
import { useEffect, useRef, useState } from 'react'

import { Button, Heading, ProjectMark, Segmented, SidePanel, SidePanelTitle } from '../../../src/index'
import type { Things } from '../parts'
import css from '../parts.module.css'
import { useProto } from '../state'
import { ProjectCards } from './B'
import { SECTIONS, type Section, SectionBody, sectionText, yoursIn } from './sections'

const SHORT: Readonly<Record<Section, string>> = {
  general: 'General',
  connections: 'Connections',
  rules: 'Rules',
  running: 'Running',
  notes: 'Notes',
  remove: 'Remove',
}

/** The front's button: opens and closes the sheet. */
export function CButton({ open, onOpen }: { open: boolean; onOpen: (open: boolean) => void }) {
  return (
    <Button size="small" variant="quiet" icon="gear" aria-pressed={open} onClick={() => onOpen(!open)}>
      Settings
    </Button>
  )
}

export function C({ things, onClose }: { things: Things; onClose: () => void }) {
  const p = useProto()
  const scroll = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<Section>('general')
  const go = (section: Section, smooth = true) => {
    const element = scroll.current?.querySelector<HTMLElement>(`[data-section="${section}"]`)
    if (element === null || element === undefined || scroll.current === null) return
    scroll.current.scrollTo({ top: element.offsetTop - 52, behavior: smooth ? 'smooth' : 'auto' })
  }
  // The index follows the reading: the last section whose head has passed the top.
  useEffect(() => {
    const element = scroll.current
    if (element === null) return
    const onScroll = () => {
      const heads = [...element.querySelectorAll<HTMLElement>('[data-section]')]
      const passed = heads.filter((head) => head.offsetTop - 60 <= element.scrollTop)
      const last = passed.at(-1)?.dataset.section as Section | undefined
      setAt(element.scrollTop + element.clientHeight >= element.scrollHeight - 4 ? 'remove' : (last ?? 'general'))
    }
    element.addEventListener('scroll', onScroll)
    return () => element.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (p.showing === 'notes') requestAnimationFrame(() => go('notes', false))
  }, [p.showing])
  return (
    <div className={css.sheet}>
      <SidePanel
        label={`${things.name}’s settings`}
        head={
          <span className={css.who}>
            <ProjectMark seed={things.seed} ink={things.ink} size={20} />
            <SidePanelTitle>{things.name}’s settings</SidePanelTitle>
          </span>
        }
        onClose={onClose}
      >
        <div ref={scroll} className={css.sheetScroll}>
          <div className={css.index}>
            <Segmented<Section>
              label="Sections"
              value={at}
              onChange={(section) => go(section)}
              options={SECTIONS.map((id) => ({
                value: id,
                label: SHORT[id],
                ...(yoursIn(id, things) ? { dot: 'new' as const, dotLabel: 'needs you' } : {}),
              }))}
            />
          </div>
          <div className={css.sheetBody}>
            <ProjectCards things={things} side={false} onOpen={(section) => go(section)} />
            {SECTIONS.map((id) => (
              <section key={id} data-section={id} className={css.sheetSection}>
                <Heading level={2} className={css.sheetTitle}>
                  {sectionText[id].title}
                </Heading>
                <p className={css.quiet}>{sectionText[id].lede}</p>
                <SectionBody section={id} things={things} />
              </section>
            ))}
          </div>
        </div>
      </SidePanel>
    </div>
  )
}
