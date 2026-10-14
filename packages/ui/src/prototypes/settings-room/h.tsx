// Scrappy, H: G's quick panel, but All settings (or any glance) grows the same panel into the whole of settings, in place, and steps back.
import { useEffect, useState } from 'react'

import { ControlCenter, ControlDetail, IconButton, Panel } from '../../index'
import { SearchField, SectionNav, SectionPanel } from './frame'
import { useModels } from './models'
import { AtOnceSheet, Glances, QuickFoot, Toggles } from './quick'
import type { ProtoSettingsProps } from './seams/SettingsPanel'
import { Found, PROJECTS, type SectionId } from './sections'

import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

export function DirectionH({ start, open, onOpenChange, glance }: ProtoSettingsProps) {
  const m = useModels(start, open, glance)
  const [grown, setGrown] = useState<SectionId | null>(null)
  const [query, setQuery] = useState('')
  const grow = (id: SectionId) => {
    setQuery('')
    setGrown(id)
  }
  // Each time it opens, it opens small.
  const change = (next: boolean) => {
    if (!next) setGrown(null)
    onOpenChange(next)
  }
  // ⌘⇧, opens it grown, from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.code !== 'Comma') return
      event.preventDefault()
      setGrown('agents')
      onOpenChange(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={change}
      width={grown === null ? 440 : 1120}
      holding={grown !== null && m.accounts.signingIn !== null}
      onEscapeKeyDown={(event) => {
        // Escape clears the search, then steps back to the quick panel, before it closes.
        if (event.defaultPrevented || grown === null) return
        event.preventDefault()
        if (query !== '') setQuery('')
        else setGrown(null)
      }}
      text={{ label: text.title }}
    >
      {grown === null ? (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            <Toggles m={m} ids={['keepAwake', 'notify']} onOpen={grow} />
            <Glances m={m} onOpen={grow} />
            <AtOnceSheet m={m} />
          </div>
          <QuickFoot m={m} onAll={() => grow('agents')} />
        </>
      ) : (
        <ControlDetail
          title="All settings"
          onBack={() => setGrown(null)}
          text={{ back: 'Back to quick settings' }}
          aside={
            <div style={{ width: 280 }}>
              <SearchField value={query} onChange={setQuery} />
            </div>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 14, height: 'calc(100vh - 150px)' }}>
            <div style={{ overflowY: 'auto' }}>
              <SectionNav current={query.trim() === '' ? grown : null} onPick={grow} />
            </div>
            <div style={{ overflowY: 'auto' }}>
              {query.trim() === '' ? (
                <SectionPanel key={grown} id={grown} m={m} headingLevel={3} />
              ) : (
                <Panel title={`Settings for “${query.trim()}”`} lede="Change one here, or open the section it is in." headingLevel={3}>
                  <div style={{ padding: '0 22px 18px' }}>
                    <Found query={query} m={m} onOpen={grow} projects={PROJECTS} />
                  </div>
                </Panel>
              )}
            </div>
          </div>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}
