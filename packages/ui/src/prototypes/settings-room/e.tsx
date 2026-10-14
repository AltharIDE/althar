// Scrappy, E: ⌘, finds any setting by name and changes it in place; the gear opens the settings page (B's) to look around.
import { useState } from 'react'

import { Button, Dialog, IconButton, Kbd } from '../../index'
import { SettingsPage } from './b'
import { SearchField } from './frame'
import { type Models, useModels } from './models'
import type { ProtoSettingsProps } from './seams/SettingsPanel'
import { find, FLIPS, Found, PROJECTS, QuickToggles, SECTIONS, type SectionId } from './sections'

import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'
import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

export function DirectionE({ start, open, onOpenChange, glance, where }: ProtoSettingsProps) {
  const [page, setPage] = useState<SectionId | null>(null)
  const m = useModels(start, open || page !== null, glance)
  const browse = (id: SectionId) => {
    onOpenChange(false)
    setPage(id)
  }
  return (
    <>
      <IconButton icon="gear" label={text.title} size="small" onClick={() => setPage(page === null ? 'agents' : null)} />
      {open && <FindSetting m={m} onClose={() => onOpenChange(false)} onBrowse={browse} />}
      {page !== null && <SettingsPage key={page} m={m} first={page} back={where} onClose={() => setPage(null)} />}
    </>
  )
}

/** A field you arrive typing in; what it finds, live, under the sections it is in. Return flips the first that is on or off, or opens its section. */
function FindSetting({ m, onClose, onBrowse }: { m: Models; onClose: () => void; onBrowse: (id: SectionId) => void }) {
  const [query, setQuery] = useState('')
  const act = () => {
    const first = find(query)[0]
    if (first === undefined) return
    const flip = first.row === undefined ? undefined : FLIPS[first.row]
    if (flip === undefined) onBrowse(first.section)
    else flip(m)
  }
  return (
    <Dialog
      title="Settings"
      onClose={onClose}
      width={660}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <span className={s.quiet} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Kbd>↵</Kbd> turns the first on or off, or opens its section · <Kbd>esc</Kbd> closes
          </span>
          <Button onClick={() => onBrowse('agents')} trailingIcon="chevron">
            All settings
          </Button>
        </div>
      }
    >
      <div
        style={{ display: 'grid', gap: 14 }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.target.type !== 'search') return
          event.preventDefault()
          act()
        }}
      >
        <SearchField value={query} onChange={setQuery} autoFocus />
        {query.trim() === '' ? (
          <>
            <QuickToggles m={m} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {SECTIONS.map((section) => (
                <Button
                  key={section.id}
                  variant="quiet"
                  icon={section.icon}
                  onClick={() => onBrowse(section.id)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  {section.title}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <Found query={query} m={m} onOpen={onBrowse} projects={PROJECTS} />
        )}
      </div>
    </Dialog>
  )
}
