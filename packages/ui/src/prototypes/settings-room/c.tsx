// Scrappy, C: the panel stays, wider: the two switches on top, then every section in one scroll, with an index beside it that follows.
import { useEffect, useRef, useState } from 'react'

import { ControlCenter, IconButton } from '../../index'
import { SectionNav, SectionPanel } from './frame'
import { useModels } from './models'
import { QuickToggles, SECTIONS, type SectionId } from './sections'

import { type SettingsPanelProps, text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

export function DirectionC({ start, open, onOpenChange, glance }: SettingsPanelProps) {
  const m = useModels(start, open, glance)
  const scroller = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<SectionId>('agents')
  // The index follows the scroll: the section whose head has passed the top last.
  useEffect(() => {
    const el = scroller.current
    if (!open || el === null) return
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 24
      let seen: SectionId = 'agents'
      for (const section of SECTIONS) {
        const head = el.querySelector(`#section-${section.id}`)
        if (head !== null && head.getBoundingClientRect().top <= top) seen = section.id
      }
      // At the very end, the last section, however short.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) seen = SECTIONS.at(-1)?.id ?? seen
      setAt(seen)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  })
  const go = (id: SectionId) => {
    const el = scroller.current
    const head = el?.querySelector(`#section-${id}`)
    if (el === null || el === undefined || !(head instanceof HTMLElement)) return
    el.scrollTo({ top: head.offsetTop - 2, behavior: 'smooth' })
  }
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      width={940}
      holding={m.accounts.signingIn !== null}
      text={{ label: text.title }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ width: 'calc(50% + 5px)' }}>
          <QuickToggles m={m} onOpen={go} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 14, height: 'calc(100vh - 210px)' }}>
          <div style={{ overflowY: 'auto' }}>
            <SectionNav current={at} onPick={go} label="Sections" />
          </div>
          <div ref={scroller} style={{ position: 'relative', overflowY: 'auto', display: 'grid', gap: 12, alignContent: 'start' }}>
            {SECTIONS.map((section) => (
              <SectionPanel key={section.id} id={section.id} m={m} wide headingLevel={3} />
            ))}
          </div>
        </div>
      </div>
    </ControlCenter>
  )
}
